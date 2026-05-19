/**
 * Persistance cloud — REDIS_URL (Upstash) ou REST KV. Pas besoin de volume Railway.
 */
import { createHash } from 'crypto';
import { isRailwayHost, hasRailwayVolume } from './data-paths.mjs';
import { isCloudStorageReady } from './kv-env.mjs';
import { cloudGet, cloudSet, cloudBackendLabel } from './redis-cloud.mjs';

let flushTimer = null;

export function getCloudSyncKey() {
  const direct = (process.env.CLOUD_SYNC_KEY || '').trim();
  if (direct && /^[a-f0-9]{64}$/i.test(direct)) return direct.toLowerCase();
  const secret = (process.env.CLOUD_SYNC_SECRET || '').trim();
  if (secret.length >= 8) {
    return createHash('sha256').update(secret, 'utf8').digest('hex');
  }
  return null;
}

export function isCloudPersistEnabled() {
  const key = getCloudSyncKey();
  if (!key) return false;
  return isCloudStorageReady();
}

function kvStoreKey(syncKey) {
  return `bt:${syncKey}`;
}

export async function pullCloudBundle() {
  const syncKey = getCloudSyncKey();
  if (!syncKey) return null;
  return cloudGet(kvStoreKey(syncKey));
}

export async function pushCloudBundle(payload) {
  const syncKey = getCloudSyncKey();
  if (!syncKey) return false;
  await cloudSet(kvStoreKey(syncKey), payload);
  return true;
}

function countWallets(groups) {
  if (!Array.isArray(groups)) return 0;
  return groups.reduce((n, g) => n + (g.wallets?.length || 0), 0);
}

export async function buildBotCloudPayload() {
  const { loadStore } = await import('./wallet-store.mjs');
  const { loadTradeSettings } = await import('./trade-settings.mjs');
  const store = loadStore();
  let tradeWallets = { version: 1, wallets: [] };
  try {
    const { readFileSync, existsSync } = await import('fs');
    const { resolvePersistPath } = await import('./data-paths.mjs');
    const { dirname, join } = await import('path');
    const { fileURLToPath } = await import('url');
    const __dir = dirname(fileURLToPath(import.meta.url));
    const p = resolvePersistPath(
      'trade-wallets.json',
      'TRADE_WALLETS_PATH',
      join(__dir, '../../data/trade-wallets.json'),
    );
    if (existsSync(p)) {
      tradeWallets = JSON.parse(readFileSync(p, 'utf8'));
    }
  } catch {
    /* ignore */
  }
  return {
    v: 1,
    exportedAt: new Date().toISOString(),
    groups: store.groups,
    tradeSettings: await loadTradeSettings(),
    tradeWallets,
  };
}

export function scheduleCloudPersist() {
  if (!isCloudPersistEnabled()) return;
  if (flushTimer) clearTimeout(flushTimer);
  const ms = Number(process.env.CLOUD_PERSIST_DEBOUNCE_MS || 2000);
  flushTimer = setTimeout(() => {
    flushTimer = null;
    void flushCloudPersist();
  }, ms);
}

export async function flushCloudPersist() {
  if (!isCloudPersistEnabled()) return false;
  try {
    const payload = await buildBotCloudPayload();
    await pushCloudBundle(payload);
    const n = countWallets(payload.groups);
    console.log(`☁ Sauvegardé cloud · ${n} wallet(s) · ${payload.exportedAt}`);
    return true;
  } catch (e) {
    console.warn('☁ Cloud save', e.message || e);
    return false;
  }
}

export async function hydrateFromCloud() {
  logCloudPersistStatus();

  if (!isCloudPersistEnabled()) return false;

  try {
    const data = await pullCloudBundle();
    if (!data?.groups?.length) {
      console.log('☁ Redis vide — fais /import une fois puis redeploy (sauvegarde auto)');
      return false;
    }

    const { loadStore, importBackup } = await import('./wallet-store.mjs');
    const local = loadStore();
    const localN = countWallets(local.groups);
    const cloudN = countWallets(data.groups);
    const cloudAt = String(data.exportedAt || '');
    const localAt = String(local.exportedAt || '');

    const useCloud = localN === 0 || cloudN > localN || (cloudAt && cloudAt > localAt);

    if (!useCloud) {
      console.log(`☁ Cloud OK · ${localN} wallet(s) local(aux)`);
      return false;
    }

    importBackup(data);

    if (data.tradeSettings && typeof data.tradeSettings === 'object') {
      const { saveTradeSettings } = await import('./trade-settings.mjs');
      saveTradeSettings(data.tradeSettings);
    }

    if (data.tradeWallets?.wallets) {
      const { writeFileSync, mkdirSync } = await import('fs');
      const { dirname, join } = await import('path');
      const { fileURLToPath } = await import('url');
      const { resolvePersistPath } = await import('./data-paths.mjs');
      const __dir = dirname(fileURLToPath(import.meta.url));
      const p = resolvePersistPath(
        'trade-wallets.json',
        'TRADE_WALLETS_PATH',
        join(__dir, '../../data/trade-wallets.json'),
      );
      mkdirSync(dirname(p), { recursive: true });
      writeFileSync(p, JSON.stringify(data.tradeWallets, null, 2), 'utf8');
    }

    console.log(`☁ Restauré depuis cloud · ${cloudN} wallet(s) · ${cloudAt || '?'}`);
    return true;
  } catch (e) {
    console.warn('☁ Cloud restore', e.message || e);
    return false;
  }
}

export function logCloudPersistStatus() {
  const redis = !!(process.env.REDIS_URL || process.env.UPSTASH_REDIS_URL || '').trim();
  const secret = !!(process.env.CLOUD_SYNC_SECRET || '').trim();
  console.log(`☁ REDIS_URL : ${redis ? 'oui' : 'NON'}`);
  console.log(`☁ CLOUD_SYNC_SECRET : ${secret ? 'oui' : 'NON'}`);
  if (isCloudPersistEnabled()) {
    console.log(`☁ Persistance cloud active (${cloudBackendLabel()})`);
    return;
  }
  if (isRailwayHost() && !hasRailwayVolume()) {
    console.warn('');
    console.warn('⚠ WALLETS PERDUS AU REDEPLOY — ajoute sur Railway :');
    console.warn('   REDIS_URL=rediss://default:...@....upstash.io:6379');
    console.warn('   CLOUD_SYNC_SECRET=bundle_tracker_sync');
    console.warn('   Supprime WALLET_STORE_PATH=/data si présent');
    console.warn('');
  }
}

export async function logWalletStoreStatus() {
  const { loadStore, getActiveWallets, storeSummary } = await import('./wallet-store.mjs');
  const p = (await import('./data-paths.mjs')).resolvePersistPath(
    'wallets.json',
    'WALLET_STORE_PATH',
    'data/wallets.json',
  );
  const store = loadStore();
  const sum = storeSummary(store);
  console.log(`📂 Fichier wallets : ${p}`);
  console.log(`👛 ${sum.activeCount} wallet(s) actif(s) / ${sum.total} total`);
}
