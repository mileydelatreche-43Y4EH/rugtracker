/** Évite plusieurs alertes Discord pour le même token en rafale. */
const recent = new Map();
const TTL_MS = Number(process.env.ALERT_DEDUPE_MS || 60_000);

export function shouldSkipDuplicateChannelAlert(mint) {
  const m = String(mint || '').trim();
  if (!m) return false;
  const now = Date.now();
  const last = recent.get(m);
  if (last && now - last < TTL_MS) return true;
  recent.set(m, now);
  if (recent.size > 500) {
    const cutoff = now - TTL_MS;
    for (const [k, t] of recent) {
      if (t < cutoff) recent.delete(k);
    }
  }
  return false;
}
