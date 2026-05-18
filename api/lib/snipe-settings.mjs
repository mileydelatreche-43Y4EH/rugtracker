import { loadTradeSettings, patchTradeSettings } from './trade-settings.mjs';
import { getActiveWallets } from './wallet-store.mjs';

export const DEFAULT_SNIPE_AUTO = {
  enabled: false,
  solAmount: 0.1,
  buyCopyPct: 100,
  autoSellEnabled: false,
  sellCopyPct: 100,
  venues: ['curve', 'pumpswap'],
  maxPerMint: 1,
};

function normalizeAutoBuy(ab) {
  return {
    ...DEFAULT_SNIPE_AUTO,
    ...ab,
    solAmount: Math.min(50, Math.max(0.001, Number(ab?.solAmount) || DEFAULT_SNIPE_AUTO.solAmount)),
    buyCopyPct: Math.min(1000, Math.max(1, Number(ab?.buyCopyPct) || DEFAULT_SNIPE_AUTO.buyCopyPct)),
    sellCopyPct: Math.min(100, Math.max(1, Number(ab?.sellCopyPct) || DEFAULT_SNIPE_AUTO.sellCopyPct)),
    venues: Array.isArray(ab?.venues) && ab.venues.length ? ab.venues : [...DEFAULT_SNIPE_AUTO.venues],
    maxPerMint: Math.min(5, Math.max(1, Number(ab?.maxPerMint) || 1)),
    enabled: !!ab?.enabled,
    autoSellEnabled: !!ab?.autoSellEnabled,
  };
}

/** SOL à acheter : % du montant du wallet surveillé, plafonné par solAmount. */
export function computeSnipeBuySol(ab, hit) {
  const cap = Math.min(50, Math.max(0.001, Number(ab?.solAmount) || 0.1));
  const watched = Number(hit?.sol) || 0;
  const pct = Number(ab?.buyCopyPct) || 100;
  if (watched > 0) {
    const copied = watched * (pct / 100);
    return Math.min(cap, Math.max(0.001, copied));
  }
  return cap;
}

export function listSnipes(settings = loadTradeSettings()) {
  return (settings.snipes || []).map(s => ({
    ...s,
    watchAddr: String(s.watchAddr || '').trim(),
    autoBuy: normalizeAutoBuy(s.autoBuy),
  }));
}

export function getSnipeByAddr(addr, settings = loadTradeSettings()) {
  const a = String(addr || '').trim();
  return listSnipes(settings).find(s => s.watchAddr === a) || null;
}

export function upsertSnipe(watchAddr, patch = {}) {
  const a = String(watchAddr || '').trim();
  if (a.length < 32) throw new Error('Adresse wallet invalide.');
  const settings = loadTradeSettings();
  const snipes = [...(settings.snipes || [])];
  const idx = snipes.findIndex(s => s.watchAddr === a);
  const prev = idx >= 0 ? snipes[idx] : { watchAddr: a, autoBuy: { ...DEFAULT_SNIPE_AUTO } };
  const w = getActiveWallets().find(x => x.addr === a);
  const next = {
    ...prev,
    ...patch,
    watchAddr: a,
    label: patch.label ?? prev.label ?? w?.label,
    autoBuy: normalizeAutoBuy({ ...prev.autoBuy, ...(patch.autoBuy || {}) }),
  };
  if (idx >= 0) snipes[idx] = next;
  else snipes.push(next);
  return patchTradeSettings({ snipes });
}

export function removeSnipe(watchAddr) {
  const a = String(watchAddr || '').trim();
  const snipes = listSnipes().filter(s => s.watchAddr !== a);
  return patchTradeSettings({ snipes });
}

export function toggleSnipeAuto(watchAddr, enabled) {
  return upsertSnipe(watchAddr, { autoBuy: { enabled: !!enabled } });
}

export function toggleSnipeAutoSell(watchAddr, enabled) {
  return upsertSnipe(watchAddr, { autoBuy: { autoSellEnabled: !!enabled } });
}

/** % de ta position à vendre quand le wallet surveillé vend (proportion miroir). */
export function computeSnipeSellPct(ab, hit) {
  const theirPct = Math.min(100, Math.max(1, Number(hit?.sellPct) || 100));
  const scale = Math.min(100, Math.max(1, Number(ab?.sellCopyPct) || 100));
  return Math.min(100, Math.max(1, (theirPct * scale) / 100));
}

export function snipeSummaryLines(settings = loadTradeSettings()) {
  const snipes = listSnipes(settings);
  const active = getActiveWallets();
  if (!snipes.length) return ['_Aucun wallet en sniping._'];
  return snipes.map(s => {
    const w = active.find(x => x.addr === s.watchAddr);
    const name = w?.label || s.label || s.watchAddr.slice(0, 8);
    const ab = s.autoBuy;
    const st = ab.enabled ? `🟢 buy **${ab.buyCopyPct}%**` : '⚪ buy off';
    const sell = ab.autoSellEnabled ? ` · sell **${ab.sellCopyPct}%**` : '';
    return `🎯 **${name}** · ${st}${sell}\n\`${s.watchAddr}\``;
  });
}
