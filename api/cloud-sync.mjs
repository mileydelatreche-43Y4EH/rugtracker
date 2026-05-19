/**
 * Sauvegarde cloud (site) — REDIS_URL ou REST Upstash/KV
 */
import { ensureKvEnv } from './lib/kv-env.mjs';
import { cloudGet, cloudSet, isCloudStorageReady } from './lib/redis-cloud.mjs';

export async function GET(request) {
  ensureKvEnv();
  if (!isCloudStorageReady()) {
    return Response.json(
      { ok: false, error: 'Redis non configuré — ajoute REDIS_URL ou KV_REST_API_*' },
      { status: 503 },
    );
  }
  const key = new URL(request.url).searchParams.get('key');
  if (!key || key.length < 32 || key.length > 128) {
    return Response.json({ ok: false, error: 'Clé sync invalide' }, { status: 400 });
  }
  try {
    const data = await cloudGet(`bt:${key}`);
    return Response.json({ ok: true, data: data || null });
  } catch (e) {
    return Response.json(
      { ok: false, error: 'Cloud indisponible', detail: e.message },
      { status: 503 },
    );
  }
}

export async function POST(request) {
  ensureKvEnv();
  if (!isCloudStorageReady()) {
    return Response.json(
      { ok: false, error: 'Redis non configuré — ajoute REDIS_URL ou KV_REST_API_*' },
      { status: 503 },
    );
  }
  const key = new URL(request.url).searchParams.get('key');
  if (!key || key.length < 32 || key.length > 128) {
    return Response.json({ ok: false, error: 'Clé sync invalide' }, { status: 400 });
  }
  let body;
  try {
    body = await request.json();
  } catch {
    return Response.json({ ok: false, error: 'JSON invalide' }, { status: 400 });
  }
  if (!body || body.v !== 1) {
    return Response.json({ ok: false, error: 'Backup invalide' }, { status: 400 });
  }
  try {
    await cloudSet(`bt:${key}`, body);
    return Response.json({ ok: true, savedAt: body.exportedAt });
  } catch (e) {
    return Response.json(
      { ok: false, error: 'Cloud indisponible', detail: e.message },
      { status: 503 },
    );
  }
}
