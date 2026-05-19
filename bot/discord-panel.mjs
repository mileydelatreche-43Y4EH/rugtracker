import {
  ActionRowBuilder,
  AttachmentBuilder,
  ButtonStyle,
  ModalBuilder,
  StringSelectMenuBuilder,
  StringSelectMenuOptionBuilder,
  TextInputBuilder,
  TextInputStyle,
} from 'discord.js';
import { loadStore, storeSummary } from '../api/lib/wallet-store.mjs';
import { loadTradeSettings } from '../api/lib/trade-settings.mjs';
import { fetchTradeWalletBalances, formatHomeWalletsBlock } from '../api/lib/wallet-balances.mjs';
import { renderTradeScreen } from './discord-trade-panel.mjs';
import { renderSnipeScreen } from './discord-snipe-panel.mjs';
import { buildAlertsLivePanel } from './discord-alerts-panel.mjs';
import {
  UI_COLORS,
  uiBtn,
  uiEmbed,
  uiRow,
  uiRowsPair,
  uiClampRows,
  btnHome,
  navBackHome,
} from './discord-components.mjs';

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
  SNIPE: 'bt:snipe',
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
};

export async function buildHomePanel() {
  const balances = await fetchTradeWalletBalances();
  const s = loadTradeSettings();
  const walletBlock = formatHomeWalletsBlock(balances, s.enabledWalletIds);
  const store = loadStore();
  const tracked = store.groups.reduce((n, g) => n + g.wallets.length, 0);
  const groups = store.groups.length;
  const tradeOn = s.tradingEnabled ? '🟢 ON' : '⚫ OFF';

  const embed = uiEmbed(
    UI_COLORS.home,
    '◈ Bundle Tracker',
    [
      'Panneau de contrôle — tout se fait avec les boutons ci-dessous.',
      '',
      walletBlock.slice(0, 2800),
    ].join('\n'),
    {
      footer: 'Surveillance Helius · alertes instantanées',
      fields: [
        { name: '👀 Suivis', value: `${tracked} wallets`, inline: true },
        { name: '🗂️ Groupes', value: String(groups), inline: true },
        { name: '💹 Trading', value: tradeOn, inline: true },
      ],
    },
  );

  return {
    embeds: [embed],
    components: uiClampRows(
      uiRowsPair([
        uiBtn(CID.WALLETS, '💼 Wallets', ButtonStyle.Primary),
        uiBtn(CID.GROUPS, '🗂️ Groupes', ButtonStyle.Primary),
        uiBtn(CID.TRADING, '💹 Trading', ButtonStyle.Success),
        uiBtn(CID.SNIPE, '🎯 Snipe', ButtonStyle.Success),
        uiBtn(CID.ALERTS_LIVE, '🔔 Alertes', ButtonStyle.Secondary),
        uiBtn(CID.SETTINGS, '⚙️ Paramètres', ButtonStyle.Secondary),
        uiBtn(CID.STATUS, '📡 Statut', ButtonStyle.Secondary),
        uiBtn(CID.HOME_BAL, '💰 Soldes', ButtonStyle.Secondary),
        uiBtn(CID.IMPORT, '📥 Import', ButtonStyle.Secondary),
        uiBtn(CID.EXPORT, '📤 Export', ButtonStyle.Secondary),
      ]),
    ),
  };
}

export function buildWalletsMenu() {
  const sum = storeSummary();
  const embed = uiEmbed(
    UI_COLORS.wallets,
    '💼 Wallets surveillés',
    [
      `**${sum.activeCount}** wallet(s) actifs pour les alertes.`,
      '',
      'Ajoute des adresses Solana, importe un backup ou gère la liste.',
    ].join('\n'),
    { footer: 'Les wallets inactifs (groupe en pause) ne déclenchent pas d’alerte' },
  );

  return {
    embeds: [embed],
    components: uiClampRows([
      ...uiRowsPair([
        uiBtn(CID.WL_LIST, '📋 Liste complète', ButtonStyle.Secondary),
        uiBtn(CID.WL_ADD, '➕ Ajouter', ButtonStyle.Success),
        uiBtn(CID.WL_RM, '🗑️ Retirer', ButtonStyle.Danger),
        uiBtn(CID.IMPORT, '📥 Import .json', ButtonStyle.Secondary),
        uiBtn(CID.EXPORT, '📤 Export .json', ButtonStyle.Secondary),
      ]),
      uiRow(btnHome()),
    ]),
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

  const embed = uiEmbed(UI_COLORS.wallets, '📋 Liste des wallets', lines.join('\n\n').slice(0, 4000));

  return {
    embeds: [embed],
    components: [navBackHome(CID.WALLETS)],
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

  const embed = uiEmbed(
    UI_COLORS.wallets,
    '🗑️ Retirer un wallet',
    options.length ? 'Sélectionne le wallet à supprimer :' : '_Aucun wallet enregistré._',
  );

  const components = [navBackHome(CID.WALLETS)];
  if (options.length) {
    components.unshift(
      new ActionRowBuilder().addComponents(
        new StringSelectMenuBuilder()
          .setCustomId(CID.SEL_RM_WL)
          .setPlaceholder('🔻 Choisir un wallet…')
          .addOptions(options),
      ),
    );
  }

  return { embeds: [embed], components: uiClampRows(components) };
}

export function buildGroupsMenu() {
  const store = loadStore();
  const embed = uiEmbed(
    UI_COLORS.groups,
    '🗂️ Groupes',
    [
      `**${store.groups.length}** groupe(s) · organise tes wallets par stratégie.`,
      '',
      'Pause un groupe pour couper toutes ses alertes d’un coup.',
    ].join('\n'),
  );

  return {
    embeds: [embed],
    components: uiClampRows([
      ...uiRowsPair([
        uiBtn(CID.GR_LIST, '📋 Voir groupes', ButtonStyle.Secondary),
        uiBtn(CID.GR_ADD, '✨ Créer', ButtonStyle.Success),
        uiBtn(CID.GR_PAUSE, '⏸️ Pause', ButtonStyle.Secondary),
        uiBtn(CID.GR_RESUME, '▶️ Reprendre', ButtonStyle.Secondary),
      ]),
      uiRow(btnHome()),
    ]),
  };
}

export function buildGroupsList() {
  const sum = storeSummary();
  const embed = uiEmbed(UI_COLORS.groups, '📋 Tous les groupes', sum.lines.join('\n') || '_Aucun groupe._');

  return {
    embeds: [embed],
    components: [navBackHome(CID.GROUPS)],
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

  const embed = uiEmbed(
    mode === 'pause' ? UI_COLORS.groups : UI_COLORS.groups,
    mode === 'pause' ? '⏸️ Mettre en pause' : '▶️ Reprendre un groupe',
    options.length
      ? 'Choisis le groupe :'
      : mode === 'pause'
        ? '_Tous les groupes sont déjà actifs._'
        : '_Aucun groupe en pause._',
  );

  const components = [navBackHome(CID.GROUPS)];
  if (options.length) {
    components.unshift(
      new ActionRowBuilder().addComponents(
        new StringSelectMenuBuilder()
          .setCustomId(customId)
          .setPlaceholder(mode === 'pause' ? '⏸️ Groupe à pauser…' : '▶️ Groupe à relancer…')
          .addOptions(options),
      ),
    );
  }

  return { embeds: [embed], components: uiClampRows(components) };
}

export function buildStatusPanel(heliusCount, channelId) {
  const sum = storeSummary();
  const embed = uiEmbed(
    UI_COLORS.home,
    '📡 Statut du bot',
    'État en temps réel du worker et de la configuration.',
    {
      fields: [
        { name: '🤖 Bot', value: '🟢 En ligne', inline: true },
        { name: '👛 Wallets actifs', value: String(sum.activeCount), inline: true },
        { name: '⚡ Clés Helius', value: `${heliusCount}`, inline: true },
        { name: '💬 Salon alertes', value: `<#${channelId}>`, inline: false },
        { name: '📦 Groupes', value: sum.lines.slice(0, 6).join('\n') || '—', inline: false },
      ],
    },
  );

  return {
    embeds: [embed],
    components: uiClampRows([
      uiRow(uiBtn(CID.REFRESH, '🔃 Resync worker', ButtonStyle.Secondary)),
      uiRow(btnHome()),
    ]),
  };
}

export function buildSettingsPanel(heliusCount) {
  const metaMs = process.env.NTFY_META_TIMEOUT_MS || '850';
  const ntfy = (process.env.NTFY_TOPIC || '').trim() ? '🟢 Configuré' : '⚫ Non configuré';
  const embed = uiEmbed(
    UI_COLORS.settings,
    '⚙️ Paramètres & outils',
    [
      'Centre de configuration — chaque section a son propre menu.',
      '',
      `📱 **ntfy (clic → Axiom)** · ${ntfy}`,
      `⚡ **Meta alertes** · ~${metaMs} ms`,
      `🔑 **Helius** · ${heliusCount} clé(s) · WebSocket \`processed\``,
    ].join('\n'),
    {
      footer: 'Notif Windows : clic = Discord · lien Axiom en haut du message',
    },
  );

  return {
    embeds: [embed],
    components: uiClampRows(
      uiRowsPair([
        uiBtn(CID.ALERTS_LIVE, '🔔 Alertes live', ButtonStyle.Primary),
        uiBtn(CID.TRADING, '💹 Trading Jupiter', ButtonStyle.Success),
        uiBtn(CID.SNIPE, '🎯 Sniping', ButtonStyle.Success),
        uiBtn(CID.TEST, '🧪 Test alerte', ButtonStyle.Secondary),
        uiBtn(CID.REFRESH, '🔃 Resync', ButtonStyle.Secondary),
        uiBtn(CID.IMPORT, '📥 Import backup', ButtonStyle.Secondary),
      ]).concat([uiRow(btnHome())]),
    ),
  };
}

export function walletAddModal() {
  return new ModalBuilder()
    .setCustomId(CID.MODAL_WL_ADD)
    .setTitle('➕ Ajouter un wallet')
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
          .setLabel('Groupe (vide = défaut)')
          .setStyle(TextInputStyle.Short)
          .setRequired(false)
          .setPlaceholder('ex. migration 99%'),
      ),
    );
}

export function groupAddModal() {
  return new ModalBuilder()
    .setCustomId(CID.MODAL_GR_ADD)
    .setTitle('✨ Créer un groupe')
    .addComponents(
      new ActionRowBuilder().addComponents(
        new TextInputBuilder()
          .setCustomId('name')
          .setLabel('Nom du groupe')
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
    case CID.SNIPE:
      return 'sniping';
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
