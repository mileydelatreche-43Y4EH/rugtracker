/**
 * Worker 24/7 — WebSocket Helius + push ntfy (format = bureau, latence min.)
 */
import { readFileSync, existsSync } from 'fs';
import http from 'http';
import { notifyBuyFast } from '../api/lib/notify-fast.mjs';
import { postNtfy, ntfyHeaderAscii } from '../api/lib/ntfy.mjs';
import { heliusRpcUrl, rpc, extractAnyBuyFromTx, PUMP, PUMP_SWAP } from '../api/lib/solana.mjs';

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
function parseWatchWallets(raw) {
  const s = String(raw || '').trim();
  if (!s) return [];
  try {
    const j = JSON.parse(s);
    return Array.isArray(j) ? j : [];
  } catch {
    try {
      const j = JSON.parse(s.replace(/'/g, '"'));
      return Array.isArray(j) ? j : [];
    } catch {}
  }
  return [];
}

const wallets = parseWatchWallets(process.env.WATCH_WALLETS).filter(w => w && w.addr);

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
const seenMintKeys = new Set();
const isRailway = !!(process.env.RAILWAY_ENVIRONMENT || process.env.RAILWAY_PROJECT_ID);
const singleKey = HELIUS_KEYS.length === 1;
const railwayPollOnly = isRailway && singleKey && process.env.RAILWAY_WS_MODE !== '1';
const wsCommitment =
  process.env.WORKER_WS_COMMITMENT === 'confirmed' ? 'confirmed' : 'processed';
const walletIndexByAddr = new Map(wallets.map((w, i) => [w.addr, i]));
const warmSigAgeSec = Number(process.env.WARM_SIG_AGE_SEC || 300);

function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}

function mintDedupeKey(w, mint) {
  return `${w.addr}:${mint}`;
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

async function fetchTxForSig(sig, wi) {
  const attempts = Number(process.env.TX_FETCH_RETRIES || 5);
  for (let a = 0; a < attempts; a++) {
    const tx = await rpcCall(
      'getTransaction',
      [sig, { encoding: 'jsonParsed', maxSupportedTransactionVersion: 0 }],
      wi,
    );
    if (tx) return tx;
    if (a < attempts - 1) await sleep(280 * (a + 1));
  }
  return null;
}

function logsLookLikeBuy(logs) {
  const s = String(logs || '');
  if (!s.includes('Instruction: Buy')) return false;
  return s.includes(PUMP) || s.includes(PUMP_SWAP);
}

async function handleSig(w, sig, { fromWarm = false } = {}) {
  if (!sig) return;
  if (seenSigs.has(sig)) return;
  seenSigs.add(sig);
  if (seenSigs.size > 8000) {
    const a = [...seenSigs];
    seenSigs.clear();
    a.slice(-4000).forEach(s => seenSigs.add(s));
  }

  const wi = walletIndexByAddr.get(w.addr) ?? 0;
  try {
    const tx = await fetchTxForSig(sig, wi);
    if (!tx) {
      console.warn(`⏳ tx pas encore dispo ${w.label} ${sig.slice(0, 12)}… — retry poll`);
      seenSigs.delete(sig);
      return;
    }
    const hit = extractAnyBuyFromTx(tx, w.addr);
    if (!hit) return;

    const dedupe = mintDedupeKey(w, hit.mint);
    if (seenMintKeys.has(dedupe)) {
      console.log(`↩ déjà notifié ${w.label} · ${hit.mint.slice(0, 8)}…`);
      return;
    }
    seenMintKeys.add(dedupe);
    if (seenMintKeys.size > 4000) {
      const keep = [...seenMintKeys].slice(-2000);
      seenMintKeys.clear();
      keep.forEach(k => seenMintKeys.add(k));
    }

    console.log(
      `🛒 achat ${w.label} · ${hit.mint.slice(0, 8)}… · ${hit.venue || 'curve'}${fromWarm ? ' (warm)' : ''}`,
    );
    await notifyBuyFast(topic, w, hit, rpcCall, wi);
  } catch (e) {
    console.warn('handleSig', w.label, e.message || e);
    if (!fromWarm) seenSigs.delete(sig);
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
        if (!logsLookLikeBuy(logs)) return;
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
  const now = Math.floor(Date.now() / 1000);
  for (let i = 0; i < wallets.length; i++) {
    const w = wallets[i];
    try {
      const sigs = await rpcCall('getSignaturesForAddress', [w.addr, { limit: 15 }], i);
      for (const s of sigs || []) {
        if (!s.signature) continue;
        const age = s.blockTime ? now - s.blockTime : 0;
        if (age > warmSigAgeSec) {
          seenSigs.add(s.signature);
          continue;
        }
        await handleSig(w, s.signature, { fromWarm: true });
        await sleep(120);
      }
    } catch (e) {
      console.warn('warmStart', w.label, e.message || e);
    }
    await sleep(400);
  }
  console.log(
    `Warm-start : ${seenSigs.size} sig(s) anciennes ignorées · fenêtre récente ${warmSigAgeSec}s traitée`,
  );
}

async function pollLoop() {
  const interval = Number(process.env.POLL_INTERVAL_SEC || (isRailway ? 8 : 12)) * 1000;
  console.log(`📡 Poll secours : ${interval / 1000}s`);
  while (true) {
    for (let i = 0; i < wallets.length; i++) {
      const w = wallets[i];
      if (!w.addr) continue;
      try {
        const sigs = await rpcCall('getSignaturesForAddress', [w.addr, { limit: 8 }], i);
        for (const s of sigs || []) {
          if (!s.signature || seenSigs.has(s.signature)) continue;
          await handleSig(w, s.signature);
        }
      } catch (e) {
        console.warn('poll', w.label, e.message || e);
        await sleep(2000);
      }
      await sleep(400);
    }
    await sleep(interval);
  }
}

function startHealthServer() {
  const port = Number(process.env.PORT || 0);
  if (!port) return;
  http
    .createServer((req, res) => {
      const body = JSON.stringify({
        ok: true,
        role: 'notify-worker',
        wallets: wallets.length,
        heliusKeys: HELIUS_KEYS.length,
        topicLen: topic.length,
        uptimeSec: Math.floor(process.uptime()),
      });
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(body);
    })
    .listen(port, () => console.log(`🏥 Health :0:${port}/`));
}

async function startupNtfyPing() {
  if (process.env.SKIP_STARTUP_NTFY === '1') return;
  const labels = wallets.map(w => w.label || w.addr.slice(0, 6)).join(', ');
  await postNtfy(
    topic,
    `Worker 24/7 actif — ${wallets.length} wallet(s) : ${labels}`,
    {
      title: ntfyHeaderAscii('Bundle Tracker 24/7 OK'),
      priority: 'default',
      tags: 'white_check_mark',
    },
  );
  console.log('✅ Ping ntfy démarrage envoyé (vérifie PC + téléphone)');
}

console.log(
  `Bundle Tracker worker — ${wallets.length} wallet(s) · ${HELIUS_KEYS.length} clé(s) Helius · ntfy:${topic} · WS ${wsCommitment}`,
);
wallets.forEach(w => console.log(`   · ${w.label || '?'} → ${String(w.addr).slice(0, 8)}…`));

startHealthServer();

try {
  await startupNtfyPing();
} catch (e) {
  console.error('❌ Impossible d’envoyer sur ntfy au démarrage :', e.message || e);
  console.error('   Vérifie NTFY_TOPIC et que ntfy.sh est joignable.');
  process.exit(1);
}

if (isRailway) {
  console.log(
    railwayPollOnly
      ? 'Mode Railway : 1 clé → poll uniquement'
      : `Mode Railway : ${HELIUS_KEYS.length} clé(s) → WebSocket + poll secours`,
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

const pollOff = process.env.ENABLE_POLL_FALLBACK === '0';
const wantPoll = railwayPollOnly || !pollOff || (isRailway && singleKey);
if (wantPoll) {
  void pollLoop();
} else {
  console.log('Poll secours désactivé (ENABLE_POLL_FALLBACK=0)');
}

setInterval(() => {}, 60000);
