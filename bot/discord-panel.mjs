import {
  ActionRowBuilder,
  AttachmentBuilder,
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
  loadStore,
  storeSummary,
} from '../api/lib/wallet-store.mjs';
import { loadTradeSettings } from '../api/lib/trade-settings.mjs';
import {
  fetchTradeWalletBalances,
  formatHomeWalletsBlock,
} from '../api/lib/wallet-balances.mjs';
import { renderTradeScreen } from './discord-trade-panel.mjs';
import { renderSnipeScreen } from './discord-snipe-panel.mjs';
import { buildAlertsLivePanel } from './discord-alerts-panel.mjs';

const PANEL_COLOR = 0x5865f2;

export const CID = {
  HOME: 'bt:home',
  WALLETS: 'bt:wl',
  WL_LIST: 'bt:wl:list',
  WL_ADD: 'bt:wl:add',
  WL_RM: 'bt:wl:rm',
  GROUPS: 'bt:gr',
  GR_LIST: 'bt:gr:list',
  GR_ADD: 'bt:gr:add',
  GR_PAUSE: 'bt:gr:pause',
  GR_RESUME: 'bt:gr:resume',
  STATUS: 'bt:status',
  SETTINGS: 'bt:settings',
  ALERTS_LIVE: 'bt:alerts:live',
  TRADING: 'bt:trade',
  TEST: 'bt:test',
  EXPORT: 'bt:export',
  IMPORT: 'bt:import',
  REFRESH: 'bt:refresh',
  HOME_BAL: 'bt:home:bal',
  SEL_RM_WL: 'bt:sel:rmwl',
  SEL_PAUSE: 'bt:sel:pause',
  SEL_RESUME: 'bt:sel:resume',
  MODAL_WL_ADD: 'bt:modal:wladd',
  MODAL_GR_ADD: 'bt:modal:gradd',
  MODAL_IMPORT: 'bt:modal:import',
};

function btn(id, label, emoji) {
  const text = emoji ? `${emoji} ${label}` : label;
  return new ButtonBuilder().setCustomId(id).setLabel(text.slice(0, 80)).setStyle(ButtonStyle.Secondary);
}

function row(...buttons) {
  return new ActionRowBuilder().addComponents(...buttons.slice(0, 5));
}

function backHome() {
  return btn(CID.HOME, 'Menu', '🏠');
}

function panelEmbed(title, description) {
  return new EmbedBuilder().setColor(PANEL_COLOR).setTitle(title).setDescription(description);
}

export async function buildHomePanel() {
  const balances = await fetchTradeWalletBalances();
  const s = loadTradeSettings();
  const walletBlock = formatHomeWalletsBlock(balances, s.enabledWalletIds);
  const store = loadStore();
  const tracked = store.groups.reduce((n, g) => n + g.wallets.length, 0);
  const groups = store.groups.length;

  const embed = panelEmbed(
    '◈ Bundle Tracker',
    [
      `▶ **${tracked}** wallet(s) suivis · **${groups}** groupe(s)`,
      '',
      '**👛 Tes wallets**',
      walletBlock.slice(0, 3500),
    ].join('\n'),
  );

  return {
    embeds: [embed],
    components: [
      row(btn(CID.WALLETS, 'Wallets', '👛'), btn(CID.GROUPS, 'Groupes', '📁')),
      row(
        btn(CID.STATUS, 'Statut', '📊'),
        btn(CID.SETTINGS, 'Paramètres', '⚙️'),
        btn(CID.HOME_BAL, 'Rafraîchir soldes', '🔄'),
      ),
    ],
  };
}

export function buildWalletsMenu() {
  const sum = storeSummary();
  const embed = panelEmbed('👛 Wallets', `**${sum.activeCount}** wallet(s) surveillé(s).`);

  return {
    embeds: [embed],
    components: [
      row(
        btn(CID.WL_LIST, 'Liste', '📋'),
        btn(CID.WL_ADD, 'Ajouter', '➕'),
        btn(CID.WL_RM, 'Retirer', '➖'),
      ),
      row(btn(CID.IMPORT, 'Importer JSON', '📥'), btn(CID.EXPORT, 'Exporter JSON', '💾')),
      row(backHome()),
    ],
  };
}

export function buildWalletsList() {
  const sum = storeSummary();
  const lines = sum.wallets.length
    ? sum.wallets.map(
        (w, i) =>
          `**${i + 1}.** ${w.groupEmoji} **${w.label}**\n\`${w.addr}\`\n_${w.groupName}_`,
      )
    : ['_Aucun wallet actif._'];

  const embed = panelEmbed('📋 Liste des wallets', lines.join('\n\n').slice(0, 4000));

  return {
    embeds: [embed],
    components: [row(btn(CID.WALLETS, 'Retour', '◀'), backHome())],
  };
}

export function buildWalletRemoveSelect() {
  const store = loadStore();
  const options = [];
  for (const g of store.groups) {
    for (const w of g.wallets) {
      if (options.length >= 25) break;
      options.push(
        new StringSelectMenuOptionBuilder()
          .setLabel(`${w.label} (${g.name})`.slice(0, 100))
          .setDescription(w.addr.slice(0, 50))
          .setValue(w.addr),
      );
    }
  }

  const embed = panelEmbed(
    '➖ Retirer un wallet',
    options.length ? 'Choisis dans le menu :' : '_Aucun wallet._',
  );

  const components = [row(backHome())];
  if (options.length) {
    components.unshift(
      new ActionRowBuilder().addComponents(
        new StringSelectMenuBuilder()
          .setCustomId(CID.SEL_RM_WL)
          .setPlaceholder('Wallet à retirer…')
          .addOptions(options),
      ),
    );
  }

  return { embeds: [embed], components };
}

export function buildGroupsMenu() {
  const embed = panelEmbed('📁 Groupes', 'Créer, mettre en pause ou lister tes groupes.');

  return {
    embeds: [embed],
    components: [
      row(
        btn(CID.GR_LIST, 'Liste', '📋'),
        btn(CID.GR_ADD, 'Créer', '➕'),
        btn(CID.GR_PAUSE, 'Pause', '⏸'),
      ),
      row(btn(CID.GR_RESUME, 'Reprendre', '▶')),
      row(backHome()),
    ],
  };
}

export function buildGroupsList() {
  const sum = storeSummary();
  const embed = panelEmbed('📋 Groupes', sum.lines.join('\n') || '_Aucun groupe._');

  return {
    embeds: [embed],
    components: [row(btn(CID.GROUPS, 'Retour', '◀'), backHome())],
  };
}

export function buildGroupSelect(customId, mode) {
  const store = loadStore();
  const options = store.groups
    .filter(g => (mode === 'pause' ? g.active !== false : g.active === false))
    .slice(0, 25)
    .map(g =>
      new StringSelectMenuOptionBuilder()
        .setLabel(`${g.emoji} ${g.name}`.slice(0, 100))
        .setDescription(`${g.wallets.length} wallet(s)`)
        .setValue(g.id),
    );

  const embed = panelEmbed(
    mode === 'pause' ? '⏸ Pause groupe' : '▶ Reprendre groupe',
    options.length
      ? 'Choisis dans le menu :'
      : mode === 'pause'
        ? '_Tous les groupes sont actifs._'
        : '_Aucun groupe en pause._',
  );

  const components = [row(backHome())];
  if (options.length) {
    components.unshift(
      new ActionRowBuilder().addComponents(
        new StringSelectMenuBuilder()
          .setCustomId(customId)
          .setPlaceholder('Groupe…')
          .addOptions(options),
      ),
    );
  }

  return { embeds: [embed], components };
}

export function buildStatusPanel(heliusCount, channelId) {
  const sum = storeSummary();
  const embed = panelEmbed('📊 Statut', sum.lines.join('\n') || '_Aucun groupe._').addFields(
    { name: 'Bot', value: '🟢 En ligne', inline: true },
    { name: 'Wallets', value: String(sum.activeCount), inline: true },
    { name: 'Helius', value: `${heliusCount} clé(s)`, inline: true },
    { name: 'Salon', value: `<#${channelId}>`, inline: false },
  );

  return {
    embeds: [embed],
    components: [row(backHome())],
  };
}

export function buildSettingsPanel(heliusCount) {
  const metaMs = process.env.NTFY_META_TIMEOUT_MS || '850';
  const embed = panelEmbed(
    '⚙️ Paramètres',
    [
      '**Alertes live** — ON/OFF par wallet surveillé',
      '**Trading** — achat/vente Jupiter depuis les alertes',
      '**Test alerte** — fausse notif dans ce salon',
      '**Actualiser** — relance la surveillance des wallets',
      '',
      `⚡ Délai meta alertes : ~${metaMs} ms`,
      '⚡ Détection : WebSocket Helius instantané (`processed`)',
      '',
      '_Notifications PC : active les notifs Discord pour ce serveur._',
    ].join('\n'),
  );

  return {
    embeds: [embed],
    components: [
      row(btn(CID.ALERTS_LIVE, 'Alertes live', '🔔')),
      row(btn(CID.TRADING, 'Trading Buy/Sell', '💹')),
      row(btn(CID.TEST, 'Test alerte', '🧪'), btn(CID.REFRESH, 'Actualiser', '🔄')),
      row(backHome()),
    ],
  };
}

export function walletAddModal() {
  return new ModalBuilder()
    .setCustomId(CID.MODAL_WL_ADD)
    .setTitle('Ajouter un wallet')
    .addComponents(
      new ActionRowBuilder().addComponents(
        new TextInputBuilder()
          .setCustomId('addr')
          .setLabel('Adresse Solana')
          .setStyle(TextInputStyle.Short)
          .setRequired(true),
      ),
      new ActionRowBuilder().addComponents(
        new TextInputBuilder()
          .setCustomId('label')
          .setLabel('Nom affiché')
          .setStyle(TextInputStyle.Short)
          .setRequired(true),
      ),
      new ActionRowBuilder().addComponents(
        new TextInputBuilder()
          .setCustomId('group')
          .setLabel('Groupe (nom exact, vide = défaut)')
          .setStyle(TextInputStyle.Short)
          .setRequired(false)
          .setPlaceholder('ex. migration 99% — laisse vide pour le 1er groupe'),
      ),
    );
}

export function groupAddModal() {
  return new ModalBuilder()
    .setCustomId(CID.MODAL_GR_ADD)
    .setTitle('Créer un groupe')
    .addComponents(
      new ActionRowBuilder().addComponents(
        new TextInputBuilder()
          .setCustomId('name')
          .setLabel('Nom')
          .setStyle(TextInputStyle.Short)
          .setRequired(true),
      ),
      new ActionRowBuilder().addComponents(
        new TextInputBuilder()
          .setCustomId('emoji')
          .setLabel('Emoji')
          .setStyle(TextInputStyle.Short)
          .setRequired(false)
          .setValue('🎯'),
      ),
    );
}

export function importModal() {
  return new ModalBuilder()
    .setCustomId(CID.MODAL_IMPORT)
    .setTitle('Importer backup JSON')
    .addComponents(
      new ActionRowBuilder().addComponents(
        new TextInputBuilder()
          .setCustomId('json')
          .setLabel('JSON (export site)')
          .setStyle(TextInputStyle.Paragraph)
          .setRequired(true)
          .setMaxLength(4000),
      ),
    );
}

export function exportAttachment() {
  const store = loadStore();
  const json = JSON.stringify(store, null, 2);
  return new AttachmentBuilder(Buffer.from(json, 'utf8'), { name: 'wallets-export.json' });
}

export function resolveScreen(customId) {
  switch (customId) {
    case CID.HOME:
      return 'home';
    case CID.REFRESH:
      return 'settings';
    case CID.HOME_BAL:
      return 'home';
    case CID.WALLETS:
      return 'wallets';
    case CID.WL_LIST:
      return 'wl_list';
    case CID.WL_RM:
      return 'wl_rm';
    case CID.GROUPS:
      return 'groups';
    case CID.GR_LIST:
      return 'gr_list';
    case CID.GR_PAUSE:
      return 'gr_pause';
    case CID.GR_RESUME:
      return 'gr_resume';
    case CID.STATUS:
      return 'status';
    case CID.SETTINGS:
      return 'settings';
    case CID.TRADING:
      return 'trading';
    case CID.ALERTS_LIVE:
      return 'alerts_live';
    default:
      return null;
  }
}

export async function renderScreen(screen, ctx) {
  switch (screen) {
    case 'home':
      return await buildHomePanel();
    case 'wallets':
      return buildWalletsMenu();
    case 'wl_list':
      return buildWalletsList();
    case 'wl_rm':
      return buildWalletRemoveSelect();
    case 'groups':
      return buildGroupsMenu();
    case 'gr_list':
      return buildGroupsList();
    case 'gr_pause':
      return buildGroupSelect(CID.SEL_PAUSE, 'pause');
    case 'gr_resume':
      return buildGroupSelect(CID.SEL_RESUME, 'resume');
    case 'status':
      return buildStatusPanel(ctx.heliusCount, ctx.channelId);
    case 'settings':
      return buildSettingsPanel(ctx.heliusCount);
    case 'trading':
      return await renderTradeScreen('trade');
    case 'sniping':
      return await renderSnipeScreen('snipe');
    case 'alerts_live':
      return buildAlertsLivePanel(0);
    default:
      return await buildHomePanel();
  }
}
