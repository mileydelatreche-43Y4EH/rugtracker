import { Connection } from '@solana/web3.js';
import { loadTradeSettings } from './trade-settings.mjs';
import {
  getSnipeByAddr,
  computeSnipeBuySol,
  computeSnipeSellPct,
} from './snipe-settings.mjs';
import { getSigningWallets } from './trade-wallets.mjs';
import { getSolBalance, swapSolToToken, swapTokenToSol } from './jupiter-swap.mjs';
import { primaryHeliusRpcUrl } from './helius-rpc.mjs';

const snipeBuySeen = new Map();

function pickWallets(settings, all) {
  if (!all.length) {
    throw new Error('Aucun wallet de trading — Paramètres → Trading → Wallets trading.');
  }
  if (settings.multiWalletMode === 'first') return [all[0]];
  return all;
}

async function runOnWallets(wallets, settings, rpcUrl, fn) {
  const mode = settings.multiWalletMode;
  const results = [];

  const runOne = async w => {
    try {
      const connection = new Connection(rpcUrl, 'confirmed');
      const sol = await getSolBalance(connection, w.pubkey);
      if (sol < settings.minSolReserve + 0.001) {
        throw new Error(`SOL insuffisant (${sol.toFixed(4)}◎, réserve ${settings.minSolReserve}◎)`);
      }
      const data = await fn(w, connection);
      return { ok: true, wallet: w.label, pubkey: w.pubkey, ...data };
    } catch (e) {
      return { ok: false, wallet: w.label, pubkey: w.pubkey, error: e.message || String(e) };
    }
  };

  if (mode === 'sequential') {
    for (const w of wallets) results.push(await runOne(w));
  } else {
    const batch = await Promise.all(wallets.map(w => runOne(w)));
    results.push(...batch);
  }
  return results;
}

export function formatTradeResults(results, action) {
  const lines = results.map(r => {
    if (r.ok) {
      const sig = r.signature ? `\n[tx](https://solscan.io/tx/${r.signature})` : '';
      return `✅ **${r.wallet}** — ${action}${sig}`;
    }
    return `❌ **${r.wallet}** — ${r.error}`;
  });
  const ok = results.filter(r => r.ok).length;
  return { text: lines.join('\n'), ok, total: results.length };
}

export async function executeBuyTrade({ mint, solAmount, settings: sIn, rpcUrl: rpcIn }) {
  const settings = sIn || loadTradeSettings();
  if (!settings.tradingEnabled) throw new Error('Trading désactivé — active-le dans Paramètres → Trading.');
  const rpcUrl = rpcIn || primaryHeliusRpcUrl();
  const wallets = pickWallets(settings, getSigningWallets(settings));
  const amount = Number(solAmount);
  if (!amount || amount <= 0) throw new Error('Montant SOL invalide');

  const results = await runOnWallets(wallets, settings, rpcUrl, async w =>
    swapSolToToken({
      rpcUrl,
      keypair: w.keypair,
      outputMint: mint,
      solAmount: amount,
      slippageBps: settings.slippageBps,
      priorityFeeLamports: settings.priorityFeeLamports,
    }),
  );

  return formatTradeResults(results, `achat **${amount} SOL**`);
}

export async function executeSellTrade({ mint, sellPct, settings: sIn, rpcUrl: rpcIn }) {
  const settings = sIn || loadTradeSettings();
  if (!settings.tradingEnabled) throw new Error('Trading désactivé — active-le dans Paramètres → Trading.');
  const rpcUrl = rpcIn || primaryHeliusRpcUrl();
  const wallets = pickWallets(settings, getSigningWallets(settings));
  const pct = Number(sellPct);
  if (!pct || pct <= 0 || pct > 100) throw new Error('Pourcentage invalide');

  const results = await runOnWallets(wallets, settings, rpcUrl, async w =>
    swapTokenToSol({
      rpcUrl,
      keypair: w.keypair,
      inputMint: mint,
      sellPct: pct,
      slippageBps: settings.slippageBps,
      priorityFeeLamports: settings.priorityFeeLamports,
    }),
  );

  return formatTradeResults(results, `vente **${pct}%**`);
}

/** Snipe auto-buy quand un wallet surveillé achète (config par wallet). */
export async function maybeSnipeBuy(watchedWallet, hit, meta) {
  const settings = loadTradeSettings();
  if (!settings.tradingEnabled) return null;

  const snipe = getSnipeByAddr(watchedWallet?.addr, settings);
  if (!snipe?.autoBuy?.enabled) return null;

  const ab = snipe.autoBuy;
  if (ab.venues?.length && !ab.venues.includes(hit.venue)) return null;

  const mint = hit.mint;
  const seenKey = `${snipe.watchAddr}:${mint}`;
  const count = snipeBuySeen.get(seenKey) || 0;
  if (count >= (ab.maxPerMint || 1)) return null;
  snipeBuySeen.set(seenKey, count + 1);
  if (snipeBuySeen.size > 800) {
    const k = snipeBuySeen.keys().next().value;
    snipeBuySeen.delete(k);
  }

  const label = watchedWallet.label || snipe.watchAddr.slice(0, 8);
  const solAmount = computeSnipeBuySol(ab, hit);
  try {
    const result = await executeBuyTrade({ mint, solAmount, settings });
    return { ...result, snipeLabel: label, solAmount };
  } catch (e) {
    console.warn('snipe-buy', label, mint.slice(0, 8), e.message);
    return { text: `❌ Snipe **${label}** : ${e.message}`, ok: 0, total: 0, snipeLabel: label };
  }
}

/** Snipe auto-sell quand le wallet surveillé vend (même % de position). */
export async function maybeSnipeSell(watchedWallet, hit) {
  const settings = loadTradeSettings();
  if (!settings.tradingEnabled) return null;

  const snipe = getSnipeByAddr(watchedWallet?.addr, settings);
  if (!snipe?.autoBuy?.enabled || !snipe.autoBuy.autoSellEnabled) return null;

  const ab = snipe.autoBuy;
  if (ab.venues?.length && !ab.venues.includes(hit.venue)) return null;

  const mint = hit.mint;
  const sellPct = computeSnipeSellPct(ab, hit);
  const label = watchedWallet.label || snipe.watchAddr.slice(0, 8);

  try {
    const result = await executeSellTrade({ mint, sellPct, settings });
    return { ...result, snipeLabel: label, sellPct };
  } catch (e) {
    console.warn('snipe-sell', label, mint.slice(0, 8), e.message);
    return { text: `❌ Snipe sell **${label}** : ${e.message}`, ok: 0, total: 0, snipeLabel: label };
  }
}
