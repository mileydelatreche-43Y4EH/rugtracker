/** Une seule alerte Discord par token et par groupe (tous wallets confondus). */
const recent = new Map();
/** 0 = pas d’expiration jusqu’au redémarrage du bot. Sinon durée en ms. */
const TTL_MS = Number(process.env.ALERT_DEDUPE_MS ?? 0);

export function groupMintDedupeKey(w, mint) {
  const m = String(mint || '').trim();
  const g = String(w?.groupId || w?.groupName || '').trim();
  if (!m || !g) return '';
  return `${g}:${m}`;
}

export function shouldSkipDuplicateGroupBuy(w, mint) {
  const key = groupMintDedupeKey(w, mint);
  if (!key) return false;
  const now = Date.now();
  const last = recent.get(key);
  if (last != null && (TTL_MS <= 0 || now - last < TTL_MS)) return true;
  recent.set(key, now);
  if (recent.size > 5000) {
    const cutoff = TTL_MS > 0 ? now - TTL_MS : 0;
    for (const [k, t] of recent) {
      if (TTL_MS <= 0 || t < cutoff) recent.delete(k);
    }
  }
  return false;
}

/** @deprecated Utiliser shouldSkipDuplicateGroupBuy */
export function shouldSkipDuplicateChannelAlert(mint, groupKey) {
  return shouldSkipDuplicateGroupBuy({ groupId: groupKey }, mint);
}
