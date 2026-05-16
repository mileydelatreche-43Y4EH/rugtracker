/**
 * Vercel Cron — sonde les wallets chaque minute et pousse sur ntfy.
 * Nécessite : HELIUS_API_KEY, NTFY_TOPIC, WATCH_WALLETS (JSON)
 * Déduplication : Vercel KV si configuré, sinon fenêtre ~90 s (risque de doublon rare).
 */
import { postNtfy, ntfyHeaderAscii } from '../lib/ntfy.mjs';
import { heliusRpcUrl, rpc, fetchRecentSignatures, extractPumpBuyFromTx } from '../lib/solana.mjs';

export const config = { maxDuration: 60 };

async function getKv() {
  try {
    const { kv } = await import('@vercel/kv');
    return kv;
  } catch {
    return null;
  }
}

async function wasSeen(kv, key) {
  if (!kv) return false;
  try {
    return !!(await kv.get(key));
  } catch {
    return false;
  }
}

async function markSeen(kv, key) {
  if (!kv) return;
  try {
    await kv.set(key, '1', { ex: 60 * 60 * 24 * 7 });
  } catch {}
}

export default async function handler(request) {
  const cronSecret = process.env.CRON_SECRET;
  if (cronSecret) {
    const auth = request.headers.get('authorization');
    if (auth !== `Bearer ${cronSecret}`) {
      return new Response('Unauthorized', { status: 401 });
    }
  }

  const apiKey = process.env.HELIUS_API_KEY;
  const topic = (process.env.NTFY_TOPIC || '').trim();
  if (!apiKey || !topic) {
    return Response.json({ ok: false, error: 'HELIUS_API_KEY et NTFY_TOPIC requis' }, { status: 500 });
  }

  let wallets = [];
  try {
    wallets = JSON.parse(process.env.WATCH_WALLETS || '[]');
  } catch {
    return Response.json({ ok: false, error: 'WATCH_WALLETS JSON invalide' }, { status: 500 });
  }
  if (!wallets.length) {
    return Response.json({ ok: false, error: 'WATCH_WALLETS vide' }, { status: 500 });
  }

  const rpcUrl = heliusRpcUrl(apiKey);
  const kv = await getKv();
  const now = Math.floor(Date.now() / 1000);
  const maxAge = Number(process.env.POLL_MAX_AGE_SEC || 90);
  let notified = 0;
  const errors = [];

  for (const w of wallets) {
    const addr = w.addr || w.address;
    if (!addr) continue;
    const label = w.label || addr.slice(0, 8);
    try {
      const sigs = await fetchRecentSignatures(rpcUrl, addr, 15);
      for (const s of sigs) {
        const sig = s.signature;
        const bt = s.blockTime || 0;
        if (!sig) continue;
        if (!kv && bt && now - bt > maxAge) continue;

        const sigKey = `sig:${sig}`;
        if (await wasSeen(kv, sigKey)) continue;

        const tx = await rpc(rpcUrl, 'getTransaction', [
          sig,
          { encoding: 'jsonParsed', maxSupportedTransactionVersion: 0 },
        ]);
        const hit = extractPumpBuyFromTx(tx, addr);
        if (!hit) continue;

        const mintKey = `mint:${hit.mint}`;
        if (await wasSeen(kv, mintKey)) {
          await markSeen(kv, sigKey);
          continue;
        }

        const body = [
          `>>> ${label} — achat Pump`,
          `SOL: ${hit.sol.toFixed(3)}`,
          hit.mint,
        ].join('\n');
        const click = `https://pump.fun/${hit.mint}`;
        const res = await postNtfy(topic, body, {
          title: ntfyHeaderAscii(`${label} | nouveau mint`),
          click,
        });
        if (res.ok) {
          notified++;
          await markSeen(kv, sigKey);
          await markSeen(kv, mintKey);
        } else {
          errors.push(`ntfy ${res.status}`);
        }
      }
    } catch (e) {
      errors.push(`${label}: ${e.message || e}`);
    }
  }

  return Response.json({
    ok: true,
    notified,
    wallets: wallets.length,
    kv: !!kv,
    errors: errors.slice(0, 5),
  });
}
