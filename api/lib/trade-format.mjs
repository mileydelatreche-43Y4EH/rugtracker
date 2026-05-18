import { LAMPORTS_PER_SOL } from '@solana/web3.js';

/** Niveaux type Axiom (nom + lamports par défaut). */
export const AXIOM_PRIORITY_PRESETS = [
  { id: 'normal', name: 'Normal', lamports: 100_000, sol: 0.0001 },
  { id: 'fast', name: 'Fast', lamports: 500_000, sol: 0.0005 },
  { id: 'turbo', name: 'Turbo', lamports: 1_000_000, sol: 0.001 },
  { id: 'ultra', name: 'Ultra', lamports: 5_000_000, sol: 0.005 },
];

export function lamportsToSol(lamports) {
  return Number(lamports || 0) / LAMPORTS_PER_SOL;
}

export function solToLamports(sol) {
  return Math.round(Number(sol) * LAMPORTS_PER_SOL);
}

/** Affiche un montant SOL lisible (ex. 0.1). */
export function formatSolAmount(sol) {
  const n = Number(sol) || 0;
  if (n >= 10) return String(Number(n.toFixed(2)));
  if (n >= 1) return String(Number(n.toFixed(3)));
  if (n >= 0.01) return String(Number(n.toFixed(2)));
  return String(Number(n.toFixed(4)));
}

export function formatSolLabel(sol) {
  return `${formatSolAmount(sol)} SOL`;
}

export function formatBuyPresets(solList) {
  return solList.map(x => formatSolLabel(x)).join(' · ');
}

/** Preset Axiom le plus proche + libellé complet. */
export function formatPriorityFeeAxiom(lamports) {
  const lp = Number(lamports) || 0;
  const sol = lamportsToSol(lp);
  let best = AXIOM_PRIORITY_PRESETS[0];
  let bestDiff = Math.abs(lp - best.lamports);
  for (const p of AXIOM_PRIORITY_PRESETS) {
    const d = Math.abs(lp - p.lamports);
    if (d < bestDiff) {
      best = p;
      bestDiff = d;
    }
  }
  const isExact = bestDiff < best.lamports * 0.15;
  const tier = isExact ? best.name : 'Custom';
  return {
    tier,
    solLabel: formatSolLabel(sol),
    lamports: lp,
    line: `**${tier}** · ${formatSolLabel(sol)}`,
  };
}

export function priorityPresetById(id) {
  return AXIOM_PRIORITY_PRESETS.find(p => p.id === id) || null;
}
