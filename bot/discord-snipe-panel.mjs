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
  MODAL_MC: 'bt:modal:snipemc:',
};

function sbtn(id, label, style = ButtonStyle.Secondary, emoji) {
  const b = new ButtonBuilder().setCustomId(id).setLabel(label).setStyle(style);
  if (emoji) b.setEmoji(emoji);
  return b;
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
    srow(sbtn(SCID.ADD, 'Ajouter wallet', ButtonStyle.Success, '➕')),
    srow(sbtn(SCID.BACK_TRADE, 'Retour trading', ButtonStyle.Secondary, '◀')),
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

  const components = [srow(sbtn(SCID.MENU, 'Retour sniping', ButtonStyle.Secondary, '◀'))];
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
      `**Auto-buy snipe** · ${ab.enabled ? '🟢 **ACTIVÉ**' : '⚪ désactivé'}`,
      `**Montant** · ${formatSolLabel(ab.solAmount)}`,
      `**MC** · ${ab.minMcUsd || 0} – ${ab.maxMcUsd || '∞'} USD`,
      `**Venues** · ${(ab.venues || []).join(', ')}`,
      `**Max / token** · ${ab.maxPerMint}`,
      '',
      '_Quand ce wallet achète un token, tes wallets trading achètent automatiquement (si Trading ON)._',
    ]
      .filter(Boolean)
      .join('\n'),
  );

  const toggleLabel = ab.enabled ? 'Désactiver auto snipe' : 'Activer auto snipe';
  const toggleStyle = ab.enabled ? ButtonStyle.Danger : ButtonStyle.Success;

  return {
    embeds: [embed],
    components: [
      srow(sbtn(`bt:snipe:tog:${watchAddr}`, toggleLabel, toggleStyle)),
      srow(
        sbtn(`bt:snipe:sol:${watchAddr}`, 'Montant SOL', ButtonStyle.Secondary, '💰'),
        sbtn(`bt:snipe:mc:${watchAddr}`, 'Filtre MC', ButtonStyle.Secondary, '📊'),
      ),
      srow(sbtn(SCID.MENU, 'Retour liste', ButtonStyle.Secondary, '◀')),
    ],
  };
}

export function snipeSolModal(watchAddr) {
  const snipe = getSnipeByAddr(watchAddr);
  return new ModalBuilder()
    .setCustomId(`${SCID.MODAL_SOL}${watchAddr}`)
    .setTitle('Snipe — montant SOL')
    .addComponents(
      new ActionRowBuilder().addComponents(
        new TextInputBuilder()
          .setCustomId('sol')
          .setLabel('SOL par snipe auto')
          .setStyle(TextInputStyle.Short)
          .setRequired(true)
          .setValue(String(snipe?.autoBuy?.solAmount ?? 0.1)),
      ),
    );
}

export function snipeMcModal(watchAddr) {
  const ab = getSnipeByAddr(watchAddr)?.autoBuy;
  return new ModalBuilder()
    .setCustomId(`${SCID.MODAL_MC}${watchAddr}`)
    .setTitle('Snipe — filtre MC')
    .addComponents(
      new ActionRowBuilder().addComponents(
        new TextInputBuilder()
          .setCustomId('min')
          .setLabel('MC min USD (0 = off)')
          .setStyle(TextInputStyle.Short)
          .setRequired(true)
          .setValue(String(ab?.minMcUsd ?? 0)),
      ),
      new ActionRowBuilder().addComponents(
        new TextInputBuilder()
          .setCustomId('max')
          .setLabel('MC max USD')
          .setStyle(TextInputStyle.Short)
          .setRequired(true)
          .setValue(String(ab?.maxMcUsd ?? 250000)),
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
