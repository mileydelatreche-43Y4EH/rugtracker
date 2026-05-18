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
import { getActiveWallets } from '../api/lib/wallet-store.mjs';
import {
  listSnipes,
  getSnipeByAddr,
  snipeSummaryLines,
} from '../api/lib/snipe-settings.mjs';
import { formatSolLabel } from '../api/lib/trade-format.mjs';

const SNIPE_COLOR = 0xf59e0b;

export const SCID = {
  MENU: 'bt:snipe',
  ADD: 'bt:snipe:add',
  SEL_ADD: 'bt:sel:snipeadd',
  SEL_CFG: 'bt:sel:snipecfg',
  SEL_RM: 'bt:sel:sniperm',
  BACK_TRADE: 'bt:trade',
  MODAL_SOL: 'bt:modal:snipesol:',
  MODAL_BUY_PCT: 'bt:modal:snipebuypct:',
  MODAL_SELL_PCT: 'bt:modal:snipesellpct:',
};

function sbtn(id, label, style = ButtonStyle.Secondary) {
  return new ButtonBuilder().setCustomId(id).setLabel(label).setStyle(style);
}

function srow(...buttons) {
  return new ActionRowBuilder().addComponents(...buttons.slice(0, 5));
}

function snipeEmbed(title, description) {
  return new EmbedBuilder().setColor(SNIPE_COLOR).setTitle(title).setDescription(description);
}

export async function buildSnipeMenu() {
  const lines = snipeSummaryLines();
  const embed = snipeEmbed(
    '🎯 Sniping wallet',
    [
      'Copie les achats **uniquement** des wallets que tu configures ici.',
      'L’**auto-buy** ne s’applique qu’à ces cibles (plus dans les paramètres généraux).',
      '',
      '**Cibles snipe**',
      lines.join('\n\n').slice(0, 3500),
    ].join('\n'),
  );

  const components = [
    srow(sbtn(SCID.ADD, '➕ Ajouter wallet', ButtonStyle.Success)),
    srow(sbtn(SCID.BACK_TRADE, '◀ Retour trading')),
  ];

  const snipes = listSnipes();
  if (snipes.length) {
    components.unshift(
      new ActionRowBuilder().addComponents(
        new StringSelectMenuBuilder()
          .setCustomId(SCID.SEL_CFG)
          .setPlaceholder('Configurer un snipe…')
          .addOptions(
            snipes.slice(0, 25).map(s => {
              const ab = s.autoBuy;
              return new StringSelectMenuOptionBuilder()
                .setLabel(`${ab.enabled ? '🟢' : '⚪'} ${s.label || s.watchAddr.slice(0, 8)}`.slice(0, 100))
                .setDescription(
                  `${ab.enabled ? formatSolLabel(ab.solAmount) : 'off'} · ${s.watchAddr.slice(0, 20)}`,
                )
                .setValue(s.watchAddr);
            }),
          ),
      ),
      new ActionRowBuilder().addComponents(
        new StringSelectMenuBuilder()
          .setCustomId(SCID.SEL_RM)
          .setPlaceholder('Retirer un snipe…')
          .addOptions(
            snipes.slice(0, 25).map(s =>
              new StringSelectMenuOptionBuilder()
                .setLabel((s.label || s.watchAddr.slice(0, 8)).slice(0, 100))
                .setDescription(s.watchAddr.slice(0, 50))
                .setValue(s.watchAddr),
            ),
          ),
      ),
    );
  }

  return { embeds: [embed], components };
}

export function buildSnipeAddSelect() {
  const sniped = new Set(listSnipes().map(s => s.watchAddr));
  const candidates = getActiveWallets().filter(w => !sniped.has(w.addr));

  const embed = snipeEmbed(
    '➕ Ajouter au sniping',
    candidates.length
      ? 'Choisis un **wallet surveillé** à sniper :'
      : '_Tous les wallets actifs sont déjà en sniping, ou aucun wallet surveillé._',
  );

  const components = [srow(sbtn(SCID.MENU, '◀ Retour sniping'))];
  if (candidates.length) {
    components.unshift(
      new ActionRowBuilder().addComponents(
        new StringSelectMenuBuilder()
          .setCustomId(SCID.SEL_ADD)
          .setPlaceholder('Wallet à sniper…')
          .addOptions(
            candidates.slice(0, 25).map(w =>
              new StringSelectMenuOptionBuilder()
                .setLabel(`${w.groupEmoji} ${w.label}`.slice(0, 100))
                .setDescription(`${w.groupName} · ${w.addr.slice(0, 24)}`)
                .setValue(w.addr),
            ),
          ),
      ),
    );
  }
  return { embeds: [embed], components };
}

export function buildSnipeConfigPanel(watchAddr) {
  const w = getActiveWallets().find(x => x.addr === watchAddr);
  const snipe = getSnipeByAddr(watchAddr);
  if (!snipe) {
    return buildSnipeMenu();
  }
  const ab = snipe.autoBuy;
  const embed = snipeEmbed(
    `🎯 ${w?.label || watchAddr.slice(0, 8)}`,
    [
      `**Wallet surveillé**`,
      `\`${watchAddr}\``,
      w?.groupName ? `**Groupe** · ${w.groupEmoji} ${w.groupName}` : '',
      '',
      `**Auto-buy** · ${ab.enabled ? '🟢 **ACTIVÉ**' : '⚪ désactivé'}`,
      `**% achat copié** · **${ab.buyCopyPct}%** du montant SOL qu’il achète`,
      `**Plafond SOL** · ${formatSolLabel(ab.solAmount)} max par achat`,
      `**Auto-sell** · ${ab.autoSellEnabled ? '🟢 **ACTIVÉ**' : '⚪ désactivé'}`,
      `**% vente copiée** · **${ab.sellCopyPct}%** de sa vente → même % sur ta position`,
      `**Venues** · ${(ab.venues || []).join(', ')} · max **${ab.maxPerMint}** achat(s)/token`,
      '',
      '_Trading ON requis. Achat = % de son SOL (plafonné). Vente = quand il vend, tu vends le même % de ta position._',
    ]
      .filter(Boolean)
      .join('\n'),
  );

  const buyTogLabel = ab.enabled ? 'Désactiver auto-buy' : 'Activer auto-buy';
  const buyTogStyle = ab.enabled ? ButtonStyle.Danger : ButtonStyle.Success;
  const sellTogLabel = ab.autoSellEnabled ? 'Désactiver auto-sell' : 'Activer auto-sell';
  const sellTogStyle = ab.autoSellEnabled ? ButtonStyle.Danger : ButtonStyle.Success;

  return {
    embeds: [embed],
    components: [
      srow(sbtn(`bt:snipe:tog:${watchAddr}`, buyTogLabel, buyTogStyle)),
      srow(
        sbtn(`bt:snipe:buypct:${watchAddr}`, `% Achat ${ab.buyCopyPct}%`),
        sbtn(`bt:snipe:sol:${watchAddr}`, 'Plafond SOL'),
        sbtn(`bt:snipe:sellpct:${watchAddr}`, `% Vente ${ab.sellCopyPct}%`),
      ),
      srow(sbtn(`bt:snipe:selltog:${watchAddr}`, sellTogLabel, sellTogStyle)),
      srow(sbtn(SCID.MENU, '◀ Retour liste')),
    ],
  };
}

export function snipeSolModal(watchAddr) {
  const snipe = getSnipeByAddr(watchAddr);
  return new ModalBuilder()
    .setCustomId(`${SCID.MODAL_SOL}${watchAddr}`)
    .setTitle('Snipe — plafond SOL')
    .addComponents(
      new ActionRowBuilder().addComponents(
        new TextInputBuilder()
          .setCustomId('sol')
          .setLabel('SOL max par achat auto')
          .setStyle(TextInputStyle.Short)
          .setRequired(true)
          .setValue(String(snipe?.autoBuy?.solAmount ?? 0.1)),
      ),
    );
}

export function snipeBuyPctModal(watchAddr) {
  const ab = getSnipeByAddr(watchAddr)?.autoBuy;
  return new ModalBuilder()
    .setCustomId(`${SCID.MODAL_BUY_PCT}${watchAddr}`)
    .setTitle('Snipe — % achat copié')
    .addComponents(
      new ActionRowBuilder().addComponents(
        new TextInputBuilder()
          .setCustomId('pct')
          .setLabel('% du montant SOL qu’il achète (ex. 50)')
          .setStyle(TextInputStyle.Short)
          .setRequired(true)
          .setValue(String(ab?.buyCopyPct ?? 100)),
      ),
    );
}

export function snipeSellPctModal(watchAddr) {
  const ab = getSnipeByAddr(watchAddr)?.autoBuy;
  return new ModalBuilder()
    .setCustomId(`${SCID.MODAL_SELL_PCT}${watchAddr}`)
    .setTitle('Snipe — % vente copiée')
    .addComponents(
      new ActionRowBuilder().addComponents(
        new TextInputBuilder()
          .setCustomId('pct')
          .setLabel('% de sa vente à copier (100 = miroir)')
          .setStyle(TextInputStyle.Short)
          .setRequired(true)
          .setValue(String(ab?.sellCopyPct ?? 100)),
      ),
    );
}

export function resolveSnipeScreen(id) {
  if (id === SCID.MENU) return 'snipe';
  if (id === SCID.ADD) return 'snipe_add';
  return null;
}

export async function renderSnipeScreen(screen, watchAddr) {
  switch (screen) {
    case 'snipe':
      return await buildSnipeMenu();
    case 'snipe_add':
      return buildSnipeAddSelect();
    case 'snipe_cfg':
      return buildSnipeConfigPanel(watchAddr);
    default:
      return await buildSnipeMenu();
  }
}
