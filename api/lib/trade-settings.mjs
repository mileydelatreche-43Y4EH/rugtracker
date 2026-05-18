import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import { formatBuyPresets, formatPriorityFeeAxiom, formatSolLabel } from './trade-format.mjs';

const __dir = dirname(fileURLToPath(import.meta.url));
const DEFAULT_PATH = join(__dir, '../../data/trade-settings.json');

export const DEFAULT_TRADE_SETTINGS = {
  version: 1,
  tradingEnabled: false,
  showTradeButtonsOnAlerts: true,
  buyPresetsSol: [0.05, 0.1, 0.25, 0.5],
  sellPresetsPct: [25, 50, 75, 100],
  defaultBuyPresetIndex: 1,
  slippageBps: 1500,
  priorityFeeLamports: 200000,
  multiWalletMode: 'all',
  enabledWalletIds: [],
  minSolReserve: 0.02,
  autoBuy: {
    enabled: false,
    solAmount: 0.1,
    minMcUsd: 0,
    maxMcUsd: 250000,
    venues: ['curve', 'pumpswap'],
    maxPerMint: 1,
  },
};

const listeners = new Set();

function settingsPath() {
  return process.env.TRADE_SETTINGS_PATH || DEFAULT_PATH;
}

function normalize(input) {
  const d = { ...DEFAULT_TRADE_SETTINGS, ...input, autoBuy: { ...DEFAULT_TRADE_SETTINGS.autoBuy, ...(input?.autoBuy || {}) } };
  d.buyPresetsSol = (d.buyPresetsSol || DEFAULT_TRADE_SETTINGS.buyPresetsSol)
    .map(Number)
    .filter(n => n > 0 && n <= 50)
    .slice(0, 4);
  if (!d.buyPresetsSol.length) d.buyPresetsSol = [...DEFAULT_TRADE_SETTINGS.buyPresetsSol];
  d.sellPresetsPct = (d.sellPresetsPct || DEFAULT_TRADE_SETTINGS.sellPresetsPct)
    .map(Number)
    .filter(n => n > 0 && n <= 100)
    .slice(0, 4);
  if (!d.sellPresetsPct.length) d.sellPresetsPct = [...DEFAULT_TRADE_SETTINGS.sellPresetsPct];
  d.slippageBps = Math.min(5000, Math.max(50, Number(d.slippageBps) || 1500));
  d.priorityFeeLamports = Math.min(2_000_000, Math.max(0, Number(d.priorityFeeLamports) || 200000));
  d.defaultBuyPresetIndex = Math.min(d.buyPresetsSol.length - 1, Math.max(0, Number(d.defaultBuyPresetIndex) || 0));
  const modes = ['all', 'first', 'sequential'];
  if (!modes.includes(d.multiWalletMode)) d.multiWalletMode = 'all';
  return d;
}

export function loadTradeSettings() {
  const p = settingsPath();
  if (!existsSync(p)) return normalize({});
  try {
    return normalize(JSON.parse(readFileSync(p, 'utf8')));
  } catch {
    return normalize({});
  }
}

export function saveTradeSettings(data) {
  const p = settingsPath();
  const normalized = normalize(data);
  mkdirSync(dirname(p), { recursive: true });
  writeFileSync(p, JSON.stringify(normalized, null, 2), 'utf8');
  for (const fn of listeners) {
    try {
      fn(normalized);
    } catch (e) {
      console.warn('trade-settings listener', e.message);
    }
  }
  return normalized;
}

export function patchTradeSettings(patch) {
  return saveTradeSettings({ ...loadTradeSettings(), ...patch });
}

export function onTradeSettingsChange(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export function tradeSettingsSummary(s = loadTradeSettings()) {
  const auto = s.autoBuy?.enabled
    ? `🟢 ${formatSolLabel(s.autoBuy.solAmount)}`
    : '🔴 off';
  const prio = formatPriorityFeeAxiom(s.priorityFeeLamports);
  return [
    `Trading : **${s.tradingEnabled ? 'ON' : 'OFF'}**`,
    `Boutons alertes : **${s.showTradeButtonsOnAlerts ? 'ON' : 'OFF'}**`,
    `Achat : ${formatBuyPresets(s.buyPresetsSol)}`,
    `Vente : ${s.sellPresetsPct.map(x => `${x}%`).join(' · ')}`,
    `Slippage : **${(s.slippageBps / 100).toFixed(1)}%**`,
    `Priority fee : ${prio.line} _(style Axiom)_`,
    `Réserve min : **${formatSolLabel(s.minSolReserve)}**`,
    `Multi-wallet : **${s.multiWalletMode}**`,
    `Auto-buy : ${auto}`,
  ];
}
