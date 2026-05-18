import { axiomTradeUrl } from './axiom.mjs';
import { sendDiscordBuyAlert } from './discord-alert.mjs';
import { sendWebhookBuyAlert } from './discord-webhook.mjs';
import { notifyBuyFast } from './notify-fast.mjs';
import { fetchTokenMetaFast } from './token-meta.mjs';

const META_TIMEOUT_MS = Number(process.env.NTFY_META_TIMEOUT_MS || 1400);

export async function fetchBuyMeta(mint, rpcCall, walletIndex) {
  const metaP = fetchTokenMetaFast(mint, rpcCall, walletIndex);
  return Promise.race([
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
}

/** Alerte achat : Discord (+ ntfy optionnel). */
export async function notifyBuyAlert(ctx, w, hit, sig, rpcCall, walletIndex = 0) {
  const mint = hit.mint;
  const meta = await fetchBuyMeta(mint, rpcCall, walletIndex);
  const axiomUrl = await axiomTradeUrl(mint, meta.pairAddress);

  if (ctx.discordChannel) {
    await sendDiscordBuyAlert(ctx.discordChannel, { w, hit, meta, sig, axiomUrl });
    console.log(
      `💬 Discord → ${w.label} · ${meta.sym} · ${meta.snap?.risk || '?'} · ${w.groupName || ''}`,
    );
  } else if (ctx.webhookUrl) {
    await sendWebhookBuyAlert(ctx.webhookUrl, { w, hit, meta, sig, axiomUrl });
    console.log(
      `🔗 Webhook → ${w.label} · ${meta.sym} · ${meta.snap?.risk || '?'} · ${w.groupName || ''}`,
    );
  }

  if (ctx.ntfyTopic) {
    await notifyBuyFast(ctx.ntfyTopic, w, hit, rpcCall, walletIndex);
  }
}
