/**
 * Worker 24/7 — WebSocket Helius + push ntfy
 */
import { readFileSync, existsSync } from 'fs';
import { axiomTradeUrl } from '../api/lib/axiom.mjs';
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
/** 1 clé + 4 wallets = trop de WS/poll en parallèle → 429. */
const railwayPollOnly = isRailway && singleKey && process.env.RAILWAY_WS_MODE !== '1';

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
      await sleep(800);
      return rpc(rpcUrlForKey(pickKey(keyIndex + 1)), method, params);
    }
    throw e;
  }
}

async function notifyBuy(w, hit) {
  const label = w.label || w.addr.slice(0, 8);
  const click = await axiomTradeUrl(hit.mint);
  await postNtfy(topic, 'Nouveau rug', {
    title: ntfyHeaderAscii('Nouveau rug'),
    click,
    tags: 'warning',
  });
  console.log(`📱 ntfy → ${label} · Axiom ${hit.mint.slice(0, 10)}…`);
}

async function handleSig(w, sig) {
  if (!sig || seenSigs.has(sig)) return;
  seenSigs.add(sig);
  if (seenSigs.size > 8000) {
    const a = [...seenSigs];
    seenSigs.clear();
    a.slice(-4000).forEach(s => seenSigs.add(s));
  }
  try {
    const tx = await rpcCall('getTransaction', [
      sig,
      { encoding: 'jsonParsed', maxSupportedTransactionVersion: 0 },
    ]);
    const hit = extractPumpBuyFromTx(tx, w.addr);
    if (!hit) return;
    if (seenMints.has(hit.mint)) return;
    seenMints.add(hit.mint);
    await notifyBuy(w, hit);
  } catch (e) {
    console.warn('handleSig', w.label, e.message || e);
  }
}

function startWalletWs(w, walletIndex) {
  const key = pickKey(walletIndex);
  const wsUrl = wsUrlForKey(key);
  const box = { w, stopped: false, ws: null, reconnectTimer: null, backoffMs: 5000 };

  function connect() {
    if (box.stopped) return;
    if (box.ws && (box.ws.readyState === WebSocket.OPEN || box.ws.readyState === WebSocket.CONNECTING)) {
      return;
    }
    const ws = new WebSocket(wsUrl);
    box.ws = ws;

    ws.onopen = () => {
      box.backoffMs = 5000;
      ws.send(JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'logsSubscribe',
        params: [{ mentions: [w.addr] }, { commitment: 'confirmed' }],
      }));
      console.log(`✅ WS ${w.label} (clé #${(walletIndex % HELIUS_KEYS.length) + 1})`);
    };

    ws.onmessage = (ev) => {
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
        box.backoffMs = Math.min(box.backoffMs * 1.5, 60000);
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

/** Léger : seulement les signatures récentes, pas 40× getTransaction (évite 429). */
async function warmStartLight() {
  const cutoff = Math.floor(Date.now() / 1000) - 3600;
  for (let i = 0; i < wallets.length; i++) {
    const w = wallets[i];
    try {
      const sigs = await rpcCall('getSignaturesForAddress', [w.addr, { limit: isRailway ? 8 : 15 }], i);
      for (const s of sigs || []) {
        if (s.signature) seenSigs.add(s.signature);
        if (!isRailway && (s.blockTime || 0) >= cutoff) {
          const tx = await rpcCall('getTransaction', [
            s.signature,
            { encoding: 'jsonParsed', maxSupportedTransactionVersion: 0 },
          ], i);
          const hit = extractPumpBuyFromTx(tx, w.addr);
          if (hit) seenMints.add(hit.mint);
          await sleep(350);
        }
      }
    } catch (e) {
      console.warn('warmStart', w.label, e.message || e);
    }
    await sleep(isRailway ? 2000 : 1200);
  }
  console.log(`Warm-start : ${seenSigs.size} sig(s) · ${seenMints.size} mint(s) en mémoire`);
}

async function pollLoop() {
  const defaultSec = railwayPollOnly ? 20 : 12;
  const interval = Number(process.env.POLL_INTERVAL_SEC || defaultSec) * 1000;
  console.log(
    railwayPollOnly
      ? `📡 Mode poll seul (1 clé) — cycle ~${interval / 1000}s entre les 4 wallets`
      : `📡 Mode secours : poll toutes les ${interval / 1000}s`,
  );
  while (true) {
    for (let i = 0; i < wallets.length; i++) {
      const w = wallets[i];
      if (!w.addr) continue;
      try {
        const sigs = await rpcCall('getSignaturesForAddress', [w.addr, { limit: 6 }], i);
        for (const s of sigs || []) {
          if (!s.signature || seenSigs.has(s.signature)) continue;
          await handleSig(w, s.signature);
          await sleep(railwayPollOnly ? 600 : 300);
        }
      } catch (e) {
        console.warn('poll', w.label, e.message || e);
        await sleep(3000);
      }
      await sleep(railwayPollOnly ? 2500 : 800);
    }
    await sleep(interval);
  }
}

console.log(`Bundle Tracker worker — ${wallets.length} wallet(s) · ${HELIUS_KEYS.length} clé(s) Helius · ntfy:${topic}`);

if (isRailway) {
  console.log(
    railwayPollOnly
      ? 'Mode Railway : 1 clé → poll uniquement (ajoute HELIUS_API_KEYS pour activer les WS)'
      : `Mode Railway : ${HELIUS_KEYS.length} clé(s) → WebSocket + poll léger`,
  );
} else {
  console.log('Démarrage…');
}

if (process.env.SKIP_WARM_START !== '1' && !(isRailway && railwayPollOnly)) {
  await warmStartLight();
} else if (isRailway) {
  console.log('Warm-start ignoré (évite 429 au démarrage)');
}

if (!railwayPollOnly) {
  for (let i = 0; i < wallets.length; i++) {
    if (wallets[i].addr) startWalletWs(wallets[i], i);
    await sleep(2500);
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
