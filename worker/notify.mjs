/**
 * Worker 24/7 — WebSocket Helius + push ntfy (format = bureau, latence min.)
 */
import { readFileSync, existsSync } from 'fs';
import { notifyBuyFast } from '../api/lib/notify-fast.mjs';
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

function parseHeliusKeys() {
  const raw = process.env.HELIUS_API_KEYS || process.env.HELIUS_API_KEY || '';
  const keys = String(raw)
    .split(/[,;\s]+/)
    .map(s => {
      let k = s.trim();
      if (k.includes('api-key=')) k = k.split('api-key=').pop().split('&')[0].trim();
      return k;
    })
    .filter(k => k.length > 10 && !k.includes('helius-rpc.com'));
  return [...new Set(keys)];
}

loadEnvFile();

const HELIUS_KEYS = parseHeliusKeys();
const topic = (process.env.NTFY_TOPIC || '').trim();
let wallets = [];
try {
  wallets = JSON.parse(process.env.WATCH_WALLETS || '[]');
} catch {
  console.error('WATCH_WALLETS JSON invalide');
  process.exit(1);
}

if (!HELIUS_KEYS.length || !topic || !wallets.length) {
  console.error('Requis : HELIUS_API_KEY (ou HELIUS_API_KEYS), NTFY_TOPIC, WATCH_WALLETS');
  process.exit(1);
}

let rpcRound = 0;
function pickKey(i = 0) {
  return HELIUS_KEYS[(i + rpcRound) % HELIUS_KEYS.length];
}
function rpcUrlForKey(key) {
  return heliusRpcUrl(key);
}
function wsUrlForKey(key) {
  return `wss://mainnet.helius-rpc.com/?api-key=${key}`;
}

const seenSigs = new Set();
const seenMints = new Set();
const isRailway = !!(process.env.RAILWAY_ENVIRONMENT || process.env.RAILWAY_PROJECT_ID);
const singleKey = HELIUS_KEYS.length === 1;
const railwayPollOnly = isRailway && singleKey && process.env.RAILWAY_WS_MODE !== '1';
const wsCommitment =
  process.env.WORKER_WS_COMMITMENT === 'confirmed' ? 'confirmed' : 'processed';
const walletIndexByAddr = new Map(wallets.map((w, i) => [w.addr, i]));

function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}

async function rpcCall(method, params, keyIndex = 0) {
  const key = pickKey(keyIndex);
  rpcRound++;
  try {
    return await rpc(rpcUrlForKey(key), method, params);
  } catch (e) {
    const msg = e.message || String(e);
    if (msg.includes('429') && HELIUS_KEYS.length > 1) {
      await sleep(400);
      return rpc(rpcUrlForKey(pickKey(keyIndex + 1)), method, params);
    }
    throw e;
  }
}

async function handleSig(w, sig) {
  if (!sig || seenSigs.has(sig)) return;
  seenSigs.add(sig);
  if (seenSigs.size > 8000) {
    const a = [...seenSigs];
    seenSigs.clear();
    a.slice(-4000).forEach(s => seenSigs.add(s));
  }
  const wi = walletIndexByAddr.get(w.addr) ?? 0;
  try {
    const tx = await rpcCall(
      'getTransaction',
      [sig, { encoding: 'jsonParsed', maxSupportedTransactionVersion: 0 }],
      wi,
    );
    const hit = extractPumpBuyFromTx(tx, w.addr);
    if (!hit) return;
    if (seenMints.has(hit.mint)) return;
    seenMints.add(hit.mint);
    await notifyBuyFast(topic, w, hit, rpcCall, wi);
  } catch (e) {
    console.warn('handleSig', w.label, e.message || e);
  }
}

function startWalletWs(w, walletIndex) {
  const key = pickKey(walletIndex);
  const wsUrl = wsUrlForKey(key);
  const box = { w, stopped: false, ws: null, reconnectTimer: null, backoffMs: 3000 };

  function connect() {
    if (box.stopped) return;
    if (box.ws && (box.ws.readyState === WebSocket.OPEN || box.ws.readyState === WebSocket.CONNECTING)) {
      return;
    }
    const ws = new WebSocket(wsUrl);
    box.ws = ws;

    ws.onopen = () => {
      box.backoffMs = 3000;
      ws.send(
        JSON.stringify({
          jsonrpc: '2.0',
          id: 1,
          method: 'logsSubscribe',
          params: [{ mentions: [w.addr] }, { commitment: wsCommitment }],
        }),
      );
      console.log(`✅ WS ${w.label} (clé #${(walletIndex % HELIUS_KEYS.length) + 1}, ${wsCommitment})`);
    };

    ws.onmessage = ev => {
      try {
        const d = JSON.parse(ev.data);
        if (d.result !== undefined && d.id === 1) return;
        const val = d?.params?.result?.value;
        if (!val) return;
        const logs = (val.logs || []).join(' ');
        const sig = val.signature || '';
        if (!logs.includes(PUMP) || !logs.includes('Instruction: Buy')) return;
        void handleSig(w, sig);
      } catch {}
    };

    ws.onclose = () => {
      box.ws = null;
      if (box.stopped) return;
      if (box.reconnectTimer) return;
      const wait = box.backoffMs;
      console.log(`🔌 WS ${w.label} — reconnexion dans ${wait / 1000}s`);
      box.reconnectTimer = setTimeout(() => {
        box.reconnectTimer = null;
        box.backoffMs = Math.min(box.backoffMs * 1.5, 45000);
        connect();
      }, wait);
    };

    ws.onerror = () => {
      console.warn(`⚠ WS ${w.label} — erreur (souvent limite Helius / trop de connexions)`);
    };
  }

  connect();
  return box;
}

async function warmStartSigsOnly() {
  for (let i = 0; i < wallets.length; i++) {
    const w = wallets[i];
    try {
      const sigs = await rpcCall('getSignaturesForAddress', [w.addr, { limit: 12 }], i);
      for (const s of sigs || []) {
        if (s.signature) seenSigs.add(s.signature);
      }
    } catch (e) {
      console.warn('warmStart', w.label, e.message || e);
    }
    await sleep(400);
  }
  console.log(`Warm-start : ${seenSigs.size} sig(s) (anti-doublon)`);
}

async function pollLoop() {
  const interval = Number(process.env.POLL_INTERVAL_SEC || 12) * 1000;
  console.log(`📡 Poll secours : ${interval / 1000}s`);
  while (true) {
    for (let i = 0; i < wallets.length; i++) {
      const w = wallets[i];
      if (!w.addr) continue;
      try {
        const sigs = await rpcCall('getSignaturesForAddress', [w.addr, { limit: 5 }], i);
        for (const s of sigs || []) {
          if (!s.signature || seenSigs.has(s.signature)) continue;
          await handleSig(w, s.signature);
        }
      } catch (e) {
        console.warn('poll', w.label, e.message || e);
        await sleep(2000);
      }
      await sleep(500);
    }
    await sleep(interval);
  }
}

console.log(
  `Bundle Tracker worker — ${wallets.length} wallet(s) · ${HELIUS_KEYS.length} clé(s) Helius · ntfy:${topic} · WS ${wsCommitment}`,
);

if (isRailway) {
  console.log(
    railwayPollOnly
      ? 'Mode Railway : 1 clé → poll uniquement'
      : `Mode Railway : ${HELIUS_KEYS.length} clé(s) → WebSocket temps réel`,
  );
}

if (process.env.SKIP_WARM_START !== '0') {
  await warmStartSigsOnly();
} else {
  console.log('Warm-start désactivé');
}

if (!railwayPollOnly) {
  const stagger = Number(process.env.WS_STAGGER_MS || 1200);
  for (let i = 0; i < wallets.length; i++) {
    if (wallets[i].addr) startWalletWs(wallets[i], i);
    if (i < wallets.length - 1) await sleep(stagger);
  }
}

const wantPoll =
  railwayPollOnly ||
  process.env.ENABLE_POLL_FALLBACK === '1' ||
  (isRailway && singleKey);
if (wantPoll) {
  void pollLoop();
}

setInterval(() => {}, 60000);
