/**
 * Bot Discord — panneau boutons uniquement (pas de commandes slash).
 */
import { readFileSync, existsSync } from 'fs';
import { Client, GatewayIntentBits, REST, Routes } from 'discord.js';
import {
  buildBuyLinks,
  sendDiscordBuyAlert,
  COPY_CA_PREFIX,
  ALERT_MENU_PREFIX,
  ALERT_BOT_HOME,
} from '../api/lib/discord-alert.mjs';
import { fetchTokenMetaFast } from '../api/lib/token-meta.mjs';
import { axiomTradeUrl } from '../api/lib/axiom.mjs';
import { startCopyCaServer } from '../api/lib/copy-ca-server.mjs';
import { getCopyCaPublicBase } from '../api/lib/copy-ca-url.mjs';
import { silentMessage } from '../api/lib/discord-silent.mjs';
import { notifyBuyAlert } from '../api/lib/notify-buy.mjs';
import {
  addWallet,
  removeWallet,
  addGroup,
  setGroupActive,
  storeSummary,
  getActiveWallets,
  loadStore,
  findGroup,
} from '../api/lib/wallet-store.mjs';
import { createBundleWorker } from '../worker/bundle-worker.mjs';
import { ensureRailwayDataDir } from '../api/lib/data-paths.mjs';
import {
  hydrateFromCloud,
  flushCloudPersist,
  logWalletStoreStatus,
} from '../api/lib/cloud-persist.mjs';
import {
  CID,
  renderScreen,
  resolveScreen,
  walletAddModal,
  groupAddModal,
  exportAttachment,
  buildHomePanel,
  buildWalletRemoveSelect,
} from './discord-panel.mjs';
import {
  dismissEphemeral,
  showEphemeralError,
  showEphemeralFollowUp,
  replyEphemeralBrief,
  editEphemeralBrief,
  scheduleEphemeralDismiss,
  safePanelUpdate,
  isUnknownInteraction,
} from './discord-ui.mjs';
import {
  handleAlertsPanelButton,
  isAlertsPanelId,
} from './discord-alerts-handlers.mjs';
import { startJsonFileImport, importJsonAttachment } from './discord-import.mjs';

function loadEnvFile() {
  const p = new URL('../.env', import.meta.url);
  if (!existsSync(p)) return;
  for (const line of readFileSync(p, 'utf8').split('\n')) {
    const t = line.trim();
    if (!t || t.startsWith('#')) continue;
    const i = t.indexOf('=');
    if (i < 0) continue;
    const k = t.slice(0, i).trim();
    let v = t.slice(i + 1).trim();
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) {
      v = v.slice(1, -1);
    }
    if (!process.env[k]) process.env[k] = v;
  }
}

function parseHeliusKeys() {
  const raw = process.env.HELIUS_API_KEYS || process.env.HELIUS_API_KEY || '';
  const keys = String(raw)
    .split(/[,;\s]+/)
    .map(s => {
      let k = s.trim();
      if (k.includes('api-key=')) k = k.split('api-key=').pop().split('&')[0].trim();
      return k;
    })
    .filter(k => k.length > 10 && !k.includes('helius-rpc.com'));
  return [...new Set(keys)];
}

function isAdmin(userId) {
  const ids = String(process.env.DISCORD_ADMIN_IDS || '')
    .split(/[,;\s]+/)
    .map(s => s.trim())
    .filter(Boolean);
  if (!ids.length) return true;
  return ids.includes(String(userId));
}

loadEnvFile();

const TOKEN = (process.env.DISCORD_BOT_TOKEN || '').trim();
const CLIENT_ID = (process.env.DISCORD_CLIENT_ID || process.env.DISCORD_APPLICATION_ID || '').trim();
const GUILD_ID = (process.env.DISCORD_GUILD_ID || '').trim();
const CHANNEL_ID = (process.env.DISCORD_CHANNEL_ID || '').trim();
const PANEL_MESSAGE_ID = (process.env.PANEL_MESSAGE_ID || '').trim();
const HELIUS_KEYS = parseHeliusKeys();

if (!TOKEN || !CLIENT_ID || !CHANNEL_ID) {
  console.error('Requis : DISCORD_BOT_TOKEN, DISCORD_CLIENT_ID, DISCORD_CHANNEL_ID, HELIUS_API_KEYS');
  process.exit(1);
}
if (!HELIUS_KEYS.length) process.exit(1);

ensureRailwayDataDir();
await hydrateFromCloud();
loadStore();
await logWalletStoreStatus();

const uiCtx = () => ({ heliusCount: HELIUS_KEYS.length, channelId: CHANNEL_ID });

// Uniquement Guilds — pas de Message Content (évite "Used disallowed intents" sans config portail Discord).
const client = new Client({ intents: [GatewayIntentBits.Guilds] });
let alertChannel = null;
let panelMessage = null;
let notifyCtx = { discordChannel: null, ntfyTopic: '' };
let workerHandle = null;

async function registerSlashCommands() {
  const rest = new REST({ version: '10' }).setToken(TOKEN);
  const commands = [
    { name: 'menu', description: 'Ouvre le menu principal du bot' },
    {
      name: 'import',
      description: 'Importer un backup .json (export site ou bot)',
      options: [
        {
          name: 'fichier',
          description: 'wallets-export.json ou bundle-tracker-backup.json',
          type: 11,
          required: true,
        },
      ],
    },
  ];
  try {
    if (GUILD_ID) {
      await rest.put(Routes.applicationGuildCommands(CLIENT_ID, GUILD_ID), { body: commands });
      await rest.put(Routes.applicationCommands(CLIENT_ID), { body: [] });
    } else {
      await rest.put(Routes.applicationCommands(CLIENT_ID), { body: commands });
    }
    console.log('✅ Commandes /menu et /import enregistrées');
  } catch (e) {
    console.warn('Slash register', e.message || e);
  }
}

async function updatePanel(screen = 'home') {
  if (!panelMessage) return;
  const payload = await renderScreen(screen, uiCtx());
  await panelMessage.edit(silentMessage(payload));
}

async function sendTestAlert() {
  if (!alertChannel?.send) throw new Error('Canal alertes non prêt — attends que le bot soit connecté.');

  const w = getActiveWallets()[0] || {
    addr: '11111111111111111111111111111111',
    label: 'Test',
    groupName: 'Demo',
    groupEmoji: '🧪',
    groupColor: 0x7c3aed,
  };
  const hit = { mint: '7GCihgDB8fe6KNjn2MYtkzZcRjQy3t9GHdC8uHYmW2hr', sol: 0.1, venue: 'curve' };

  let meta = {
    sym: 'POPCAT',
    name: 'Popcat',
    imageUrl:
      'https://dd.dexscreener.com/ds-data/tokens/solana/7GCihgDB8fe6KNjn2MYtkzZcRjQy3t9GHdC8uHYmW2hr.png',
    mcUsd: 42000,
    pairAddress: '',
    snap: {},
  };

  if (workerHandle?.rpcCall) {
    try {
      meta = await Promise.race([
        fetchTokenMetaFast(hit.mint, workerHandle.rpcCall, 0),
        new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), 3000)),
      ]);
    } catch {
      /* garde meta de secours */
    }
  }

  const axiomUrl = await axiomTradeUrl(hit.mint, meta.pairAddress).catch(() => '');
  await sendDiscordBuyAlert(alertChannel, { w, hit, meta, sig: '', axiomUrl });
}

async function deny(interaction) {
  if (interaction.replied || interaction.deferred) return;
  await replyEphemeralBrief(interaction, '⛔ Seuls les admins du bot peuvent utiliser ce panneau.');
}

async function handleButton(interaction) {
  const id = interaction.customId;

  if (isAlertsPanelId(id)) {
    if (await handleAlertsPanelButton(interaction)) return;
  }

  if (id === CID.WL_ADD) {
    await interaction.showModal(walletAddModal());
    return;
  }
  if (id === CID.GR_ADD) {
    await interaction.showModal(groupAddModal());
    return;
  }
  if (id === CID.IMPORT) {
    await startJsonFileImport(interaction);
    return;
  }

  if (id === CID.TEST) {
    await replyEphemeralBrief(interaction, '🧪 Alerte test envoyée dans le salon');
    void sendTestAlert().catch(e => console.error('Test alerte', e.message || e));
    return;
  }

  if (id === CID.EXPORT) {
    await interaction.reply({
      content: '💾 Export de la config :',
      files: [exportAttachment()],
      ephemeral: true,
    });
    scheduleEphemeralDismiss(interaction);
    return;
  }

  if (id === CID.REFRESH) {
    if (workerHandle) void workerHandle.resync();
    await safePanelUpdate(interaction, renderScreen('settings', uiCtx()));
    return;
  }

  const screen = resolveScreen(id);
  if (screen) {
    await safePanelUpdate(interaction, renderScreen(screen, uiCtx()));
  }
}

async function handleSelect(interaction) {
  const id = interaction.customId;
  const value = interaction.values[0];

  if (id === CID.SEL_RM_WL) {
    removeWallet(value);
    await safePanelUpdate(interaction, buildWalletRemoveSelect());
    return;
  }

  if (id === CID.SEL_PAUSE) {
    setGroupActive(value, false);
    await safePanelUpdate(interaction, renderScreen('gr_pause', uiCtx()));
    return;
  }

  if (id === CID.SEL_RESUME) {
    setGroupActive(value, true);
    await safePanelUpdate(interaction, renderScreen('gr_resume', uiCtx()));
  }
}

async function handleModal(interaction) {
  await interaction.deferReply({ ephemeral: true });

  try {
    if (interaction.customId === CID.MODAL_WL_ADD) {
      const addr = interaction.fields.getTextInputValue('addr').trim();
      const label = interaction.fields.getTextInputValue('label').trim();
      const group = interaction.fields.getTextInputValue('group').trim();
      if (!label) throw new Error('Nom affiché obligatoire.');
      addWallet(addr, label, group || undefined);
      void updatePanel('wallets').catch(e => console.warn('updatePanel', e.message));
      await dismissEphemeral(interaction);
      return;
    }

    if (interaction.customId === CID.MODAL_GR_ADD) {
      const name = interaction.fields.getTextInputValue('name').trim();
      const emoji = interaction.fields.getTextInputValue('emoji').trim() || '🎯';
      if (!name) throw new Error('Nom du groupe obligatoire.');
      addGroup(name, emoji);
      void updatePanel('groups').catch(() => {});
      await dismissEphemeral(interaction);
      return;
    }

  } catch (e) {
    await showEphemeralError(interaction, e.message || String(e));
  }
}

async function handleInteraction(interaction) {
  if (
    interaction.isButton() &&
    (interaction.customId === ALERT_BOT_HOME ||
      interaction.customId?.startsWith(ALERT_MENU_PREFIX))
  ) {
    if (!isAdmin(interaction.user.id)) {
      await deny(interaction);
      return;
    }
    void updatePanel('home');
    await interaction.reply({
      ...(await buildHomePanel(uiCtx())),
      ephemeral: true,
    });
    return;
  }

  if (interaction.isButton() && interaction.customId?.startsWith(COPY_CA_PREFIX)) {
    const mint = interaction.customId.slice(COPY_CA_PREFIX.length);
    const base = getCopyCaPublicBase();
    await replyEphemeralBrief(
      interaction,
      base
        ? `Ouvre **Copier CA** (lien) pour coller auto.\nOu : \`${mint}\``
        : `Configure **COPY_CA_PUBLIC_URL** ou un domaine Railway public.\n\`${mint}\``,
    );
    return;
  }

  if (interaction.isChatInputCommand()) {
    if (!isAdmin(interaction.user.id)) {
      await deny(interaction);
      return;
    }
    if (interaction.commandName === 'menu') {
      void updatePanel('home');
      await interaction.reply({
        ...(await buildHomePanel(uiCtx())),
        ephemeral: true,
      });
      return;
    }
    if (interaction.commandName === 'import') {
      const att = interaction.options.getAttachment('fichier', true);
      await interaction.deferReply({ ephemeral: true });
      try {
        const r = await importJsonAttachment(att);
        if (workerHandle) void workerHandle.resync();
        void updatePanel('home');
        const cloudOk = await flushCloudPersist();
        await editEphemeralBrief(
          interaction,
          `✅ **Import OK** · \`${r.fileName}\`\n` +
            `**${r.wallets}** wallet(s) · **${r.groups}** groupe(s) · **${r.active}** actif(s) pour les alertes.\n` +
            (cloudOk
              ? '☁ **Sauvegardé dans Redis** — survive au redeploy.'
              : '⚠ **Redis non sauvegardé** — ajoute `REDIS_URL` + `CLOUD_SYNC_SECRET` sur Railway.'),
        );
      } catch (e) {
        await editEphemeralBrief(interaction, `❌ Import : ${e.message || e}`);
      }
      return;
    }
    return;
  }

  const isPanel =
    interaction.isButton() ||
    interaction.isStringSelectMenu() ||
    interaction.isModalSubmit();

  if (!isPanel) return;

  if (!isAdmin(interaction.user.id)) {
    await deny(interaction);
    return;
  }

  try {
    if (interaction.isButton()) await handleButton(interaction);
    else if (interaction.isStringSelectMenu()) await handleSelect(interaction);
    else if (interaction.isModalSubmit()) await handleModal(interaction);
  } catch (e) {
    if (isUnknownInteraction(e)) return;
    const msg = e.message || String(e);
    if (interaction.isModalSubmit()) {
      await showEphemeralError(interaction, msg);
    } else if (interaction.isButton() || interaction.isStringSelectMenu()) {
      await showEphemeralFollowUp(interaction, msg);
    }
  }
}

async function setupPanel() {
  const payload = await buildHomePanel(uiCtx());

  if (PANEL_MESSAGE_ID) {
    try {
      panelMessage = await alertChannel.messages.fetch(PANEL_MESSAGE_ID);
      await panelMessage.edit(silentMessage(payload));
      console.log(`✅ Panneau mis à jour (message ${PANEL_MESSAGE_ID})`);
      return;
    } catch {
      console.warn('PANEL_MESSAGE_ID introuvable — nouveau panneau créé');
    }
  }

  panelMessage = await alertChannel.send(silentMessage(payload));
  try {
    await panelMessage.pin();
  } catch {
    console.warn('Impossible d’épingler le panneau (permissions ?)');
  }
  console.log('');
  console.log('  📌 Panneau de contrôle envoyé.');
  console.log(`  Optionnel : PANEL_MESSAGE_ID=${panelMessage.id} dans .env`);
  console.log('');
}

client.once('ready', async () => {
  console.log(`🤖 Discord connecté : ${client.user.tag}`);
  await logWalletStoreStatus();

  await registerSlashCommands();

  alertChannel = await client.channels.fetch(CHANNEL_ID);
  if (!alertChannel?.isTextBased()) {
    console.error('DISCORD_CHANNEL_ID invalide');
    process.exit(1);
  }

  notifyCtx.discordChannel = alertChannel;
  notifyCtx.ntfyTopic = (process.env.NTFY_TOPIC || '').trim();
  if (notifyCtx.ntfyTopic) {
    console.log(`📱 ntfy actif (topic configuré) — clic notif → Axiom`);
  }

  const worker = createBundleWorker({
    heliusKeys: HELIUS_KEYS,
    onBuy: async (w, hit, { sig, rpcCall, walletIndex, detectedAt }) => {
      await notifyBuyAlert(notifyCtx, w, hit, sig, rpcCall, walletIndex, { detectedAt });
    },
  });
  workerHandle = await worker.start();

  await setupPanel();

  console.log('  Bot prêt — contrôle via boutons du panneau épinglé.');
});

client.on('interactionCreate', interaction => {
  void handleInteraction(interaction);
});

startCopyCaServer();

console.log(`Bundle Tracker · ${HELIUS_KEYS.length} clé(s) Helius · salon ${CHANNEL_ID}`);
console.log('🔌 Intents Discord : Guilds uniquement (import via /import)');
console.log('📦 Build cloud-redis — cherche ☁ REDIS_URL dans les logs ci-dessous');
const copyBase = getCopyCaPublicBase();
if (copyBase) console.log(`📋 Copier CA 1 clic · ${copyBase}/copy?m=…`);
else console.warn('📋 Copier CA : active un domaine public Railway (ou COPY_CA_PUBLIC_URL)');

await client.login(TOKEN);
