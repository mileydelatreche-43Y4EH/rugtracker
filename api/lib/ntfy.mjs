export function ntfyHeaderAscii(s) {
  return String(s || '')
    .replace(/[^\x20-\x7E]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 180) || 'BundleTracker';
}

export async function postNtfy(topic, body, meta = {}) {
  if (!topic) throw new Error('NTFY_TOPIC manquant');
  const params = new URLSearchParams();
  if (meta.title) params.set('title', ntfyHeaderAscii(meta.title));
  params.set('priority', meta.priority || 'urgent');
  if (meta.tags) params.set('tags', meta.tags);
  if (meta.click) params.set('click', meta.click);
  if (meta.attach) params.set('attach', meta.attach);
  const url = `https://ntfy.sh/${encodeURIComponent(topic)}?${params}`;
  const headers = {
    Title: ntfyHeaderAscii(meta.title),
    Priority: meta.priority || 'urgent',
    Tags: meta.tags || 'warning,money',
    Click: meta.click || '',
  };
  if (meta.attach) headers.Attach = meta.attach;
  const r = await fetch(url, {
    method: 'POST',
    body,
    headers,
  });
  if (!r.ok) {
    const errBody = await r.text().catch(() => '');
    throw new Error(`ntfy HTTP ${r.status}${errBody ? `: ${errBody.slice(0, 120)}` : ''}`);
  }
  return { ok: true, status: r.status };
}
