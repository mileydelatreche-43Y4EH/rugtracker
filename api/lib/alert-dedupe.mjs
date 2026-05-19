/** Évite plusieurs alertes Discord pour le même token en rafale (par wallet). */
const recent = new Map();
const TTL_MS = Number(process.env.ALERT_DEDUPE_MS || 30_000);

export function shouldSkipDuplicateChannelAlert(mint, walletAddr) {
  const m = String(mint || '').trim();
  if (!m) return false;
  const key = walletAddr ? `${String(walletAddr).trim()}:${m}` : m;
  const now = Date.now();
  const last = recent.get(key);
  if (last && now - last < TTL_MS) return true;
  recent.set(key, now);
  if (recent.size > 500) {
    const cutoff = now - TTL_MS;
    for (const [k, t] of recent) {
      if (t < cutoff) recent.delete(k);
    }
  }
  return false;
}
