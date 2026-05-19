/**
 * Stockage cloud unifié : REDIS_URL (Upstash TCP) ou REST (KV / Upstash REST).
 */
import { ensureKvEnv, hasKvCredentials, hasRedisUrl } from './kv-env.mjs';

let redisTcpClient = null;
let kvRestClient = null;

async function getTcpClient() {
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
  if (hasRedisUrl()) return 'Redis (REDIS_URL)';
  if (hasKvCredentials()) return 'Upstash REST';
  return null;
}

export async function cloudGet(key) {
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
  const rest = await getRestClient();
  if (rest) return rest.get(key);
  throw new Error('Redis non configuré');
}

export async function cloudSet(key, value) {
  const payload = typeof value === 'string' ? value : JSON.stringify(value);
  const tcp = await getTcpClient();
  if (tcp) {
    await tcp.set(key, payload);
    return true;
  }
  const rest = await getRestClient();
  if (rest) {
    await rest.set(key, value);
    return true;
  }
  throw new Error('Redis non configuré');
}

export function isCloudStorageReady() {
  return !!(hasRedisUrl() || hasKvCredentials());
}
