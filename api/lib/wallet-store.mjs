import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'fs';
import { dirname, resolve } from 'path';
import { fileURLToPath } from 'url';
import { resolvePersistPath } from './data-paths.mjs';

const __dir = dirname(fileURLToPath(import.meta.url));
const defaultPath = resolve(__dir, '../../data/wallets.json');

const listeners = new Set();

/** Couleurs barre latérale embed par défaut (une par groupe). */
export const GROUP_PALETTE = [
  0x7c3aed,
  0x2563eb,
  0x059669,
  0xd97706,
  0xdb2777,
  0x0891b2,
  0x4f46e5,
  0xca8a04,
];

export function parseGroupColor(raw) {
  if (raw == null || raw === '') return null;
  if (typeof raw === 'number' && raw >= 0) return raw;
  const s = String(raw).replace('#', '').trim();
  if (!/^[0-9a-fA-F]{6}$/.test(s)) return null;
  return parseInt(s, 16);
}

export function groupEmbedColor(group, index = 0) {
  const c = parseGroupColor(group?.color);
  if (c != null) return c;
  return GROUP_PALETTE[index % GROUP_PALETTE.length];
}

function storePath() {
  return resolvePersistPath('wallets.json', 'WALLET_STORE_PATH', defaultPath);
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
  data.groups.forEach((g, i) => {
    g.id = g.id || `g_${Date.now()}`;
    g.emoji = g.emoji || '🎯';
    g.active = g.active !== false;
    if (g.color == null) g.color = GROUP_PALETTE[i % GROUP_PALETTE.length];
    g.wallets = Array.isArray(g.wallets) ? g.wallets.filter(w => w?.addr) : [];
    for (const w of g.wallets) {
      w.addr = String(w.addr).trim();
      w.label = w.label || w.addr.slice(0, 8);
      if (w.alertsOn === undefined) w.alertsOn = true;
      w.alertsOn = w.alertsOn !== false;
    }
  });
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

export function getAllWalletsFlat(store = loadStore()) {
  const out = [];
  store.groups.forEach((g, gi) => {
    const groupColor = groupEmbedColor(g, gi);
    for (const w of g.wallets) {
      if (!w?.addr) continue;
      out.push({
        addr: w.addr,
        label: w.label || w.addr.slice(0, 8),
        groupId: g.id,
        groupName: g.name,
        groupEmoji: g.emoji || '🎯',
        groupColor,
        groupActive: g.active !== false,
        alertsOn: w.alertsOn !== false,
      });
    }
  });
  return out;
}

/** Wallets surveillés (groupe actif + alertes ON). */
export function getActiveWallets(store = loadStore()) {
  return getAllWalletsFlat(store).filter(w => w.groupActive && w.alertsOn);
}

export function toggleWalletAlerts(addr) {
  const store = loadStore();
  const a = String(addr).trim();
  let found = false;
  let next = true;
  for (const g of store.groups) {
    for (const w of g.wallets) {
      if (w.addr !== a) continue;
      found = true;
      next = !w.alertsOn;
      w.alertsOn = next;
    }
  }
  if (!found) throw new Error('Wallet introuvable.');
  saveStore(store);
  return next;
}

export function setAllWalletAlerts(enabled) {
  const store = loadStore();
  const on = !!enabled;
  for (const g of store.groups) {
    for (const w of g.wallets) {
      w.alertsOn = on;
    }
  }
  saveStore(store);
  return on;
}

export function alertsLiveSummary(store = loadStore()) {
  const all = getAllWalletsFlat(store);
  const on = all.filter(w => w.alertsOn && w.groupActive).length;
  return { total: all.length, on, off: all.length - all.filter(w => w.alertsOn).length };
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
  if (a.length < 32 || a.length > 48) throw new Error('Adresse Solana invalide (32–48 caractères).');
  if (!/^[1-9A-HJ-NP-Za-km-z]+$/.test(a)) throw new Error('Adresse invalide (caractères base58 uniquement).');

  const groupQuery = String(groupRef || '').trim();
  let g = null;
  if (!groupQuery) {
    g = store.groups[0] || null;
  } else {
    g = findGroup(store, groupQuery);
    if (!g) {
      const names = store.groups.map(x => `« ${x.name} »`).join(', ') || '(aucun)';
      throw new Error(`Groupe « ${groupQuery} » introuvable. Groupes : ${names}`);
    }
  }
  if (!g) throw new Error('Aucun groupe — crée-en un dans Groupes → Créer.');

  if (g.wallets.some(w => w.addr === a)) throw new Error(`Déjà dans « ${g.name} ».`);
  for (const og of store.groups) {
    if (og.wallets.some(w => w.addr === a)) throw new Error(`Déjà dans le groupe « ${og.name} ».`);
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
      color: g.color,
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
