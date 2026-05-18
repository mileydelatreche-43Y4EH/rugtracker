import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'fs';
import { dirname, resolve } from 'path';
import { fileURLToPath } from 'url';

const __dir = dirname(fileURLToPath(import.meta.url));
const defaultPath = resolve(__dir, '../../data/wallets.json');

const listeners = new Set();

function storePath() {
  return process.env.WALLET_STORE_PATH || defaultPath;
}

function parseWatchWallets(raw) {
  const s = String(raw || '').trim();
  if (!s) return [];
  try {
    const j = JSON.parse(s);
    return Array.isArray(j) ? j : [];
  } catch {
    try {
      const j = JSON.parse(s.replace(/'/g, '"'));
      return Array.isArray(j) ? j : [];
    } catch {}
  }
  return [];
}

function emptyStore() {
  return {
    version: 1,
    groups: [
      {
        id: 'bundlers',
        name: 'Bundles',
        emoji: '🎯',
        active: true,
        wallets: [],
      },
    ],
  };
}

export function loadStore() {
  const p = storePath();
  try {
    if (!existsSync(p)) return seedFromEnv(emptyStore());
    const data = JSON.parse(readFileSync(p, 'utf8'));
    if (!data.groups?.length) return seedFromEnv(emptyStore());
    return normalizeStore(data);
  } catch (e) {
    console.warn('wallet-store load', e.message);
    return seedFromEnv(emptyStore());
  }
}

function normalizeStore(data) {
  data.version = 1;
  for (const g of data.groups) {
    g.id = g.id || `g_${Date.now()}`;
    g.emoji = g.emoji || '🎯';
    g.active = g.active !== false;
    g.wallets = Array.isArray(g.wallets) ? g.wallets.filter(w => w?.addr) : [];
    for (const w of g.wallets) {
      w.addr = String(w.addr).trim();
      w.label = w.label || w.addr.slice(0, 8);
    }
  }
  return data;
}

function seedFromEnv(data) {
  const fromEnv = parseWatchWallets(process.env.WATCH_WALLETS);
  if (!fromEnv.length) return data;
  const g = data.groups[0] || {
    id: 'bundlers',
    name: 'Bundles',
    emoji: '🎯',
    active: true,
    wallets: [],
  };
  const have = new Set(g.wallets.map(w => w.addr));
  for (const w of fromEnv) {
    if (!w.addr || have.has(w.addr)) continue;
    g.wallets.push({ addr: w.addr, label: w.label || w.addr.slice(0, 8) });
    have.add(w.addr);
  }
  if (!data.groups.length) data.groups = [g];
  saveStore(data);
  return data;
}

export function saveStore(data) {
  const p = storePath();
  const normalized = normalizeStore(data);
  mkdirSync(dirname(p), { recursive: true });
  writeFileSync(p, JSON.stringify(normalized, null, 2), 'utf8');
  for (const fn of listeners) {
    try {
      fn(normalized);
    } catch (e) {
      console.warn('wallet-store listener', e.message);
    }
  }
  return normalized;
}

export function onStoreChange(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export function getActiveWallets(store = loadStore()) {
  const out = [];
  for (const g of store.groups) {
    if (g.active === false) continue;
    for (const w of g.wallets) {
      if (!w?.addr) continue;
      out.push({
        addr: w.addr,
        label: w.label || w.addr.slice(0, 8),
        groupId: g.id,
        groupName: g.name,
        groupEmoji: g.emoji || '🎯',
      });
    }
  }
  return out;
}

export function findGroup(store, nameOrId) {
  const q = String(nameOrId || '').trim().toLowerCase();
  if (!q) return store.groups[0] || null;
  return (
    store.groups.find(g => g.id.toLowerCase() === q) ||
    store.groups.find(g => g.name.toLowerCase() === q) ||
    store.groups.find(g => g.name.toLowerCase().includes(q)) ||
    null
  );
}

export function addGroup(name, emoji = '🎯') {
  const store = loadStore();
  const id = `g_${Date.now()}`;
  store.groups.push({ id, name: name.trim(), emoji, active: true, wallets: [] });
  return saveStore(store);
}

export function setGroupActive(nameOrId, active) {
  const store = loadStore();
  const g = findGroup(store, nameOrId);
  if (!g) throw new Error('Groupe introuvable');
  g.active = !!active;
  return saveStore(store);
}

export function addWallet(addr, label, groupRef) {
  const store = loadStore();
  const a = String(addr).trim();
  if (a.length < 32) throw new Error('Adresse invalide');
  const g = findGroup(store, groupRef) || store.groups[0];
  if (!g) throw new Error('Aucun groupe');
  if (g.wallets.some(w => w.addr === a)) throw new Error('Wallet déjà présent');
  for (const og of store.groups) {
    if (og.wallets.some(w => w.addr === a)) throw new Error(`Déjà dans « ${og.name} »`);
  }
  g.wallets.push({ addr: a, label: (label || a.slice(0, 8)).trim() });
  return saveStore(store);
}

export function removeWallet(addr) {
  const store = loadStore();
  const a = String(addr).trim();
  let removed = false;
  for (const g of store.groups) {
    const before = g.wallets.length;
    g.wallets = g.wallets.filter(w => w.addr !== a);
    if (g.wallets.length < before) removed = true;
  }
  if (!removed) throw new Error('Wallet introuvable');
  return saveStore(store);
}

export function importBackup(payload) {
  if (!payload?.groups?.length) throw new Error('Backup invalide');
  const store = {
    version: 1,
    groups: payload.groups.map(g => ({
      id: g.id || `g_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
      name: g.name || 'Groupe',
      emoji: g.emoji || '🎯',
      active: g.active !== false,
      wallets: (g.wallets || []).filter(w => w?.addr).map(w => ({
        addr: String(w.addr).trim(),
        label: w.label || String(w.addr).slice(0, 8),
      })),
    })),
  };
  return saveStore(store);
}

export function storeSummary(store = loadStore()) {
  const active = getActiveWallets(store);
  const lines = store.groups.map(
    g =>
      `${g.active === false ? '⏸' : '▶'} ${g.emoji} **${g.name}** — ${g.wallets.length} wallet(s)`,
  );
  return { activeCount: active.length, lines, wallets: active };
}
