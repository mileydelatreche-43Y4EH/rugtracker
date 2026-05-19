import { axiomTradeUrl, axiomTradeUrlInstant } from './axiom.mjs';
import {
  sendDiscordBuyAlert,
  enrichDiscordBuyAlert,
} from './discord-alert.mjs';
import { sendWebhookBuyAlert } from './discord-webhook.mjs';
import { notifyBuyFast } from './notify-fast.mjs';
import { fetchTokenMetaFast, minimalTokenMeta, resolveTokenImageQuick } from './token-meta.mjs';
import { maybeSnipeBuy, maybeSnipeSell } from './trade-executor.mjs';
import { shouldSkipDuplicateChannelAlert } from './alert-dedupe.mjs';
import { extractAnyBuyFromTx } from './solana.mjs';

const META_ENRICH_MS = Number(process.env.NTFY_META_TIMEOUT_MS || 6000);
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

async function resolveHitForSnipe(hit, w, sig, rpcCall, walletIndex) {
  if (hit?.sol > 0 || !sig || !rpcCall) return hit;
  try {
    const tx = await rpcCall(
      'getTransaction',
      [sig, { encoding: 'jsonParsed', maxSupportedTransactionVersion: 0 }],
      walletIndex,
    );
    const full = extractAnyBuyFromTx(tx, w.addr);
    return full || hit;
  } catch {
    return hit;
  }
}

async function enrichDiscordAlert(ctx, message, w, hit, sig, rpcCall, walletIndex) {
  const mint = hit.mint;
  const [meta, axiomUrl] = await Promise.all([
    fetchBuyMeta(mint, rpcCall, walletIndex),
    axiomTradeUrl(mint, ''),
  ]);
  if (message) {
    await enrichDiscordBuyAlert(message, { w, hit, meta, sig, axiomUrl });
  }
  const hitSnipe = await resolveHitForSnipe(hit, w, sig, rpcCall, walletIndex);
  void maybeSnipeBuy(w, hitSnipe, meta).then(r => {
    if (r?.ok > 0 && r?.text && ctx.discordChannel) {
      const amt = r.solAmount != null ? ` · **${r.solAmount} SOL**` : '';
      ctx.discordChannel
        .send({
          content: `🎯 **Snipe buy** · ${r.snipeLabel || w.label} · ${meta.sym}${amt}\n${r.text}`,
        })
        .catch(e => console.warn('snipe-buy msg', e.message));
    }
  });
}

/** Alerte achat : envoi Discord immédiat, meta en arrière-plan. */
export async function notifyBuyAlert(ctx, w, hit, sig, rpcCall, walletIndex = 0, opts = {}) {
  const t0 = opts.detectedAt || Date.now();
  const mint = hit.mint;
  const flashMeta = minimalTokenMeta(mint);
  const axiomInstant = axiomTradeUrlInstant(mint);
  const imgQuick = await resolveTokenImageQuick(mint, flashMeta, 450);
  if (imgQuick) flashMeta.imageUrl = imgQuick;

  let discordMsg = null;
  if (ctx.discordChannel) {
    const dup = shouldSkipDuplicateChannelAlert(mint, w.addr);
    if (!dup) {
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
      void enrichDiscordAlert(ctx, discordMsg, w, hit, sig, rpcCall, walletIndex);
    } else {
      console.log(`⏭ Alerte ignorée (doublon) · ${flashMeta.sym} · ${w.label}`);
      void enrichDiscordAlert(ctx, null, w, hit, sig, rpcCall, walletIndex);
    }
  } else if (ctx.webhookUrl) {
    const meta = await fetchBuyMeta(mint, rpcCall, walletIndex);
    const axiomUrl = await axiomTradeUrl(mint, meta.pairAddress);
    await sendWebhookBuyAlert(ctx.webhookUrl, { w, hit, meta, sig, axiomUrl });
    console.log(`🔗 Webhook → ${w.label} · ${meta.sym}`);
    const hitSnipe = await resolveHitForSnipe(hit, w, sig, rpcCall, walletIndex);
    void maybeSnipeBuy(w, hitSnipe, meta);
  }

  if (ctx.ntfyTopic) {
    void notifyBuyFast(ctx.ntfyTopic, w, hit, rpcCall, walletIndex);
  }
}

/** Détection vente wallet surveillé → snipe auto-sell si activé. */
export async function notifySellAlert(ctx, w, hit) {
  if (!ctx.discordChannel) return;
  void maybeSnipeSell(w, hit).then(r => {
    if (r?.text) {
      const pct = r.sellPct != null ? ` · **${Math.round(r.sellPct)}%**` : '';
      ctx.discordChannel
        .send({
          content: `🎯 **Snipe sell** · ${r.snipeLabel || w.label}${pct}\n${r.text}`,
        })
        .catch(e => console.warn('snipe-sell msg', e.message));
    }
  });
}
