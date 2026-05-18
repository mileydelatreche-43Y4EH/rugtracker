/**
 * Bot Discord — panneau boutons uniquement (pas de commandes slash).
 */
import { readFileSync, existsSync } from 'fs';
import { Client, GatewayIntentBits, REST, Routes } from 'discord.js';
import { buildBuyEmbed, buildBuyButtons, buildBuyLinks } from '../api/lib/discord-alert.mjs';
import { notifyBuyAlert } from '../api/lib/notify-buy.mjs';
import {
  addWallet,
  removeWallet,
  addGroup,
  setGroupActive,
  importBackup,
  storeSummary,
  getActiveWallets,
  loadStore,
} from '../api/lib/wallet-store.mjs';
import { createBundleWorker } from '../worker/bundle-worker.mjs';
import {
  CID,
  renderScreen,
  resolveScreen,
  walletAddModal,
  groupAddModal,
  importModal,
  exportAttachment,
  buildHomePanel,
  buildWalletRemoveSelect,
} from './discord-panel.mjs';

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

loadStore();

const uiCtx = () => ({ heliusCount: HELIUS_KEYS.length, channelId: CHANNEL_ID });

const client = new Client({ intents: [GatewayIntentBits.Guilds] });
let alertChannel = null;
let panelMessage = null;
let notifyCtx = { discordChannel: null, ntfyTopic: '' };
let workerHandle = null;

async function clearSlashCommands() {
  const rest = new REST({ version: '10' }).setToken(TOKEN);
  try {
    if (GUILD_ID) {
      await rest.put(Routes.applicationGuildCommands(CLIENT_ID, GUILD_ID), { body: [] });
    }
    await rest.put(Routes.applicationCommands(CLIENT_ID), { body: [] });
    console.log('✅ Commandes slash supprimées (interface boutons uniquement)');
  } catch (e) {
    console.warn('Slash clear', e.message || e);
  }
}

async function updatePanel(screen = 'home') {
  if (!panelMessage) return;
  const payload = renderScreen(screen, uiCtx());
  await panelMessage.edit(payload);
}

async function sendTestAlert() {
  const w = getActiveWallets()[0] || {
    addr: '11111111111111111111111111111111',
    label: 'Test',
    groupName: 'Demo',
    groupEmoji: '🧪',
  };
  const hit = { mint: '7GCihgDB8fe6KNjn2MYtkzZcRjQy3t9GHdC8uHYmW2hr', sol: 0.1, venue: 'curve' };
  const meta = { sym: 'TEST', mcUsd: 42000, pairAddress: '', snap: { risk: 'MEDIUM' } };
  const links = buildBuyLinks(hit.mint, '', 'https://axiom.trade/?chain=sol');
  await alertChannel.send({
    embeds: [buildBuyEmbed({ w, hit, meta, sig: '' })],
    components: buildBuyButtons(links),
  });
}

async function deny(interaction) {
  if (interaction.replied || interaction.deferred) return;
  await interaction.reply({
    content: '⛔ Seuls les admins du bot peuvent utiliser ce panneau.',
    ephemeral: true,
  });
}

async function handleButton(interaction) {
  const id = interaction.customId;

  if (id === CID.WL_ADD) {
    await interaction.showModal(walletAddModal());
    return;
  }
  if (id === CID.GR_ADD) {
    await interaction.showModal(groupAddModal());
    return;
  }
  if (id === CID.IMPORT) {
    await interaction.showModal(importModal());
    return;
  }

  if (id === CID.TEST) {
    await interaction.deferUpdate();
    await sendTestAlert();
    await interaction.followUp({ content: '✅ Alerte test envoyée ci-dessus.', ephemeral: true });
    return;
  }

  if (id === CID.EXPORT) {
    await interaction.reply({
      content: '💾 Export de la config :',
      files: [exportAttachment()],
      ephemeral: true,
    });
    return;
  }

  if (id === CID.REFRESH) {
    if (workerHandle) await workerHandle.resync();
    const screen = resolveScreen(CID.HOME);
    await interaction.update(renderScreen(screen, uiCtx()));
    await interaction.followUp({ content: '🔄 Surveillance actualisée.', ephemeral: true });
    return;
  }

  const screen = resolveScreen(id);
  if (screen) {
    await interaction.update(renderScreen(screen, uiCtx()));
  }
}

async function handleSelect(interaction) {
  const id = interaction.customId;
  const value = interaction.values[0];

  if (id === CID.SEL_RM_WL) {
    removeWallet(value);
    if (workerHandle) await workerHandle.resync();
    await interaction.update(buildWalletRemoveSelect());
    await interaction.followUp({
      content: `🗑 Wallet retiré : \`${value.slice(0, 8)}…\``,
      ephemeral: true,
    });
    return;
  }

  if (id === CID.SEL_PAUSE) {
    const g = loadStore().groups.find(x => x.id === value);
    setGroupActive(value, false);
    if (workerHandle) await workerHandle.resync();
    await interaction.update(renderScreen('gr_pause', uiCtx()));
    await interaction.followUp({
      content: `⏸ Groupe **${g?.name || value}** en pause.`,
      ephemeral: true,
    });
    return;
  }

  if (id === CID.SEL_RESUME) {
    const g = loadStore().groups.find(x => x.id === value);
    setGroupActive(value, true);
    if (workerHandle) await workerHandle.resync();
    await interaction.update(renderScreen('gr_resume', uiCtx()));
    await interaction.followUp({
      content: `▶ Groupe **${g?.name || value}** actif.`,
      ephemeral: true,
    });
  }
}

async function handleModal(interaction) {
  if (interaction.customId === CID.MODAL_WL_ADD) {
    const addr = interaction.fields.getTextInputValue('addr').trim();
    const label = interaction.fields.getTextInputValue('label').trim();
    const group = interaction.fields.getTextInputValue('group').trim();
    addWallet(addr, label, group || undefined);
    if (workerHandle) await workerHandle.resync();
    await interaction.reply({
      content: `✅ **${label}** ajouté (\`${addr.slice(0, 8)}…\`).`,
      ephemeral: true,
    });
    await updatePanel('wallets');
    return;
  }

  if (interaction.customId === CID.MODAL_GR_ADD) {
    const name = interaction.fields.getTextInputValue('name').trim();
    const emoji = interaction.fields.getTextInputValue('emoji').trim() || '🎯';
    addGroup(name, emoji);
    await interaction.reply({ content: `✅ Groupe **${name}** créé.`, ephemeral: true });
    await updatePanel('groups');
    return;
  }

  if (interaction.customId === CID.MODAL_IMPORT) {
    const raw = interaction.fields.getTextInputValue('json').trim();
    const data = JSON.parse(raw);
    const payload = data.groups ? data : { groups: data };
    importBackup(payload);
    if (workerHandle) await workerHandle.resync();
    const sum = storeSummary();
    await interaction.reply({
      content: `✅ Import OK — **${sum.activeCount}** wallet(s) actif(s).`,
      ephemeral: true,
    });
    await updatePanel('home');
  }
}

async function handleInteraction(interaction) {
  if (interaction.isChatInputCommand()) {
    await interaction.reply({
      content: 'ℹ️ Utilise le **panneau de contrôle** (message épinglé avec boutons), pas les commandes `/`.',
      ephemeral: true,
    });
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
    const msg = e.message || String(e);
    if (interaction.isModalSubmit() && !interaction.replied) {
      await interaction.reply({ content: `❌ ${msg}`, ephemeral: true }).catch(() => {});
    } else if (interaction.isButton() || interaction.isStringSelectMenu()) {
      await interaction
        .followUp({ content: `❌ ${msg}`, ephemeral: true })
        .catch(() => interaction.reply({ content: `❌ ${msg}`, ephemeral: true }).catch(() => {}));
    }
  }
}

async function setupPanel() {
  const payload = buildHomePanel(HELIUS_KEYS.length);

  if (PANEL_MESSAGE_ID) {
    try {
      panelMessage = await alertChannel.messages.fetch(PANEL_MESSAGE_ID);
      await panelMessage.edit(payload);
      console.log(`✅ Panneau mis à jour (message ${PANEL_MESSAGE_ID})`);
      return;
    } catch {
      console.warn('PANEL_MESSAGE_ID introuvable — nouveau panneau créé');
    }
  }

  panelMessage = await alertChannel.send(payload);
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

  await clearSlashCommands();

  alertChannel = await client.channels.fetch(CHANNEL_ID);
  if (!alertChannel?.isTextBased()) {
    console.error('DISCORD_CHANNEL_ID invalide');
    process.exit(1);
  }

  notifyCtx.discordChannel = alertChannel;

  const worker = createBundleWorker({
    heliusKeys: HELIUS_KEYS,
    onBuy: async (w, hit, { sig, rpcCall, walletIndex }) => {
      await notifyBuyAlert(notifyCtx, w, hit, sig, rpcCall, walletIndex);
    },
  });
  workerHandle = await worker.start();

  await setupPanel();

  console.log('  Bot prêt — contrôle via boutons du panneau épinglé.');
});

client.on('interactionCreate', interaction => {
  void handleInteraction(interaction);
});

console.log(`Bundle Tracker · ${HELIUS_KEYS.length} clé(s) Helius · salon ${CHANNEL_ID}`);

await client.login(TOKEN);
