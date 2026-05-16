/**
 * Sauvegarde cloud (Vercel KV) — groupes + réglages
 * Variables Vercel : KV_REST_API_URL, KV_REST_API_TOKEN (Storage → KV)
 */
export async function GET(request) {
  const key = new URL(request.url).searchParams.get('key');
  if (!key || key.length < 32 || key.length > 128) {
    return Response.json({ ok: false, error: 'Clé sync invalide' }, { status: 400 });
  }
  try {
    const { kv } = await import('@vercel/kv');
    const data = await kv.get(`bt:${key}`);
    return Response.json({ ok: true, data: data || null });
  } catch (e) {
    return Response.json(
      { ok: false, error: 'Cloud indisponible — active Vercel KV (Storage)', detail: e.message },
      { status: 503 },
    );
  }
}

export async function POST(request) {
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
    const { kv } = await import('@vercel/kv');
    await kv.set(`bt:${key}`, body);
    return Response.json({ ok: true, savedAt: body.exportedAt });
  } catch (e) {
    return Response.json(
      { ok: false, error: 'Cloud indisponible — active Vercel KV (Storage)', detail: e.message },
      { status: 503 },
    );
  }
}
