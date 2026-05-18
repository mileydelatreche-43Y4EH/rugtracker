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
  getActiveWallets,
} from '../api/lib/wallet-store.mjs';

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
  TEST: 'bt:test',
  EXPORT: 'bt:export',
  IMPORT: 'bt:import',
  REFRESH: 'bt:refresh',
  SEL_RM_WL: 'bt:sel:rmwl',
  SEL_PAUSE: 'bt:sel:pause',
  SEL_RESUME: 'bt:sel:resume',
  MODAL_WL_ADD: 'bt:modal:wladd',
  MODAL_GR_ADD: 'bt:modal:gradd',
  MODAL_IMPORT: 'bt:modal:import',
};

function btn(id, label, style = ButtonStyle.Secondary, emoji) {
  const b = new ButtonBuilder().setCustomId(id).setLabel(label).setStyle(style);
  if (emoji) b.setEmoji(emoji);
  return b;
}

function row(...buttons) {
  return new ActionRowBuilder().addComponents(...buttons.slice(0, 5));
}

function backHome() {
  return btn(CID.HOME, 'Menu principal', ButtonStyle.Primary, '🏠');
}

export function buildHomePanel(heliusCount) {
  const sum = storeSummary();
  const embed = new EmbedBuilder()
    .setColor(0x7c3aed)
    .setTitle('◈ Bundle Tracker — Panneau de contrôle')
    .setDescription(
      [
        'Utilise les **boutons** ci-dessous pour tout gérer.',
        '',
        `▶ **${sum.activeCount}** wallet(s) surveillé(s)`,
        `📁 **${loadStore().groups.length}** groupe(s)`,
        `🔑 **${heliusCount}** clé(s) Helius`,
      ].join('\n'),
    )
    .setFooter({ text: 'Les alertes d’achat arrivent dans ce salon · achats = messages séparés' })
    .setTimestamp();

  const components = [
    row(
      btn(CID.WALLETS, 'Wallets', ButtonStyle.Primary, '👛'),
      btn(CID.GROUPS, 'Groupes', ButtonStyle.Primary, '📁'),
      btn(CID.STATUS, 'Statut', ButtonStyle.Secondary, '📊'),
    ),
    row(
      btn(CID.TEST, 'Test alerte', ButtonStyle.Success, '🧪'),
      btn(CID.IMPORT, 'Importer JSON', ButtonStyle.Secondary, '📥'),
      btn(CID.EXPORT, 'Exporter', ButtonStyle.Secondary, '💾'),
    ),
    row(btn(CID.REFRESH, 'Actualiser', ButtonStyle.Secondary, '🔄')),
  ];

  return { embeds: [embed], components };
}

export function buildWalletsMenu() {
  const sum = storeSummary();
  const embed = new EmbedBuilder()
    .setColor(0x5865f2)
    .setTitle('👛 Wallets')
    .setDescription(
      `**${sum.activeCount}** wallet(s) actif(s).\nChoisis une action :`,
    );

  return {
    embeds: [embed],
    components: [
      row(
        btn(CID.WL_LIST, 'Voir la liste', ButtonStyle.Secondary, '📋'),
        btn(CID.WL_ADD, 'Ajouter', ButtonStyle.Success, '➕'),
        btn(CID.WL_RM, 'Retirer', ButtonStyle.Danger, '➖'),
      ),
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

  const embed = new EmbedBuilder()
    .setColor(0x5865f2)
    .setTitle('📋 Liste des wallets')
    .setDescription(lines.join('\n\n').slice(0, 4000));

  return {
    embeds: [embed],
    components: [row(btn(CID.WALLETS, '← Wallets', ButtonStyle.Secondary), backHome())],
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

  const embed = new EmbedBuilder()
    .setColor(0xed4245)
    .setTitle('➖ Retirer un wallet')
    .setDescription(
      options.length
        ? 'Sélectionne le wallet à retirer :'
        : '_Aucun wallet à retirer._',
    );

  const components = [row(backHome())];
  if (options.length) {
    components.unshift(
      new ActionRowBuilder().addComponents(
        new StringSelectMenuBuilder()
          .setCustomId(CID.SEL_RM_WL)
          .setPlaceholder('Choisir un wallet…')
          .addOptions(options),
      ),
    );
  }

  return { embeds: [embed], components };
}

export function buildGroupsMenu() {
  const embed = new EmbedBuilder()
    .setColor(0x57f287)
    .setTitle('📁 Groupes')
    .setDescription('Organise tes wallets par groupe.');

  return {
    embeds: [embed],
    components: [
      row(
        btn(CID.GR_LIST, 'Voir la liste', ButtonStyle.Secondary, '📋'),
        btn(CID.GR_ADD, 'Créer', ButtonStyle.Success, '➕'),
        btn(CID.GR_PAUSE, 'Pause', ButtonStyle.Secondary, '⏸'),
      ),
      row(btn(CID.GR_RESUME, 'Reprendre', ButtonStyle.Success, '▶'), backHome()),
    ],
  };
}

export function buildGroupsList() {
  const sum = storeSummary();
  const embed = new EmbedBuilder()
    .setColor(0x57f287)
    .setTitle('📋 Groupes')
    .setDescription(sum.lines.join('\n') || '_Aucun groupe._');

  return {
    embeds: [embed],
    components: [row(btn(CID.GROUPS, '← Groupes', ButtonStyle.Secondary), backHome())],
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

  const embed = new EmbedBuilder()
    .setColor(mode === 'pause' ? 0xfaa61a : 0x57f287)
    .setTitle(mode === 'pause' ? '⏸ Mettre en pause' : '▶ Réactiver')
    .setDescription(
      options.length
        ? 'Sélectionne un groupe :'
        : mode === 'pause'
          ? '_Tous les groupes sont déjà en pause._'
          : '_Aucun groupe en pause._',
    );

  const components = [row(backHome())];
  if (options.length) {
    components.unshift(
      new ActionRowBuilder().addComponents(
        new StringSelectMenuBuilder()
          .setCustomId(customId)
          .setPlaceholder('Choisir un groupe…')
          .addOptions(options),
      ),
    );
  }

  return { embeds: [embed], components };
}

export function buildStatusPanel(heliusCount, channelId) {
  const sum = storeSummary();
  const embed = new EmbedBuilder()
    .setColor(0x95a5a6)
    .setTitle('📊 Statut')
    .addFields(
      { name: 'Bot', value: '🟢 En ligne', inline: true },
      { name: 'Wallets actifs', value: String(sum.activeCount), inline: true },
      { name: 'Helius', value: `${heliusCount} clé(s)`, inline: true },
      { name: 'Salon', value: `<#${channelId}>`, inline: false },
    )
    .setDescription(sum.lines.join('\n') || '_Aucun groupe._');

  return {
    embeds: [embed],
    components: [row(backHome())],
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
          .setRequired(true)
          .setPlaceholder('2WHHnAmD…'),
      ),
      new ActionRowBuilder().addComponents(
        new TextInputBuilder()
          .setCustomId('label')
          .setLabel('Nom affiché')
          .setStyle(TextInputStyle.Short)
          .setRequired(true)
          .setPlaceholder('Bundle 4'),
      ),
      new ActionRowBuilder().addComponents(
        new TextInputBuilder()
          .setCustomId('group')
          .setLabel('Groupe (nom ou vide = défaut)')
          .setStyle(TextInputStyle.Short)
          .setRequired(false)
          .setPlaceholder('Bundles'),
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

export function importModal() {
  return new ModalBuilder()
    .setCustomId(CID.MODAL_IMPORT)
    .setTitle('Importer backup JSON')
    .addComponents(
      new ActionRowBuilder().addComponents(
        new TextInputBuilder()
          .setCustomId('json')
          .setLabel('Colle le JSON (export site)')
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
    case CID.REFRESH:
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
    default:
      return null;
  }
}

export function renderScreen(screen, ctx) {
  switch (screen) {
    case 'home':
      return buildHomePanel(ctx.heliusCount);
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
    default:
      return buildHomePanel(ctx.heliusCount);
  }
}
