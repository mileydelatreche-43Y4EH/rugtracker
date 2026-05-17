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

export async function fetchRecentSignatures(rpcUrl, addr, limit = 12) {
  const list = await rpc(rpcUrl, 'getSignaturesForAddress', [addr, { limit }]);
  return Array.isArray(list) ? list.filter(s => !s.err) : [];
}
