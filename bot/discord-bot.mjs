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
import { notifyBuyAlert, notifySellAlert } from '../api/lib/notify-buy.mjs';
import {
  addWallet,
  removeWallet,
  addGroup,
  setGroupActive,
  importBackup,
  storeSummary,
  getActiveWallets,
  loadStore,
  findGroup,
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
import { isTradeButtonId } from '../api/lib/discord-trade.mjs';
import { loadTradeSettings } from '../api/lib/trade-settings.mjs';
import {
  handleTradePanelButton,
  handleTradePanelSelect,
  handleTradeAlertButton,
  handleTradeModal,
  isTradePanelId,
  isTradeModalId,
} from './discord-trade-handlers.mjs';
import {
  handleSnipePanelButton,
  handleSnipePanelSelect,
  handleSnipeModal,
  isSnipePanelId,
  isSnipeModalId,
} from './discord-snipe-handlers.mjs';
import {
  dismissEphemeral,
  showEphemeralError,
  replyEphemeralBrief,
} from './discord-ui.mjs';
import { clearBalanceCache } from '../api/lib/wallet-balances.mjs';
import {
  handleAlertsPanelButton,
  isAlertsPanelId,
} from './discord-alerts-handlers.mjs';

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
loadTradeSettings();

const uiCtx = () => ({ heliusCount: HELIUS_KEYS.length, channelId: CHANNEL_ID });

const client = new Client({ intents: [GatewayIntentBits.Guilds] });
let alertChannel = null;
let panelMessage = null;
let notifyCtx = { discordChannel: null, ntfyTopic: '' };
let workerHandle = null;

async function registerMenuCommand() {
  const rest = new REST({ version: '10' }).setToken(TOKEN);
  const commands = [{ name: 'menu', description: 'Ouvre le menu principal du bot' }];
  try {
    if (GUILD_ID) {
      await rest.put(Routes.applicationGuildCommands(CLIENT_ID, GUILD_ID), { body: commands });
      await rest.put(Routes.applicationCommands(CLIENT_ID), { body: [] });
    } else {
      await rest.put(Routes.applicationCommands(CLIENT_ID), { body: commands });
    }
    console.log('✅ Commande /menu enregistrée');
  } catch (e) {
    console.warn('Slash register', e.message || e);
  }
}

async function updatePanel(screen = 'home') {
  if (!panelMessage) return;
  const payload = await renderScreen(screen, uiCtx());
  await panelMessage.edit(payload);
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
  await interaction.reply({
    content: '⛔ Seuls les admins du bot peuvent utiliser ce panneau.',
    ephemeral: true,
  });
}

async function handleButton(interaction) {
  const id = interaction.customId;

  if (isAlertsPanelId(id)) {
    if (await handleAlertsPanelButton(interaction)) return;
  }

  if (isSnipePanelId(id)) {
    if (await handleSnipePanelButton(interaction)) return;
  }

  if (isTradePanelId(id)) {
    if (await handleTradePanelButton(interaction)) return;
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
    await interaction.showModal(importModal());
    return;
  }

  if (id === CID.TEST) {
    await interaction.deferReply({ ephemeral: true });
    try {
      await sendTestAlert();
      await dismissEphemeral(interaction);
    } catch (e) {
      console.error('Test alerte', e);
      await showEphemeralError(interaction, `Test alerte : ${e.message || e}`);
    }
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
    if (workerHandle) void workerHandle.resync();
    await interaction.update(await renderScreen('settings', uiCtx()));
    return;
  }

  if (id === CID.HOME_BAL) {
    clearBalanceCache();
    try {
      await interaction.update(await renderScreen('home', uiCtx()));
    } catch (e) {
      console.error('Rafraîchir soldes', e);
      await showEphemeralError(interaction, e.message || String(e));
    }
    return;
  }

  const screen = resolveScreen(id);
  if (screen) {
    try {
      await interaction.update(await renderScreen(screen, uiCtx()));
    } catch (e) {
      console.error('Panneau', id, e);
      await showEphemeralError(interaction, e.message || String(e));
    }
  }
}

async function handleSelect(interaction) {
  const id = interaction.customId;
  const value = interaction.values[0];

  if (await handleSnipePanelSelect(interaction)) return;
  if (await handleTradePanelSelect(interaction)) return;

  if (id === CID.SEL_RM_WL) {
    removeWallet(value);
    await interaction.update(buildWalletRemoveSelect());
    return;
  }

  if (id === CID.SEL_PAUSE) {
    setGroupActive(value, false);
    await interaction.update(await renderScreen('gr_pause', uiCtx()));
    return;
  }

  if (id === CID.SEL_RESUME) {
    setGroupActive(value, true);
    await interaction.update(await renderScreen('gr_resume', uiCtx()));
  }
}

async function handleModal(interaction) {
  if (isSnipeModalId(interaction.customId)) {
    if (await handleSnipeModal(interaction)) return;
  }

  if (isTradeModalId(interaction.customId)) {
    if (await handleTradeModal(interaction)) return;
  }

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

    if (interaction.customId === CID.MODAL_IMPORT) {
      const raw = interaction.fields.getTextInputValue('json').trim();
      let data;
      try {
        data = JSON.parse(raw);
      } catch {
        throw new Error('JSON invalide — exporte depuis le site (Backup groupes).');
      }
      const payload = data.groups ? data : { groups: data };
      importBackup(payload);
      void updatePanel('home').catch(() => {});
      await dismissEphemeral(interaction);
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
      ...(await buildHomePanel()),
      ephemeral: true,
    });
    return;
  }

  if (interaction.isButton() && interaction.customId?.startsWith(COPY_CA_PREFIX)) {
    const mint = interaction.customId.slice(COPY_CA_PREFIX.length);
    await replyEphemeralBrief(
      interaction,
      `**Contrat (CA)**\n\`\`\`\n${mint}\n\`\`\``,
    );
    return;
  }

  if (interaction.isButton() && isTradeButtonId(interaction.customId)) {
    if (!isAdmin(interaction.user.id)) {
      await deny(interaction);
      return;
    }
    try {
      await handleTradeAlertButton(interaction);
    } catch (e) {
      const msg = e.message || String(e);
      if (interaction.deferred) {
        await interaction.editReply({ content: `❌ ${msg}` }).catch(() => {});
      } else {
        await interaction.reply({ content: `❌ ${msg}`, ephemeral: true }).catch(() => {});
      }
    }
    return;
  }

  if (interaction.isChatInputCommand()) {
    if (interaction.commandName === 'menu') {
      if (!isAdmin(interaction.user.id)) {
        await deny(interaction);
        return;
      }
      void updatePanel('home');
      await interaction.reply({
        ...(await buildHomePanel()),
        ephemeral: true,
      });
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
    const msg = e.message || String(e);
    if (interaction.isModalSubmit()) {
      if (interaction.deferred) {
        await interaction.editReply({ content: `❌ ${msg}` }).catch(() => {});
      } else if (!interaction.replied) {
        await interaction.reply({ content: `❌ ${msg}`, ephemeral: true }).catch(() => {});
      }
    } else if (interaction.isButton() || interaction.isStringSelectMenu()) {
      await interaction
        .followUp({ content: `❌ ${msg}`, ephemeral: true })
        .catch(() => interaction.reply({ content: `❌ ${msg}`, ephemeral: true }).catch(() => {}));
    }
  }
}

async function setupPanel() {
  const payload = await buildHomePanel();

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

  await registerMenuCommand();

  alertChannel = await client.channels.fetch(CHANNEL_ID);
  if (!alertChannel?.isTextBased()) {
    console.error('DISCORD_CHANNEL_ID invalide');
    process.exit(1);
  }

  notifyCtx.discordChannel = alertChannel;

  const worker = createBundleWorker({
    heliusKeys: HELIUS_KEYS,
    onBuy: async (w, hit, { sig, rpcCall, walletIndex, detectedAt }) => {
      await notifyBuyAlert(notifyCtx, w, hit, sig, rpcCall, walletIndex, { detectedAt });
    },
    onSell: async (w, hit, { sig }) => {
      await notifySellAlert(notifyCtx, w, hit, sig);
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
