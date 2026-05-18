/**
 * Mode webhook — pas de bot Discord connecté 24/7.
 * Un petit worker (Railway / PC) surveille les wallets et POST sur l’URL webhook.
 */
import { readFileSync, existsSync } from 'fs';
import { loadStore, getActiveWallets, storeSummary } from '../api/lib/wallet-store.mjs';
import { notifyBuyAlert, fetchBuyMeta } from '../api/lib/notify-buy.mjs';
import { sendWebhookPlain } from '../api/lib/discord-webhook.mjs';
import { createBundleWorker } from './bundle-worker.mjs';

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

loadEnvFile();

const WEBHOOK = (process.env.DISCORD_WEBHOOK_URL || '').trim();
const HELIUS_KEYS = parseHeliusKeys();

if (!WEBHOOK || !HELIUS_KEYS.length) {
  console.error('');
  console.error('  Mode webhook : il faut dans .env');
  console.error('    DISCORD_WEBHOOK_URL=https://discord.com/api/webhooks/...');
  console.error('    HELIUS_API_KEYS=...');
  console.error('');
  process.exit(1);
}

loadStore();

const ctx = { webhookUrl: WEBHOOK, discordChannel: null, ntfyTopic: '' };

const worker = createBundleWorker({
  heliusKeys: HELIUS_KEYS,
  onBuy: async (w, hit, { sig, rpcCall, walletIndex }) => {
    await notifyBuyAlert(ctx, w, hit, sig, rpcCall, walletIndex);
  },
});

const sum = storeSummary();
console.log(`Webhook worker — ${sum.activeCount} wallet(s) · Helius ×${HELIUS_KEYS.length}`);

try {
  await sendWebhookPlain(
    WEBHOOK,
    '✅ Bundle Tracker (webhook) actif',
    `Surveillance **${sum.activeCount}** wallet(s).\nLes achats arrivent ici avec boutons Axiom / Pump / Dex.\n_Modifie \`data/wallets.json\` ou importe un backup pour changer les wallets._`,
  );
  console.log('✅ Message de démarrage envoyé sur Discord');
} catch (e) {
  console.error('❌ Webhook invalide ou expiré :', e.message || e);
  process.exit(1);
}

await worker.start();
console.log('🚀 Worker webhook prêt (laisse Railway / cette fenêtre ouverte)');

setInterval(() => {}, 60000);
