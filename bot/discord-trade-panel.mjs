import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder,
  ModalBuilder,
  StringSelectMenuBuilder,
  StringSelectMenuOptionBuilder,
  TextInputBuilder,
  TextInputStyle,
} from 'discord.js';
import {
  loadTradeSettings,
  patchTradeSettings,
  tradeSettingsSummary,
} from '../api/lib/trade-settings.mjs';
import { listTradeWalletsPublic } from '../api/lib/trade-wallets.mjs';
import {
  formatPriorityFeeAxiom,
  formatSolLabel,
  AXIOM_PRIORITY_PRESETS,
} from '../api/lib/trade-format.mjs';
import {
  fetchTradeWalletBalances,
  formatWalletsBalanceBlock,
} from '../api/lib/wallet-balances.mjs';

const TRADE_COLOR = 0x22c55e;

export const TCID = {
  MENU: 'bt:trade',
  TOGGLE: 'bt:trade:on',
  BTNS: 'bt:trade:btns',
  BUY_PRESETS: 'bt:trade:buyp',
  SELL_PRESETS: 'bt:trade:sellp',
  SLIP: 'bt:trade:slip',
  PRIO: 'bt:trade:prio',
  MULTI: 'bt:trade:multi',
  WALLETS: 'bt:trade:wallets',
  WL_ADD: 'bt:trade:wladd',
  WL_RM: 'bt:trade:wlrm',
  AUTO: 'bt:trade:auto',
  AUTO_TOGGLE: 'bt:trade:autot',
  AUTO_SOL: 'bt:trade:autosol',
  AUTO_MC: 'bt:trade:automc',
  RESERVE: 'bt:trade:reserve',
  REFRESH_BAL: 'bt:trade:refreshbal',
  PRIO_CUSTOM: 'bt:trade:priocustom',
  SEL_WL_TOGGLE: 'bt:sel:trwl',
  SEL_WL_RM: 'bt:sel:trrm',
  MODAL_BUY_PRESETS: 'bt:modal:trbuyp',
  MODAL_SELL_PRESETS: 'bt:modal:trsellp',
  MODAL_SLIP: 'bt:modal:trslip',
  MODAL_PRIO: 'bt:modal:trprio',
  MODAL_WL_ADD: 'bt:modal:trwladd',
  MODAL_AUTO_SOL: 'bt:modal:trautosol',
  MODAL_AUTO_MC: 'bt:modal:trautomc',
  MODAL_RESERVE: 'bt:modal:trreserve',
  MODAL_CUSTOM_BUY: 'bt:modal:trcb:',
  MODAL_CUSTOM_SELL: 'bt:modal:trcs:',
};

function tbtn(id, label, style = ButtonStyle.Secondary, emoji) {
  const b = new ButtonBuilder().setCustomId(id).setLabel(label).setStyle(style);
  if (emoji) b.setEmoji(emoji);
  return b;
}

function trow(...buttons) {
  return new ActionRowBuilder().addComponents(...buttons.slice(0, 5));
}

function tradeEmbed(title, description) {
  return new EmbedBuilder().setColor(TRADE_COLOR).setTitle(title).setDescription(description);
}

export async function buildTradeMenu() {
  const s = loadTradeSettings();
  const balances = await fetchTradeWalletBalances();
  const prio = formatPriorityFeeAxiom(s.priorityFeeLamports);
  const walletBlock = formatWalletsBalanceBlock(balances, s.enabledWalletIds);

  const embed = tradeEmbed(
    '💹 Trading Jupiter',
    [
      ...tradeSettingsSummary(s),
      '',
      '**👛 Wallets & soldes**',
      walletBlock.slice(0, 1800),
      '',
      '_Clés privées sur le serveur uniquement. Priority fee : clique ⚡ pour changer (Normal → Fast → Turbo → Ultra)._',
    ].join('\n'),
  );

  const onOff = s.tradingEnabled ? '🔴 Désactiver trading' : '🟢 Activer trading';
  const onStyle = s.tradingEnabled ? ButtonStyle.Danger : ButtonStyle.Success;
  const prioBtnLabel = `Fee ${prio.tier}`.slice(0, 80);

  return {
    embeds: [embed],
    components: [
      trow(tbtn(TCID.TOGGLE, onOff, onStyle)),
      trow(
        tbtn(TCID.BUY_PRESETS, 'Montants achat SOL', ButtonStyle.Secondary, '💰'),
        tbtn(TCID.SELL_PRESETS, 'Montants vente %', ButtonStyle.Secondary, '📉'),
        tbtn(TCID.SLIP, 'Slippage', ButtonStyle.Secondary, '〰️'),
      ),
      trow(
        tbtn(TCID.PRIO, prioBtnLabel, ButtonStyle.Secondary, '⚡'),
        tbtn(TCID.PRIO_CUSTOM, 'Fee custom SOL', ButtonStyle.Secondary, '✏️'),
        tbtn(TCID.MULTI, `Multi: ${s.multiWalletMode}`, ButtonStyle.Secondary, '👛'),
      ),
      trow(
        tbtn(TCID.RESERVE, `Réserve ${formatSolLabel(s.minSolReserve)}`, ButtonStyle.Secondary, '🛡️'),
        tbtn(TCID.REFRESH_BAL, 'Rafraîchir soldes', ButtonStyle.Secondary, '🔄'),
      ),
      trow(
        tbtn(TCID.WALLETS, 'Wallets trading', ButtonStyle.Primary, '🔑'),
        tbtn(TCID.BTNS, s.showTradeButtonsOnAlerts ? 'Masquer boutons' : 'Afficher boutons', ButtonStyle.Secondary, '🔘'),
      ),
      trow(tbtn(TCID.AUTO, 'Auto-buy', ButtonStyle.Secondary, '🤖'), tbtn('bt:settings', 'Retour paramètres', ButtonStyle.Secondary, '◀')),
    ],
  };
}

export async function buildTradeWalletsPanel() {
  const s = loadTradeSettings();
  const balances = await fetchTradeWalletBalances();
  const enabled = new Set(s.enabledWalletIds || []);

  const lines = balances.length
    ? balances.map(w => {
        const on = !enabled.size || enabled.has(w.id);
        const bal = w.sol == null ? '…' : formatSolLabel(w.sol);
        return `${on ? '🟢' : '⚪'} **${w.label}** · **${bal}**\n\`${w.pubkey}\` _(${w.source})_`;
      })
    : ['_Aucun wallet — ajoute-en un ou définis TRADE_WALLETS_JSON sur Railway._'];

  const total = balances.reduce((sum, w) => sum + (w.sol ?? 0), 0);
  const embed = tradeEmbed(
    '🔑 Wallets de trading',
    [`**Total** · **${formatSolLabel(total)}**`, '', ...lines].join('\n\n').slice(0, 3900),
  );

  const components = [
    trow(tbtn(TCID.WL_ADD, 'Ajouter clé', ButtonStyle.Success, '➕'), tbtn(TCID.WL_RM, 'Retirer', ButtonStyle.Danger, '➖')),
    trow(tbtn(TCID.MENU, 'Retour trading', ButtonStyle.Secondary, '◀')),
  ];

  if (balances.length) {
    components.unshift(
      new ActionRowBuilder().addComponents(
        new StringSelectMenuBuilder()
          .setCustomId(TCID.SEL_WL_TOGGLE)
          .setPlaceholder('Activer / désactiver un wallet…')
          .addOptions(
            balances.slice(0, 25).map(w => {
              const on = !enabled.size || enabled.has(w.id);
              const bal = w.sol == null ? '?' : formatSolLabel(w.sol);
              return new StringSelectMenuOptionBuilder()
                .setLabel(`${on ? '✓' : '○'} ${w.label} · ${bal}`.slice(0, 100))
                .setDescription(w.pubkey.slice(0, 50))
                .setValue(`${on ? 'off' : 'on'}:${w.id}`);
            }),
          ),
      ),
    );
  }

  return { embeds: [embed], components };
}

export function buildTradeAutoPanel() {
  const s = loadTradeSettings();
  const ab = s.autoBuy;
  const embed = tradeEmbed(
    '🤖 Auto-buy',
    [
      `État : **${ab.enabled ? 'ACTIVÉ' : 'désactivé'}**`,
      `Montant : **${ab.solAmount} SOL** par alerte`,
      `MC : **${ab.minMcUsd || 0}** – **${ab.maxMcUsd || '∞'}** USD`,
      `Venues : ${(ab.venues || []).join(', ') || 'toutes'}`,
      `Max achats / token : **${ab.maxPerMint || 1}**`,
      '',
      '_Achète automatiquement quand une alerte correspond aux filtres (nécessite Trading ON)._',
    ].join('\n'),
  );

  return {
    embeds: [embed],
    components: [
      trow(
        tbtn(TCID.AUTO_TOGGLE, ab.enabled ? 'Désactiver auto-buy' : 'Activer auto-buy', ab.enabled ? ButtonStyle.Danger : ButtonStyle.Success),
      ),
      trow(
        tbtn(TCID.AUTO_SOL, 'Montant SOL', ButtonStyle.Secondary, '💰'),
        tbtn(TCID.AUTO_MC, 'Filtre MC', ButtonStyle.Secondary, '📊'),
      ),
      trow(tbtn(TCID.MENU, 'Retour trading', ButtonStyle.Secondary, '◀')),
    ],
  };
}

export function buildTradeWalletRemoveSelect() {
  const fileWallets = listTradeWalletsPublic().filter(w => w.source === 'file');
  const embed = tradeEmbed(
    '➖ Retirer wallet trading',
    fileWallets.length
      ? 'Seuls les wallets ajoutés via le bot (fichier) peuvent être retirés ici.'
      : '_Aucun wallet fichier — ceux en variable env se retirent dans Railway._',
  );

  const components = [trow(tbtn(TCID.WALLETS, 'Retour', ButtonStyle.Secondary, '◀'))];
  if (fileWallets.length) {
    components.unshift(
      new ActionRowBuilder().addComponents(
        new StringSelectMenuBuilder()
          .setCustomId(TCID.SEL_WL_RM)
          .setPlaceholder('Wallet à retirer…')
          .addOptions(
            fileWallets.slice(0, 25).map(w =>
              new StringSelectMenuOptionBuilder()
                .setLabel(w.label.slice(0, 100))
                .setDescription(w.pubkey.slice(0, 50))
                .setValue(w.id),
            ),
          ),
      ),
    );
  }
  return { embeds: [embed], components };
}

export function tradeBuyPresetsModal() {
  const s = loadTradeSettings();
  return new ModalBuilder()
    .setCustomId(TCID.MODAL_BUY_PRESETS)
    .setTitle('Montants achat (SOL)')
    .addComponents(
      new ActionRowBuilder().addComponents(
        new TextInputBuilder()
          .setCustomId('presets')
          .setLabel('4 montants séparés par des virgules')
          .setStyle(TextInputStyle.Short)
          .setRequired(true)
          .setValue(s.buyPresetsSol.join(', ')),
      ),
    );
}

export function tradeSellPresetsModal() {
  const s = loadTradeSettings();
  return new ModalBuilder()
    .setCustomId(TCID.MODAL_SELL_PRESETS)
    .setTitle('Montants vente (%)')
    .addComponents(
      new ActionRowBuilder().addComponents(
        new TextInputBuilder()
          .setCustomId('presets')
          .setLabel('4 pourcentages (25, 50, 75, 100)')
          .setStyle(TextInputStyle.Short)
          .setRequired(true)
          .setValue(s.sellPresetsPct.join(', ')),
      ),
    );
}

export function tradeSlipModal() {
  const s = loadTradeSettings();
  return new ModalBuilder()
    .setCustomId(TCID.MODAL_SLIP)
    .setTitle('Slippage')
    .addComponents(
      new ActionRowBuilder().addComponents(
        new TextInputBuilder()
          .setCustomId('bps')
          .setLabel('Basis points (1500 = 15%)')
          .setStyle(TextInputStyle.Short)
          .setRequired(true)
          .setValue(String(s.slippageBps)),
      ),
    );
}

export function tradePrioModal() {
  const s = loadTradeSettings();
  const sol = (s.priorityFeeLamports / 1e9).toString();
  const hint = AXIOM_PRIORITY_PRESETS.map(p => `${p.name}=${p.sol}`).join(', ');
  return new ModalBuilder()
    .setCustomId(TCID.MODAL_PRIO)
    .setTitle('Priority fee (SOL)')
    .addComponents(
      new ActionRowBuilder().addComponents(
        new TextInputBuilder()
          .setCustomId('sol')
          .setLabel(`SOL (Axiom: ${hint})`)
          .setStyle(TextInputStyle.Short)
          .setRequired(true)
          .setValue(sol),
      ),
    );
}

export function cyclePriorityPreset() {
  const s = loadTradeSettings();
  const presets = AXIOM_PRIORITY_PRESETS;
  let idx = presets.findIndex(p => p.lamports === s.priorityFeeLamports);
  if (idx < 0) idx = 0;
  const next = presets[(idx + 1) % presets.length];
  patchTradeSettings({ priorityFeeLamports: next.lamports });
  return next;
}

export function tradeWalletAddModal() {
  return new ModalBuilder()
    .setCustomId(TCID.MODAL_WL_ADD)
    .setTitle('Ajouter wallet trading')
    .addComponents(
      new ActionRowBuilder().addComponents(
        new TextInputBuilder()
          .setCustomId('label')
          .setLabel('Nom')
          .setStyle(TextInputStyle.Short)
          .setRequired(true),
      ),
      new ActionRowBuilder().addComponents(
        new TextInputBuilder()
          .setCustomId('secret')
          .setLabel('Clé privée base58')
          .setStyle(TextInputStyle.Paragraph)
          .setRequired(true)
          .setPlaceholder('Ne partage jamais ce modal — message éphémère'),
      ),
    );
}

export function tradeAutoSolModal() {
  const ab = loadTradeSettings().autoBuy;
  return new ModalBuilder()
    .setCustomId(TCID.MODAL_AUTO_SOL)
    .setTitle('Auto-buy — montant SOL')
    .addComponents(
      new ActionRowBuilder().addComponents(
        new TextInputBuilder()
          .setCustomId('sol')
          .setLabel('SOL par achat auto')
          .setStyle(TextInputStyle.Short)
          .setRequired(true)
          .setValue(String(ab.solAmount)),
      ),
    );
}

export function tradeAutoMcModal() {
  const ab = loadTradeSettings().autoBuy;
  return new ModalBuilder()
    .setCustomId(TCID.MODAL_AUTO_MC)
    .setTitle('Auto-buy — filtre MC')
    .addComponents(
      new ActionRowBuilder().addComponents(
        new TextInputBuilder()
          .setCustomId('min')
          .setLabel('MC min USD (0 = off)')
          .setStyle(TextInputStyle.Short)
          .setRequired(true)
          .setValue(String(ab.minMcUsd || 0)),
      ),
      new ActionRowBuilder().addComponents(
        new TextInputBuilder()
          .setCustomId('max')
          .setLabel('MC max USD')
          .setStyle(TextInputStyle.Short)
          .setRequired(true)
          .setValue(String(ab.maxMcUsd || 250000)),
      ),
    );
}

export function tradeReserveModal() {
  const s = loadTradeSettings();
  return new ModalBuilder()
    .setCustomId(TCID.MODAL_RESERVE)
    .setTitle('Réserve SOL minimum')
    .addComponents(
      new ActionRowBuilder().addComponents(
        new TextInputBuilder()
          .setCustomId('sol')
          .setLabel('SOL laissés sur chaque wallet')
          .setStyle(TextInputStyle.Short)
          .setRequired(true)
          .setValue(String(s.minSolReserve)),
      ),
    );
}

export function tradeCustomBuyModal(mint) {
  const s = loadTradeSettings();
  const def = s.buyPresetsSol[s.defaultBuyPresetIndex] ?? 0.1;
  return new ModalBuilder()
    .setCustomId(`${TCID.MODAL_CUSTOM_BUY}${mint}`)
    .setTitle('Achat personnalisé')
    .addComponents(
      new ActionRowBuilder().addComponents(
        new TextInputBuilder()
          .setCustomId('sol')
          .setLabel('Montant SOL')
          .setStyle(TextInputStyle.Short)
          .setRequired(true)
          .setValue(String(def)),
      ),
    );
}

export function tradeCustomSellModal(mint) {
  return new ModalBuilder()
    .setCustomId(`${TCID.MODAL_CUSTOM_SELL}${mint}`)
    .setTitle('Vente personnalisée')
    .addComponents(
      new ActionRowBuilder().addComponents(
        new TextInputBuilder()
          .setCustomId('pct')
          .setLabel('Pourcentage (1-100)')
          .setStyle(TextInputStyle.Short)
          .setRequired(true)
          .setValue('100'),
      ),
    );
}

export function cycleMultiWalletMode() {
  const s = loadTradeSettings();
  const order = ['all', 'first', 'sequential'];
  const next = order[(order.indexOf(s.multiWalletMode) + 1) % order.length];
  patchTradeSettings({ multiWalletMode: next });
  return next;
}

export function parsePresetList(raw, isPct = false) {
  const nums = String(raw)
    .split(/[,;\s]+/)
    .map(x => parseFloat(x.replace('%', '')))
    .filter(n => !Number.isNaN(n) && n > 0);
  if (!nums.length) throw new Error('Au moins un montant requis.');
  if (isPct && nums.some(n => n > 100)) throw new Error('Pourcentage max 100.');
  if (!isPct && nums.some(n => n > 50)) throw new Error('Max 50 SOL par preset.');
  return nums.slice(0, 4);
}

export function resolveTradeScreen(id) {
  if (id === TCID.MENU) return 'trade';
  if (id === TCID.WALLETS) return 'trade_wallets';
  if (id === TCID.WL_RM) return 'trade_wl_rm';
  if (id === TCID.AUTO) return 'trade_auto';
  return null;
}

export async function renderTradeScreen(screen) {
  switch (screen) {
    case 'trade':
      return await buildTradeMenu();
    case 'trade_wallets':
      return await buildTradeWalletsPanel();
    case 'trade_wl_rm':
      return buildTradeWalletRemoveSelect();
    case 'trade_auto':
      return buildTradeAutoPanel();
    default:
      return await buildTradeMenu();
  }
}
