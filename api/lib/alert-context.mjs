/** Contexte éphémère des alertes (sig, liens) pour le bouton Menu. */
const cache = new Map();
const TTL_MS = 60 * 60 * 1000;

export function rememberAlertContext(mint, data) {
  const m = String(mint || '').trim();
  if (!m) return;
  cache.set(m, { ...data, at: Date.now() });
  if (cache.size > 200) {
    const oldest = [...cache.entries()].sort((a, b) => a[1].at - b[1].at)[0]?.[0];
    if (oldest) cache.delete(oldest);
  }
}

export function getAlertContext(mint) {
  const m = String(mint || '').trim();
  const hit = cache.get(m);
  if (!hit) return null;
  if (Date.now() - hit.at > TTL_MS) {
    cache.delete(m);
    return null;
  }
  return hit;
}
