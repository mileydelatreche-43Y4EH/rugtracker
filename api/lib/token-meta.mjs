export function fmtU(n) {
  const x = Number(n) || 0;
  if (x <= 0) return '—';
  if (x >= 1e6) return '$' + (x / 1e6).toFixed(2) + 'M';
  if (x >= 1e3) return '$' + (x / 1e3).toFixed(1) + 'K';
  return '$' + Math.round(x);
}

export function calcScore(holders, totalSupply, creator) {
  if (!holders.length || totalSupply <= 0) {
    return { risk: 'UNKNOWN', top1: 0, top5: 0, n: 0 };
  }
  const srt = [...holders].sort((a, b) => b.pct - a.pct);
  const top1 = srt[0]?.pct || 0;
  const top5 = srt.slice(0, 5).reduce((s, h) => s + h.pct, 0);
  const n = srt.length;
  let sc = 0;
  if (top1 > 60) sc += 35;
  else if (top1 > 35) sc += 22;
  else if (top1 > 20) sc += 12;
  else if (top1 > 10) sc += 5;
  if (top5 > 80) sc += 20;
  else if (top5 > 60) sc += 12;
  else if (top5 > 40) sc += 5;
  if (n < 10) sc += 15;
  else if (n < 30) sc += 7;
  if (creator) {
    const dh = srt.find(h => h.wallet === creator || h.address === creator);
    if (dh) {
      const cp = dh.pct;
      if (cp > 30) sc += 25;
      else if (cp > 15) sc += 15;
      else if (cp > 5) sc += 7;
    }
  }
  sc = Math.min(sc, 100);
  const risk = sc >= 75 ? 'DANGER' : sc >= 55 ? 'HIGH' : sc >= 35 ? 'MEDIUM' : sc >= 15 ? 'LOW' : 'SAFE';
  return { risk, top1: +top1.toFixed(2), top5: +top5.toFixed(2), n };
}

function pickDexPair(pairs) {
  const list = Array.isArray(pairs) ? pairs : [];
  const sol = list.filter(p => p.chainId === 'solana');
  const pool = sol.length ? sol : list;
  return pool.sort((a, b) => (b.liquidity?.usd || 0) - (a.liquidity?.usd || 0))[0] || null;
}

/** Dex + holders en parallèle (format notif identique au bureau). */
export async function fetchTokenMetaFast(mint, rpcCall, keyIndex = 0) {
  const symFallback = String(mint).slice(0, 8).toUpperCase();
  let sym = symFallback;
  let mcUsd = 0;
  let pairAddress = '';
  let creator = '';
  let snap = { risk: 'UNKNOWN' };

  const dexP = fetch(`https://api.dexscreener.com/latest/dex/tokens/${encodeURIComponent(mint)}`, {
    signal: AbortSignal.timeout(3500),
  })
    .then(r => (r.ok ? r.json() : null))
    .catch(() => null);

  const rpcP = Promise.all([
    rpcCall('getTokenLargestAccounts', [mint], keyIndex).catch(() => null),
    rpcCall('getTokenSupply', [mint], keyIndex).catch(() => null),
    rpcCall('getAsset', { id: mint }, keyIndex).catch(() => null),
  ]);

  const [dd, [hr, sr, das]] = await Promise.all([dexP, rpcP]);

  if (das?.content?.metadata?.symbol) sym = das.content.metadata.symbol;
  creator = (das?.authorities || [])[0]?.address || '';

  const pair = pickDexPair(dd?.pairs);
  if (pair) {
    if (pair.baseToken?.symbol && sym === symFallback) sym = pair.baseToken.symbol;
    pairAddress = pair.pairAddress || '';
    if (pair.fdv > 0) mcUsd = pair.fdv;
    else if (pair.marketCap > 0) mcUsd = pair.marketCap;
    else if (pair.priceUsd && sr?.value?.uiAmount) {
      mcUsd = parseFloat(pair.priceUsd) * parseFloat(sr.value.uiAmount);
    }
  }

  try {
    const ts = parseFloat(sr?.value?.uiAmount || 0);
    const holders = (hr?.value || []).slice(0, 10).map(h => ({
      wallet: h.address || '',
      pct: ts > 0 ? (parseFloat(h.uiAmount || 0) / ts) * 100 : 0,
    }));
    snap = calcScore(holders, ts, creator);
  } catch {}

  return { sym, mcUsd, pairAddress, snap };
}

export function buildPhoneNtfyPayload(w, meta, mint) {
  const label = w.label || w.addr?.slice(0, 8) || 'Bundle';
  const sym = meta.sym || mint.slice(0, 6).toUpperCase();
  const risk = meta.snap?.risk || 'UNKNOWN';
  return {
    title: `🎯 ${sym} — nouveau token`,
    body: `${label}\nMC ${fmtU(meta.mcUsd)} · ${risk}`,
  };
}
