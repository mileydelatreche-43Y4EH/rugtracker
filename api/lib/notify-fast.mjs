import { axiomTradeUrlInstant } from './axiom.mjs';
import { postNtfy, ntfyHeaderAscii } from './ntfy.mjs';
import { buildPhoneNtfyPayload, minimalTokenMeta, resolveTokenImageQuick } from './token-meta.mjs';

const NTFY_IMAGE_MS = Number(process.env.NTFY_IMAGE_MS || 350);

/** Notif téléphone : texte tout de suite, image si dispo en <350 ms. */
export async function notifyBuyFast(topic, w, hit) {
  const label = w.label || w.addr.slice(0, 8);
  const mint = hit.mint;
  const click = axiomTradeUrlInstant(mint);
  const meta = minimalTokenMeta(mint);
  const { title, body } = buildPhoneNtfyPayload(w, meta, mint, click);

  const img = await Promise.race([
    resolveTokenImageQuick(mint, meta, NTFY_IMAGE_MS),
    new Promise(resolve => {
      setTimeout(() => resolve(''), NTFY_IMAGE_MS);
    }),
  ]);

  await postNtfy(topic, body, {
    title: ntfyHeaderAscii(title),
    click,
    attach: img && img.startsWith('http') ? img : undefined,
    tags: 'warning,money',
    priority: 'urgent',
  });

  console.log(`📱 ntfy → ${label} · ${meta.sym}${img ? ' · img' : ''}`);
}
