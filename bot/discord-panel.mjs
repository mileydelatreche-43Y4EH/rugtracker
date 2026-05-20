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
import { isCloudPersistEnabled } from '../api/lib/cloud-persist.mjs';
import { loadStore, storeSummary } from '../api/lib/wallet-store.mjs';
import { buildAlertsLivePanel } from './discord-alerts-panel.mjs';
import {
  UI_COLORS,
  ICO,
  L,
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
  TEST: 'bt:test',
  EXPORT: 'bt:export',
  IMPORT: 'bt:import',
  REFRESH: 'bt:refresh',
  SEL_RM_WL: 'bt:sel:rmwl',
  SEL_PAUSE: 'bt:sel:pause',
  SEL_RESUME: 'bt:sel:resume',
  MODAL_WL_ADD: 'bt:modal:wladd',
  MODAL_GR_ADD: 'bt:modal:gradd',
};

export function buildHomePanel(ctx = {}) {
  const sum = storeSummary();
  const heliusCount = ctx.heliusCount ?? 0;
  const channelId = String(ctx.channelId || '').trim();
  const embed = uiEmbed(
    UI_COLORS.home,
    L(ICO.status, 'Statut du bot'),
    'État en temps réel du worker et de la configuration.',
    {
      fields: [
        { name: '🤖 Bot', value: `${ICO.on} En ligne`, inline: true },
        { name: L(ICO.wallets, 'Actifs'), value: String(sum.activeCount), inline: true },
        { name: '⚡ Helius', value: `${heliusCount} clé(s)`, inline: true },
        { name: '💬 Salon', value: channelId ? `<#${channelId}>` : '—', inline: false },
        {
          name: L(ICO.groups, 'Groupes'),
          value: sum.lines.join('\n').slice(0, 1024) || '—',
          inline: false,
        },
      ],
    },
  );

  return {
    embeds: [embed],
    components: uiClampRows(
      uiRowsPair([
        uiBtn(CID.WALLETS, L(ICO.wallets, 'Wallets'), ButtonStyle.Primary),
        uiBtn(CID.SETTINGS, L(ICO.settings, 'Paramètres'), ButtonStyle.Secondary),
      ]),
    ),
  };
}

export function buildWalletsMenu() {
  const sum = storeSummary();
  const store = loadStore();
  const embed = uiEmbed(
    UI_COLORS.wallets,
    L(ICO.wallets, 'Wallets & groupes'),
    [
      `**${sum.activeCount}** wallet(s) actif(s) · **${store.groups.length}** groupe(s)`,
      '',
      '**Wallets** — liste, ajout, retrait',
      '**Groupes** — liste, créer, pause / reprise',
      '**Backup** — import / export `.json`',
    ].join('\n'),
    { footer: 'Groupe en pause = pas d’alerte pour ses wallets' },
  );

  return {
    embeds: [embed],
    components: uiClampRows([
      ...uiRowsPair([
        uiBtn(CID.WL_LIST, L(ICO.list, 'Liste wallets'), ButtonStyle.Secondary),
        uiBtn(CID.WL_ADD, L(ICO.add, 'Ajouter wallet'), ButtonStyle.Success),
        uiBtn(CID.WL_RM, L(ICO.remove, 'Retirer'), ButtonStyle.Danger),
        uiBtn(CID.GR_LIST, L(ICO.list, 'Liste groupes'), ButtonStyle.Secondary),
        uiBtn(CID.GR_ADD, L(ICO.create, 'Créer groupe'), ButtonStyle.Success),
        uiBtn(CID.GR_PAUSE, L(ICO.pause, 'Pause'), ButtonStyle.Secondary),
        uiBtn(CID.GR_RESUME, L(ICO.resume, 'Reprendre'), ButtonStyle.Secondary),
        uiBtn(CID.IMPORT, L(ICO.import, 'Import .json'), ButtonStyle.Secondary),
      ]),
      uiRow(
        uiBtn(CID.EXPORT, L(ICO.export, 'Export .json'), ButtonStyle.Secondary),
        uiBtn(CID.HOME, L(ICO.home, 'Menu'), ButtonStyle.Primary),
      ),
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

  const embed = uiEmbed(
    UI_COLORS.wallets,
    L(ICO.list, 'Liste des wallets'),
    lines.join('\n\n').slice(0, 4000),
  );

  return {
    embeds: [embed],
    components: [navBackHome(CID.WALLETS, 'Wallets')],
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
    L(ICO.remove, 'Retirer un wallet'),
    options.length ? 'Sélectionne le wallet à supprimer :' : '_Aucun wallet enregistré._',
  );

  const components = [navBackHome(CID.WALLETS, 'Wallets')];
  if (options.length) {
    components.unshift(
      new ActionRowBuilder().addComponents(
        new StringSelectMenuBuilder()
          .setCustomId(CID.SEL_RM_WL)
          .setPlaceholder(`${ICO.remove} Choisir…`)
          .addOptions(options),
      ),
    );
  }

  return { embeds: [embed], components: uiClampRows(components) };
}

export function buildGroupsList() {
  const sum = storeSummary();
  const embed = uiEmbed(
    UI_COLORS.groups,
    L(ICO.list, 'Tous les groupes'),
    sum.lines.join('\n') || '_Aucun groupe._',
  );

  return {
    embeds: [embed],
    components: [navBackHome(CID.WALLETS, 'Wallets')],
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
    UI_COLORS.groups,
    mode === 'pause' ? L(ICO.pause, 'Pause groupe') : L(ICO.resume, 'Reprendre groupe'),
    options.length
      ? 'Choisis le groupe :'
      : mode === 'pause'
        ? '_Tous les groupes sont déjà actifs._'
        : '_Aucun groupe en pause._',
  );

  const components = [navBackHome(CID.WALLETS, 'Wallets')];
  if (options.length) {
    components.unshift(
      new ActionRowBuilder().addComponents(
        new StringSelectMenuBuilder()
          .setCustomId(customId)
          .setPlaceholder(
            mode === 'pause' ? `${ICO.pause} Groupe à pauser…` : `${ICO.resume} Groupe à relancer…`,
          )
          .addOptions(options),
      ),
    );
  }

  return { embeds: [embed], components: uiClampRows(components) };
}

export function buildSettingsPanel(heliusCount) {
  const ntfyOn = !!(process.env.NTFY_TOPIC || '').trim();
  const cloudOn = isCloudPersistEnabled();
  const embed = uiEmbed(
    UI_COLORS.settings,
    L(ICO.settings, 'Paramètres'),
    [
      `${ntfyOn ? ICO.on : ICO.off} **Notifs téléphone** (ntfy)`,
      `${heliusCount > 0 ? ICO.on : ICO.off} **Helius** — ${heliusCount} clé(s)`,
      `${cloudOn ? ICO.on : ICO.off} **Sauvegarde cloud** (Redis)`,
    ].join('\n'),
    { timestamp: false },
  );

  return {
    embeds: [embed],
    components: uiClampRows(
      uiRowsPair([
        uiBtn(CID.TEST, L(ICO.test, 'Test alerte'), ButtonStyle.Secondary),
        uiBtn(CID.REFRESH, L(ICO.resync, 'Resync'), ButtonStyle.Secondary),
      ]).concat([uiRow(btnHome())]),
    ),
  };
}

export function walletAddModal() {
  return new ModalBuilder()
    .setCustomId(CID.MODAL_WL_ADD)
    .setTitle(`${ICO.add} Ajouter un wallet`)
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
    .setTitle(`${ICO.create} Créer un groupe`)
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
    case CID.WALLETS:
      return 'wallets';
    case CID.WL_LIST:
      return 'wl_list';
    case CID.WL_RM:
      return 'wl_rm';
    case CID.GROUPS:
      return 'wallets';
    case CID.GR_LIST:
      return 'gr_list';
    case CID.GR_PAUSE:
      return 'gr_pause';
    case CID.GR_RESUME:
      return 'gr_resume';
    case CID.STATUS:
      return 'home';
    case CID.SETTINGS:
      return 'settings';
    case CID.ALERTS_LIVE:
      return 'alerts_live';
    default:
      return null;
  }
}

export async function renderScreen(screen, ctx) {
  switch (screen) {
    case 'home':
      return buildHomePanel(ctx);
    case 'wallets':
      return buildWalletsMenu();
    case 'wl_list':
      return buildWalletsList();
    case 'wl_rm':
      return buildWalletRemoveSelect();
    case 'groups':
      return buildWalletsMenu();
    case 'gr_list':
      return buildGroupsList();
    case 'gr_pause':
      return buildGroupSelect(CID.SEL_PAUSE, 'pause');
    case 'gr_resume':
      return buildGroupSelect(CID.SEL_RESUME, 'resume');
    case 'settings':
      return buildSettingsPanel(ctx.heliusCount);
    case 'alerts_live':
      return buildAlertsLivePanel(0);
    default:
      return buildHomePanel(ctx);
  }
}
