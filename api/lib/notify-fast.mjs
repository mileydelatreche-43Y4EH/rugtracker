import { axiomTradeUrl } from './axiom.mjs';
import { postNtfy, ntfyHeaderAscii } from './ntfy.mjs';
import {
  buildPhoneNtfyPayload,
  fetchTokenMetaFast,
  resolveTokenImageUrl,
} from './token-meta.mjs';

const META_TIMEOUT_MS = Number(process.env.NTFY_META_TIMEOUT_MS || 1400);

export async function notifyBuyFast(topic, w, hit, rpcCall, walletIndex = 0) {
  const label = w.label || w.addr.slice(0, 8);
  const mint = hit.mint;

  const metaP = fetchTokenMetaFast(mint, rpcCall, walletIndex);
  const clickP = metaP.then(m => axiomTradeUrl(mint, m.pairAddress));

  const meta = await Promise.race([
    metaP,
    new Promise(resolve => {
      setTimeout(
        () =>
          resolve({
            sym: mint.slice(0, 8).toUpperCase(),
            mcUsd: 0,
            pairAddress: '',
            snap: { risk: '…' },
          }),
        META_TIMEOUT_MS,
      );
    }),
  ]);

  const click = await clickP;
  const { title, body } = buildPhoneNtfyPayload(w, meta, mint);

  const attach = resolveTokenImageUrl(mint, meta);
  await postNtfy(topic, body, {
    title: ntfyHeaderAscii(title),
    click,
    attach: attach || undefined,
    tags: 'warning,money',
    priority: 'urgent',
  });

  console.log(`📱 ntfy → ${label} · ${meta.sym} · ${meta.snap?.risk || '?'}`);
}
