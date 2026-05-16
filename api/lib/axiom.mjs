const pairCache = new Map();

/** Lien Axiom ouvrable depuis une notif ntfy (téléphone). */
export async function axiomTradeUrl(mint, pairAddress = '') {
  const m = String(mint || '').trim();
  if (pairAddress) {
    return `https://axiom.trade/meme/${encodeURIComponent(pairAddress)}?chain=sol`;
  }
  const m = String(mint || '').trim();
  if (!m) return 'https://axiom.trade/?chain=sol';
  if (pairCache.has(m)) return pairCache.get(m);

  let url = `https://axiom.trade/meme/${encodeURIComponent(m)}?chain=sol`;
  try {
    const r = await fetch(`https://api.dexscreener.com/latest/dex/tokens/${m}`, {
      headers: { Accept: 'application/json' },
      signal: AbortSignal.timeout(5000),
    });
    if (r.ok) {
      const j = await r.json();
      const pairs = Array.isArray(j.pairs) ? j.pairs : [];
      const best = pairs.find(p => p.chainId === 'solana') || pairs[0];
      const pair = best?.pairAddress || best?.pair_address;
      if (pair) url = `https://axiom.trade/meme/${encodeURIComponent(pair)}?chain=sol`;
    }
  } catch {}

  pairCache.set(m, url);
  if (pairCache.size > 400) pairCache.delete(pairCache.keys().next().value);
  return url;
}
