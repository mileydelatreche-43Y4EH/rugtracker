/**
 * Stockage cloud : REDIS_URL (TCP, Railway) ou REST (Vercel / Upstash).
 */
import { ensureKvEnv, hasKvCredentials, hasRedisUrl } from './kv-env.mjs';

let redisTcpClient = null;
let kvRestClient = null;

function isVercelRuntime() {
  return !!(process.env.VERCEL || process.env.VERCEL_ENV);
}

/** Vercel serverless : pas de Redis TCP — REST uniquement. */
function allowTcpRedis() {
  return hasRedisUrl() && !isVercelRuntime();
}

async function getTcpClient() {
  if (!allowTcpRedis()) return null;
  const url = hasRedisUrl();
  if (!url) return null;
  if (redisTcpClient?.isOpen) return redisTcpClient;
  const { createClient } = await import('redis');
  redisTcpClient = createClient({ url });
  redisTcpClient.on('error', e => console.warn('Redis TCP', e.message || e));
  await redisTcpClient.connect();
  return redisTcpClient;
}

async function getRestClient() {
  if (!hasKvCredentials()) return null;
  ensureKvEnv();
  if (!kvRestClient) {
    const { kv } = await import('@vercel/kv');
    kvRestClient = kv;
  }
  return kvRestClient;
}

export function cloudBackendLabel() {
  if (allowTcpRedis()) return 'Redis (REDIS_URL)';
  if (hasKvCredentials()) return 'Upstash REST';
  return null;
}

export async function cloudGet(key) {
  if (allowTcpRedis()) {
    try {
      const tcp = await getTcpClient();
      if (tcp) {
        const raw = await tcp.get(key);
        if (!raw) return null;
        try {
          return JSON.parse(raw);
        } catch {
          return raw;
        }
      }
    } catch (e) {
      console.warn('Redis TCP lecture', e.message || e);
    }
  }
  const rest = await getRestClient();
  if (rest) return rest.get(key);
  if (isVercelRuntime()) {
    throw new Error(
      'Sur Vercel : ajoute UPSTASH_REDIS_REST_URL + UPSTASH_REDIS_REST_TOKEN (onglet REST Upstash, pas REDIS_URL)',
    );
  }
  throw new Error('Redis non configuré — REDIS_URL ou UPSTASH_REDIS_REST_*');
}

export async function cloudSet(key, value) {
  const payload = typeof value === 'string' ? value : JSON.stringify(value);
  if (allowTcpRedis()) {
    try {
      const tcp = await getTcpClient();
      if (tcp) {
        await tcp.set(key, payload);
        return true;
      }
    } catch (e) {
      console.warn('Redis TCP écriture', e.message || e);
    }
  }
  const rest = await getRestClient();
  if (rest) {
    await rest.set(key, value);
    return true;
  }
  if (isVercelRuntime()) {
    throw new Error(
      'Sur Vercel : ajoute UPSTASH_REDIS_REST_URL + UPSTASH_REDIS_REST_TOKEN (onglet REST Upstash)',
    );
  }
  throw new Error('Redis non configuré');
}

export function isCloudStorageReady() {
  if (isVercelRuntime()) return hasKvCredentials();
  return !!(hasRedisUrl() || hasKvCredentials());
}
