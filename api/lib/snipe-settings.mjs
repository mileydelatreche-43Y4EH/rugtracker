import { loadTradeSettings, patchTradeSettings } from './trade-settings.mjs';
import { getActiveWallets } from './wallet-store.mjs';

export const DEFAULT_SNIPE_AUTO = {
  enabled: false,
  solAmount: 0.1,
  minMcUsd: 0,
  maxMcUsd: 250000,
  venues: ['curve', 'pumpswap'],
  maxPerMint: 1,
};

function normalizeAutoBuy(ab) {
  return {
    ...DEFAULT_SNIPE_AUTO,
    ...ab,
    solAmount: Math.min(50, Math.max(0.001, Number(ab?.solAmount) || DEFAULT_SNIPE_AUTO.solAmount)),
    minMcUsd: Math.max(0, Number(ab?.minMcUsd) || 0),
    maxMcUsd: Math.max(0, Number(ab?.maxMcUsd) || 250000),
    venues: Array.isArray(ab?.venues) && ab.venues.length ? ab.venues : [...DEFAULT_SNIPE_AUTO.venues],
    maxPerMint: Math.min(5, Math.max(1, Number(ab?.maxPerMint) || 1)),
    enabled: !!ab?.enabled,
  };
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

export function snipeSummaryLines(settings = loadTradeSettings()) {
  const snipes = listSnipes(settings);
  const active = getActiveWallets();
  if (!snipes.length) return ['_Aucun wallet en sniping._'];
  return snipes.map(s => {
    const w = active.find(x => x.addr === s.watchAddr);
    const name = w?.label || s.label || s.watchAddr.slice(0, 8);
    const ab = s.autoBuy;
    const st = ab.enabled ? `🟢 auto **${ab.solAmount} SOL**` : '⚪ auto off';
    const mc =
      ab.minMcUsd > 0 || ab.maxMcUsd > 0
        ? ` · MC ${ab.minMcUsd || 0}–${ab.maxMcUsd || '∞'}`
        : '';
    return `🎯 **${name}** · ${st}${mc}\n\`${s.watchAddr}\``;
  });
}
