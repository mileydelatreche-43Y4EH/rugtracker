import { axiomTradeUrl, axiomTradeUrlInstant } from './axiom.mjs';
import {
  sendDiscordBuyAlert,
  enrichDiscordBuyAlert,
} from './discord-alert.mjs';
import { sendWebhookBuyAlert } from './discord-webhook.mjs';
import { notifyBuyFast } from './notify-fast.mjs';
import {
  fetchTokenMetaFast,
  minimalTokenMeta,
  resolveTokenImageQuick,
} from './token-meta.mjs';
import { shouldSkipDuplicateGroupBuy } from './alert-dedupe.mjs';

const META_ENRICH_MS = Number(process.env.NTFY_META_TIMEOUT_MS || 6000);
const IMAGE_ENRICH_MS = Number(process.env.ALERT_IMAGE_MS || 2500);
const LOG_TIMING = process.env.ALERT_TIMING === '1';

export async function fetchBuyMeta(mint, rpcCall, walletIndex) {
  const metaP = fetchTokenMetaFast(mint, rpcCall, walletIndex);
  return Promise.race([
    metaP,
    new Promise(resolve => {
      setTimeout(() => resolve(minimalTokenMeta(mint)), META_ENRICH_MS);
    }),
  ]);
}

/** Met à jour l’embed : image dès qu’elle arrive, puis MC / nom / lien Axiom. */
async function enrichDiscordAlert(message, w, hit, sig, rpcCall, walletIndex) {
  if (!message?.edit) return;
  const mint = hit.mint;
  const imageP = resolveTokenImageQuick(mint, {}, IMAGE_ENRICH_MS);

  void imageP.then(async img => {
    if (!img) return;
    try {
      await enrichDiscordBuyAlert(message, {
        w,
        hit,
        meta: { ...minimalTokenMeta(mint), imageUrl: img },
        sig,
        axiomUrl: axiomTradeUrlInstant(mint),
      });
    } catch {
      /* message supprimé ou rate limit */
    }
  });

  const [meta, axiomUrl] = await Promise.all([
    fetchBuyMeta(mint, rpcCall, walletIndex),
    axiomTradeUrl(mint, ''),
  ]);
  const img = await imageP;
  if (img && !meta.imageUrl) meta.imageUrl = img;
  try {
    await enrichDiscordBuyAlert(message, { w, hit, meta, sig, axiomUrl });
  } catch {
    /* ignore */
  }
}

/** Alerte achat : Discord + ntfy immédiats, enrichissement après. */
export async function notifyBuyAlert(ctx, w, hit, sig, rpcCall, walletIndex = 0, opts = {}) {
  const t0 = opts.detectedAt || Date.now();
  const mint = hit.mint;

  if (shouldSkipDuplicateGroupBuy(w, mint)) {
    console.log(
      `⏭ Alerte ignorée (groupe · ${w.groupName || '?'}) · ${mint.slice(0, 8)}… · ${w.label}`,
    );
    return;
  }

  const flashMeta = minimalTokenMeta(mint);
  const axiomInstant = axiomTradeUrlInstant(mint);

  if (ctx.ntfyTopic) {
    void notifyBuyFast(ctx.ntfyTopic, w, hit).catch(e =>
      console.warn('ntfy', e.message || e),
    );
  }

  let discordMsg = null;
  if (ctx.discordChannel) {
    discordMsg = await sendDiscordBuyAlert(ctx.discordChannel, {
      w,
      hit,
      meta: flashMeta,
      sig,
      axiomUrl: axiomInstant,
    });
    if (LOG_TIMING) {
      console.log(`⚡ Discord flash ${Date.now() - t0}ms · ${w.label} · ${flashMeta.sym}`);
    } else {
      console.log(`💬 Discord → ${w.label} · ${flashMeta.sym} · ${w.groupName || ''}`);
    }
    void enrichDiscordAlert(discordMsg, w, hit, sig, rpcCall, walletIndex);
  } else if (ctx.webhookUrl) {
    const meta = await fetchBuyMeta(mint, rpcCall, walletIndex);
    const axiomUrl = await axiomTradeUrl(mint, meta.pairAddress);
    await sendWebhookBuyAlert(ctx.webhookUrl, { w, hit, meta, sig, axiomUrl });
    console.log(`🔗 Webhook → ${w.label} · ${meta.sym}`);
  }
}
