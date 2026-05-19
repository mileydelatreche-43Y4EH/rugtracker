import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import bs58 from 'bs58';
import { Keypair } from '@solana/web3.js';
import { resolvePersistPath } from './data-paths.mjs';
import { scheduleCloudPersist } from './cloud-persist.mjs';

const __dir = dirname(fileURLToPath(import.meta.url));
const DEFAULT_PATH = join(__dir, '../../data/trade-wallets.json');

function walletsPath() {
  return resolvePersistPath('trade-wallets.json', 'TRADE_WALLETS_PATH', DEFAULT_PATH);
}

function decodeSecret(raw) {
  const s = String(raw || '').trim();
  if (!s) throw new Error('Clé privée vide');
  let secret;
  if (s.startsWith('[')) {
    secret = Uint8Array.from(JSON.parse(s));
  } else {
    secret = bs58.decode(s);
  }
  if (secret.length !== 64) throw new Error('Clé privée invalide (attendu 64 octets base58 ou JSON array)');
  return Keypair.fromSecretKey(secret);
}

function loadFileStore() {
  const p = walletsPath();
  if (!existsSync(p)) return { version: 1, wallets: [] };
  try {
    const data = JSON.parse(readFileSync(p, 'utf8'));
    return { version: 1, wallets: Array.isArray(data.wallets) ? data.wallets : [] };
  } catch {
    return { version: 1, wallets: [] };
  }
}

function loadEnvWallets() {
  const raw = process.env.TRADE_WALLETS_JSON || '';
  if (!raw.trim()) return [];
  const parsed = JSON.parse(raw);
  const list = Array.isArray(parsed) ? parsed : parsed.wallets || [];
  return list.map((w, i) => ({
    id: w.id || `env_${i}`,
    label: w.label || `Wallet ${i + 1}`,
    secretKey: w.secretKey || w.privateKey || w.key,
  }));
}

function saveFileStore(data) {
  const p = walletsPath();
  mkdirSync(dirname(p), { recursive: true });
  writeFileSync(p, JSON.stringify(data, null, 2), 'utf8');
  scheduleCloudPersist();
}

/** Liste publique (sans secrets). */
export function listTradeWalletsPublic() {
  const env = loadEnvWallets();
  const file = loadFileStore().wallets;
  const merged = [...env, ...file];
  const seen = new Set();
  const out = [];
  for (const w of merged) {
    try {
      const kp = decodeSecret(w.secretKey);
      const pubkey = kp.publicKey.toBase58();
      if (seen.has(pubkey)) continue;
      seen.add(pubkey);
      out.push({
        id: w.id || pubkey.slice(0, 8),
        label: w.label || pubkey.slice(0, 8),
        pubkey,
        source: env.includes(w) ? 'env' : 'file',
      });
    } catch {
      /* skip invalid */
    }
  }
  return out;
}

/** Keypairs pour exécution (filtrés par settings.enabledWalletIds). */
export function getSigningWallets(settings) {
  const env = loadEnvWallets();
  const file = loadFileStore().wallets;
  const merged = [...env, ...file];
  const enabledIds = settings?.enabledWalletIds || [];
  const out = [];
  const seen = new Set();

  for (const w of merged) {
    try {
      const kp = decodeSecret(w.secretKey);
      const pubkey = kp.publicKey.toBase58();
      if (seen.has(pubkey)) continue;
      seen.add(pubkey);
      const id = w.id || pubkey.slice(0, 8);
      if (enabledIds.length && !enabledIds.includes(id)) continue;
      out.push({ id, label: w.label || id, keypair: kp, pubkey });
    } catch (e) {
      console.warn('trade-wallet skip', w.label || w.id, e.message);
    }
  }
  return out;
}

export function addTradeWallet(label, secretKey) {
  const kp = decodeSecret(secretKey);
  const pubkey = kp.publicKey.toBase58();
  const store = loadFileStore();
  if (store.wallets.some(w => {
    try {
      return decodeSecret(w.secretKey).publicKey.toBase58() === pubkey;
    } catch {
      return false;
    }
  })) {
    throw new Error('Ce wallet est déjà enregistré.');
  }
  const id = `tw_${Date.now()}`;
  store.wallets.push({
    id,
    label: (label || pubkey.slice(0, 8)).trim(),
    secretKey: String(secretKey).trim(),
  });
  saveFileStore(store);
  return { id, label: store.wallets.at(-1).label, pubkey };
}

export function removeTradeWallet(id) {
  const store = loadFileStore();
  const before = store.wallets.length;
  store.wallets = store.wallets.filter(w => w.id !== id);
  if (store.wallets.length === before) throw new Error('Wallet introuvable.');
  saveFileStore(store);
}

export function toggleTradeWalletEnabled(settings, walletId, enabled) {
  const ids = new Set(settings.enabledWalletIds || []);
  if (enabled) ids.add(walletId);
  else ids.delete(walletId);
  return [...ids];
}
