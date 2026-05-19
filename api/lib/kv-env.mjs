/** Mappe Upstash / Vercel KV vers les variables attendues par @vercel/kv. */
export function ensureKvEnv() {
  const url = process.env.KV_REST_API_URL?.trim() || process.env.UPSTASH_REDIS_REST_URL?.trim();
  const token =
    process.env.KV_REST_API_TOKEN?.trim() || process.env.UPSTASH_REDIS_REST_TOKEN?.trim();
  if (url && !process.env.KV_REST_API_URL) process.env.KV_REST_API_URL = url;
  if (token && !process.env.KV_REST_API_TOKEN) process.env.KV_REST_API_TOKEN = token;
  return { url, token };
}

export function hasKvCredentials() {
  const { url, token } = ensureKvEnv();
  return !!(url && token);
}

export function hasRedisUrl() {
  const url = (process.env.REDIS_URL || process.env.UPSTASH_REDIS_URL || '').trim();
  return url || null;
}

export function isCloudStorageReady() {
  return !!(hasRedisUrl() || hasKvCredentials());
}
