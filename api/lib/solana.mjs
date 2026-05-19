export const PUMP = '6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P';
export const PUMP_SWAP = 'pAMMBay6oceH9fJKBRHGP5D4bD4sWpmSwMn52FMfXEA';
const SOL_MINT = 'So11111111111111111111111111111111111111112';

export function heliusRpcUrl(apiKey) {
  return `https://mainnet.helius-rpc.com/?api-key=${apiKey}`;
}

export async function rpc(rpcUrl, method, params) {
  const r = await fetch(rpcUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
  });
  if (!r.ok) throw new Error(`RPC HTTP ${r.status}`);
  const j = await r.json();
  if (j.error) throw new Error(j.error.message || 'RPC error');
  return j.result;
}

function txAccountPubkeys(tx) {
  const msg = tx?.transaction?.message;
  if (!msg) return [];
  if (Array.isArray(msg.accountKeys)) {
    return msg.accountKeys.map(k => (typeof k === 'string' ? k : k?.pubkey || ''));
  }
  return [];
}

function solSpentByWalletDelta(tx, walletAddr) {
  const keys = txAccountPubkeys(tx);
  const wl = String(walletAddr || '').toLowerCase();
  const idx = keys.findIndex(pk => String(pk || '') === walletAddr || String(pk || '').toLowerCase() === wl);
  if (idx < 0) return 0;
  const pre = tx.meta?.preBalances?.[idx] ?? 0;
  const post = tx.meta?.postBalances?.[idx] ?? 0;
  return Math.max(0, (pre - post) / 1e9);
}

export function extractPumpBuyFromTx(tx, walletAddr) {
  if (!tx?.meta || tx.meta.err) return null;
  const logs = (tx.meta.logMessages || []).join(' ');
  if (!logs.includes(PUMP) || !logs.includes('Instruction: Buy')) return null;
  if (logs.includes('Instruction: Sell') && !logs.includes('Instruction: Buy')) return null;

  const pre = new Set((tx.meta.preTokenBalances || []).map(x => x.mint));
  const post = tx.meta.postTokenBalances || [];
  const fullKeys = txAccountPubkeys(tx);
  const wl = String(walletAddr || '').toLowerCase();
  const wIx = fullKeys.findIndex(pk => String(pk || '') === walletAddr || String(pk || '').toLowerCase() === wl);

  let mint = '';
  for (const pb of post) {
    const m = pb.mint || '';
    if (!m || m === SOL_MINT || m.length < 30 || m.length > 44) continue;
    if (wIx >= 0 && Math.abs(pb.accountIndex - wIx) > 6) continue;
    mint = m;
    break;
  }
  if (!mint) {
    for (const pb of post) {
      const m = pb.mint || '';
      if (m && m !== SOL_MINT && m.length >= 30 && m.length <= 44 && !pre.has(m)) {
        mint = m;
        break;
      }
    }
  }
  if (!mint) return null;
  const sol = solSpentByWalletDelta(tx, walletAddr);
  if (sol < 0.0005) return null;
  return { mint, sol, venue: 'curve' };
}

export function extractPumpSwapBuyFromTx(tx, walletAddr) {
  if (!tx?.meta || tx.meta.err) return null;
  const logs = (tx.meta.logMessages || []).join(' ');
  if (!logs.includes(PUMP_SWAP)) return null;
  if (logs.includes('Instruction: Sell') && !logs.includes('Instruction: Buy')) return null;
  const sol = solSpentByWalletDelta(tx, walletAddr);
  if (sol < 0.0005) return null;
  const wl = String(walletAddr || '').toLowerCase();
  const preByMint = new Map();
  for (const pb of tx.meta.preTokenBalances || []) {
    if ((pb.owner || '').toLowerCase() !== wl) continue;
    const m = pb.mint || '';
    if (!m || m === SOL_MINT) continue;
    preByMint.set(m, parseFloat(pb.uiTokenAmount?.uiAmount || pb.uiTokenAmount?.amount || 0) || 0);
  }
  for (const pb of tx.meta.postTokenBalances || []) {
    if ((pb.owner || '').toLowerCase() !== wl) continue;
    const m = pb.mint || '';
    if (!m || m === SOL_MINT || m.length < 30 || m.length > 44) continue;
    const postAmt = parseFloat(pb.uiTokenAmount?.uiAmount || pb.uiTokenAmount?.amount || 0) || 0;
    const preAmt = preByMint.get(m) || 0;
    if (postAmt > preAmt + 1e-12) return { mint: m, sol, venue: 'pumpswap' };
  }
  return null;
}

export function extractAnyBuyFromTx(tx, walletAddr) {
  return extractPumpBuyFromTx(tx, walletAddr) || extractPumpSwapBuyFromTx(tx, walletAddr);
}

const PUMP_MINT_RE = /[1-9A-HJ-NP-Za-km-z]{32,44}pump/g;

/** Tente d’extraire le mint depuis les logs Pump (avant getTransaction). */
export function extractQuickBuyFromLogs(logs) {
  const s = Array.isArray(logs) ? logs.join('\n') : String(logs || '');
  if (!s.includes('Instruction: Buy')) return null;
  const venue = s.includes(PUMP_SWAP) ? 'pumpswap' : s.includes(PUMP) ? 'curve' : 'curve';
  const pumpMatches = s.match(PUMP_MINT_RE);
  if (pumpMatches?.length) {
    return { mint: pumpMatches[pumpMatches.length - 1], sol: 0, venue, quick: true };
  }
  return null;
}

/** Forme getTransaction depuis une notif Helius transactionSubscribe. */
export function normalizeHeliusWsTransaction(result) {
  if (!result) return null;
  const wrap = result.transaction;
  if (!wrap) return null;

  if (wrap.meta) {
    let inner = wrap.transaction;
    if (Array.isArray(inner)) return null;
    if (inner?.message || inner?.signatures) {
      return { transaction: inner, meta: wrap.meta };
    }
    if (wrap.message) return { transaction: wrap, meta: wrap.meta };
  }

  if (result.meta && result.transaction && typeof result.transaction === 'object') {
    const inner = result.transaction;
    if (inner.message) return { transaction: inner, meta: result.meta };
  }

  return null;
}

function tokenSellHit(tx, walletAddr, venue) {
  const wl = String(walletAddr || '').toLowerCase();
  const preByMint = new Map();
  for (const pb of tx.meta.preTokenBalances || []) {
    if ((pb.owner || '').toLowerCase() !== wl) continue;
    const m = pb.mint || '';
    if (!m || m === SOL_MINT) continue;
    preByMint.set(
      m,
      parseFloat(pb.uiTokenAmount?.uiAmount || pb.uiTokenAmount?.amount || 0) || 0,
    );
  }
  for (const pb of tx.meta.postTokenBalances || []) {
    if ((pb.owner || '').toLowerCase() !== wl) continue;
    const m = pb.mint || '';
    if (!m || m === SOL_MINT || m.length < 30 || m.length > 44) continue;
    const postAmt = parseFloat(pb.uiTokenAmount?.uiAmount || pb.uiTokenAmount?.amount || 0) || 0;
    const preAmt = preByMint.get(m) || 0;
    if (preAmt > postAmt + 1e-12) {
      const sold = preAmt - postAmt;
      const sellPct = Math.min(100, Math.max(1, (sold / preAmt) * 100));
      const keys = txAccountPubkeys(tx);
      const idx = keys.findIndex(pk => String(pk || '').toLowerCase() === wl);
      let sol = 0;
      if (idx >= 0) {
        const pre = tx.meta?.preBalances?.[idx] ?? 0;
        const post = tx.meta?.postBalances?.[idx] ?? 0;
        sol = Math.max(0, (post - pre) / 1e9);
      }
      return { mint: m, sol, sellPct, venue };
    }
  }
  return null;
}

export function extractPumpSellFromTx(tx, walletAddr) {
  if (!tx?.meta || tx.meta.err) return null;
  const logs = (tx.meta.logMessages || []).join(' ');
  if (!logs.includes(PUMP) || !logs.includes('Instruction: Sell')) return null;
  if (logs.includes('Instruction: Buy')) return null;
  return tokenSellHit(tx, walletAddr, 'curve');
}

export function extractPumpSwapSellFromTx(tx, walletAddr) {
  if (!tx?.meta || tx.meta.err) return null;
  const logs = (tx.meta.logMessages || []).join(' ');
  if (!logs.includes(PUMP_SWAP) || !logs.includes('Instruction: Sell')) return null;
  if (logs.includes('Instruction: Buy')) return null;
  return tokenSellHit(tx, walletAddr, 'pumpswap');
}

export function extractAnySellFromTx(tx, walletAddr) {
  return extractPumpSellFromTx(tx, walletAddr) || extractPumpSwapSellFromTx(tx, walletAddr);
}

export async function fetchRecentSignatures(rpcUrl, addr, limit = 12) {
  const list = await rpc(rpcUrl, 'getSignaturesForAddress', [addr, { limit }]);
  return Array.isArray(list) ? list.filter(s => !s.err) : [];
}
