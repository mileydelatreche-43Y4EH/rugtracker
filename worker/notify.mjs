/**
 * Worker 24/7 — WebSocket Helius + push ntfy (comme le navigateur, mais toujours allumé).
 *
 * Usage local :
 *   cp .env.example .env   # remplir HELIUS_API_KEY, NTFY_TOPIC, WATCH_WALLETS
 *   node worker/notify.mjs
 *
 * Hébergement : Railway, Render, Fly.io, VPS (pas Vercel — pas de WS longue durée).
 */
import { readFileSync, existsSync } from 'fs';
import { postNtfy, ntfyHeaderAscii } from '../api/lib/ntfy.mjs';
import { heliusRpcUrl, rpc, extractPumpBuyFromTx } from '../api/lib/solana.mjs';

const PUMP = '6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P';

function loadEnvFile() {
  const p = new URL('../.env', import.meta.url);
  if (!existsSync(p)) return;
  for (const line of readFileSync(p, 'utf8').split('\n')) {
    const t = line.trim();
    if (!t || t.startsWith('#')) continue;
    const i = t.indexOf('=');
    if (i < 0) continue;
    const k = t.slice(0, i).trim();
    let v = t.slice(i + 1).trim();
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) {
      v = v.slice(1, -1);
    }
    if (!process.env[k]) process.env[k] = v;
  }
}

loadEnvFile();

const apiKey = process.env.HELIUS_API_KEY;
const topic = (process.env.NTFY_TOPIC || '').trim();
let wallets = [];
try {
  wallets = JSON.parse(process.env.WATCH_WALLETS || '[]');
} catch {
  console.error('WATCH_WALLETS JSON invalide');
  process.exit(1);
}

if (!apiKey || !topic || !wallets.length) {
  console.error('Requis : HELIUS_API_KEY, NTFY_TOPIC, WATCH_WALLETS dans .env');
  process.exit(1);
}

const rpcUrl = heliusRpcUrl(apiKey);
const wsUrl = `wss://mainnet.helius-rpc.com/?api-key=${apiKey}`;
const seenSigs = new Set();
const seenMints = new Set();

function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}

async function notifyBuy(w, hit, sig) {
  const label = w.label || w.addr.slice(0, 8);
  const body = [
    `>>> ${label} — achat Pump (worker 24/7)`,
    `SOL: ${hit.sol.toFixed(3)}`,
    hit.mint,
  ].join('\n');
  await postNtfy(topic, body, {
    title: ntfyHeaderAscii(`${label} | ${hit.mint.slice(0, 6)}`),
    click: `https://pump.fun/${hit.mint}`,
  });
  console.log(`📱 ntfy → ${label} ${hit.mint.slice(0, 12)}…`);
}

async function handleSig(w, sig, blockTime) {
  if (!sig || seenSigs.has(sig)) return;
  seenSigs.add(sig);
  if (seenSigs.size > 8000) {
    const a = [...seenSigs];
    seenSigs.clear();
    a.slice(-4000).forEach(s => seenSigs.add(s));
  }
  try {
    const tx = await rpc(rpcUrl, 'getTransaction', [
      sig,
      { encoding: 'jsonParsed', maxSupportedTransactionVersion: 0 },
    ]);
    const hit = extractPumpBuyFromTx(tx, w.addr);
    if (!hit) return;
    if (seenMints.has(hit.mint)) return;
    seenMints.add(hit.mint);
    await notifyBuy(w, hit, sig);
  } catch (e) {
    console.warn('handleSig', w.label, e.message || e);
  }
}

function startWalletWs(w) {
  const box = { w, stopped: false, ws: null };

  function connect() {
    if (box.stopped) return;
    const ws = new WebSocket(wsUrl);
    box.ws = ws;
    let subId;

    ws.onopen = () => {
      ws.send(JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'logsSubscribe',
        params: [{ mentions: [w.addr] }, { commitment: 'confirmed' }],
      }));
      console.log(`✅ WS ${w.label}`);
    };

    ws.onmessage = (ev) => {
      try {
        const d = JSON.parse(ev.data);
        if (d.result !== undefined && d.id === 1) {
          subId = d.result;
          return;
        }
        const val = d?.params?.result?.value;
        if (!val) return;
        const logs = (val.logs || []).join(' ');
        const sig = val.signature || '';
        if (!logs.includes(PUMP) || !logs.includes('Instruction: Buy')) return;
        void handleSig(w, sig, Math.floor(Date.now() / 1000));
      } catch {}
    };

    ws.onclose = () => {
      if (box.stopped) return;
      console.log(`🔌 WS ${w.label} — reconnexion 3s`);
      setTimeout(connect, 3000);
    };

    ws.onerror = () => ws.close();
  }

  connect();
  return box;
}

async function warmStart() {
  const cutoff = Math.floor(Date.now() / 1000) - 7200;
  for (const w of wallets) {
    try {
      const sigs = await rpc(rpcUrl, 'getSignaturesForAddress', [w.addr, { limit: 40 }]);
      for (const s of sigs || []) {
        if ((s.blockTime || 0) < cutoff) continue;
        seenSigs.add(s.signature);
        const tx = await rpc(rpcUrl, 'getTransaction', [
          s.signature,
          { encoding: 'jsonParsed', maxSupportedTransactionVersion: 0 },
        ]);
        const hit = extractPumpBuyFromTx(tx, w.addr);
        if (hit) seenMints.add(hit.mint);
      }
    } catch (e) {
      console.warn('warmStart', w.label, e.message);
    }
    await sleep(400);
  }
  console.log(`Warm-start : ${seenMints.size} mint(s) récents ignorés`);
}

console.log(`Bundle Tracker worker — ${wallets.length} wallet(s) → ntfy:${topic.slice(0, 12)}…`);
await warmStart();
for (const w of wallets) {
  if (w.addr) startWalletWs(w);
}

// Keep-alive ping
setInterval(() => {}, 60000);
