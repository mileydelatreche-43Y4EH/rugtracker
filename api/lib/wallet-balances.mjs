import { Connection, PublicKey, LAMPORTS_PER_SOL } from '@solana/web3.js';
import { primaryHeliusRpcUrl } from './helius-rpc.mjs';
import { listTradeWalletsPublic } from './trade-wallets.mjs';
import { formatSolLabel } from './trade-format.mjs';

const cache = new Map();
const TTL_MS = 25_000;

export function clearBalanceCache() {
  cache.clear();
}

export async function fetchTradeWalletBalances(force = false) {
  const wallets = listTradeWalletsPublic();
  if (!wallets.length) return [];

  const cacheKey = wallets.map(w => w.pubkey).join('|');
  const hit = cache.get(cacheKey);
  if (!force && hit && Date.now() - hit.at < TTL_MS) return hit.list;

  let conn;
  try {
    conn = new Connection(primaryHeliusRpcUrl(), 'confirmed');
  } catch {
    return wallets.map(w => ({ ...w, sol: null }));
  }

  const list = await Promise.all(
    wallets.map(async w => {
      try {
        const lamports = await conn.getBalance(new PublicKey(w.pubkey), 'confirmed');
        return { ...w, sol: lamports / LAMPORTS_PER_SOL };
      } catch {
        return { ...w, sol: null };
      }
    }),
  );

  cache.set(cacheKey, { list, at: Date.now() });
  return list;
}

export function formatWalletBalanceLine(w, enabled = true) {
  const status = enabled ? '🟢' : '⚪';
  const bal = w.sol == null ? '_solde…_' : `**${formatSolLabel(w.sol)}**`;
  return `${status} **${w.label}** · ${bal}\n\`${w.pubkey}\``;
}

/** Accueil Discord : montant SOL au-dessus du nom du wallet. */
export function formatHomeWalletsBlock(balances, enabledIds = []) {
  if (!balances.length) {
    return '_Aucun wallet — **Paramètres → Trading → Wallets trading**._';
  }
  const enabled = new Set(enabledIds);
  const allOn = !enabled.size;
  const total = balances.reduce((s, w) => s + (w.sol ?? 0), 0);
  const lines = balances.map(w => {
    const on = allOn || enabled.has(w.id);
    const bal = w.sol == null ? '…' : formatSolLabel(w.sol);
    const mark = on ? '🟢' : '⚪';
    return `${mark} **${bal}**\n**${w.label}**`;
  });
  if (balances.length === 1) return lines[0];
  return [`**Total** · **${formatSolLabel(total)}**`, '', ...lines].join('\n\n');
}

export function formatWalletsBalanceBlock(balances, enabledIds = []) {
  if (!balances.length) return '_Aucun wallet de trading._';
  const enabled = new Set(enabledIds);
  const allOn = !enabled.size;
  const total = balances.reduce((s, w) => s + (w.sol ?? 0), 0);
  const lines = balances.map(w => {
    const on = allOn || enabled.has(w.id);
    return formatWalletBalanceLine(w, on);
  });
  return [
    `**Total** · **${formatSolLabel(total)}**`,
    '',
    ...lines,
  ].join('\n');
}
