/**
 * Worker Helius WS + poll — wallets dynamiques (wallet-store).
 */
import { heliusRpcUrl, rpc, extractAnyBuyFromTx, PUMP, PUMP_SWAP } from '../api/lib/solana.mjs';
import { getActiveWallets, onStoreChange } from '../api/lib/wallet-store.mjs';

export function createBundleWorker({ heliusKeys, onBuy, getWallets = getActiveWallets }) {
  if (!heliusKeys?.length) throw new Error('Aucune clé Helius');

  let rpcRound = 0;
  const seenSigs = new Set();
  const seenMintKeys = new Set();
  const wsBoxes = [];
  let walletIndexByAddr = new Map();
  let wallets = [];

  const isRailway = !!(process.env.RAILWAY_ENVIRONMENT || process.env.RAILWAY_PROJECT_ID);
  const singleKey = heliusKeys.length === 1;
  const railwayPollOnly = isRailway && singleKey && process.env.RAILWAY_WS_MODE !== '1';
  const wsCommitment =
    process.env.WORKER_WS_COMMITMENT === 'confirmed' ? 'confirmed' : 'processed';
  const warmSigAgeSec = Number(process.env.WARM_SIG_AGE_SEC || 300);

  function pickKey(i = 0) {
    return heliusKeys[(i + rpcRound) % heliusKeys.length];
  }
  function rpcUrlForKey(key) {
    return heliusRpcUrl(key);
  }
  function wsUrlForKey(key) {
    return `wss://mainnet.helius-rpc.com/?api-key=${key}`;
  }

  function sleep(ms) {
    return new Promise(r => setTimeout(r, ms));
  }

  function mintDedupeKey(w, mint) {
    return `${w.addr}:${mint}`;
  }

  function rebuildWalletMaps() {
    wallets = getWallets().filter(w => w?.addr);
    walletIndexByAddr = new Map(wallets.map((w, i) => [w.addr, i]));
    console.log(`👛 ${wallets.length} wallet(s) actif(s) surveillé(s)`);
    wallets.forEach(w =>
      console.log(`   · ${w.label} (${w.groupName || '?'}) → ${String(w.addr).slice(0, 8)}…`),
    );
  }

  async function rpcCall(method, params, keyIndex = 0) {
    const key = pickKey(keyIndex);
    rpcRound++;
    try {
      return await rpc(rpcUrlForKey(key), method, params);
    } catch (e) {
      const msg = e.message || String(e);
      if (msg.includes('429') && heliusKeys.length > 1) {
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
        console.warn(`⏳ tx pas encore dispo ${w.label} ${sig.slice(0, 12)}…`);
        seenSigs.delete(sig);
        return;
      }
      const hit = extractAnyBuyFromTx(tx, w.addr);
      if (!hit) return;

      const dedupe = mintDedupeKey(w, hit.mint);
      if (seenMintKeys.has(dedupe)) return;
      seenMintKeys.add(dedupe);
      if (seenMintKeys.size > 4000) {
        const keep = [...seenMintKeys].slice(-2000);
        seenMintKeys.clear();
        keep.forEach(k => seenMintKeys.add(k));
      }

      console.log(`🛒 achat ${w.label} · ${hit.mint.slice(0, 8)}… · ${hit.venue || 'curve'}`);
      await onBuy(w, hit, { sig, rpcCall, walletIndex: wi });
    } catch (e) {
      console.warn('handleSig', w.label, e.message || e);
      if (!fromWarm) seenSigs.delete(sig);
    }
  }

  function stopAllWs() {
    for (const box of wsBoxes) {
      box.stopped = true;
      if (box.reconnectTimer) clearTimeout(box.reconnectTimer);
      try {
        box.ws?.close();
      } catch {}
    }
    wsBoxes.length = 0;
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
        console.log(`✅ WS ${w.label} (clé #${(walletIndex % heliusKeys.length) + 1})`);
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
        box.reconnectTimer = setTimeout(() => {
          box.reconnectTimer = null;
          box.backoffMs = Math.min(box.backoffMs * 1.5, 45000);
          connect();
        }, wait);
      };

      ws.onerror = () => {};
    }

    connect();
    wsBoxes.push(box);
  }

  async function startAllWs() {
    stopAllWs();
    if (railwayPollOnly) return;
    const stagger = Number(process.env.WS_STAGGER_MS || 1200);
    for (let i = 0; i < wallets.length; i++) {
      startWalletWs(wallets[i], i);
      if (i < wallets.length - 1) await sleep(stagger);
    }
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
  }

  let pollRunning = false;
  async function pollLoop() {
    if (pollRunning) return;
    pollRunning = true;
    const interval = Number(process.env.POLL_INTERVAL_SEC || (isRailway ? 8 : 12)) * 1000;
    console.log(`📡 Poll secours : ${interval / 1000}s`);
    while (pollRunning) {
      rebuildWalletMaps();
      for (let i = 0; i < wallets.length; i++) {
        const w = wallets[i];
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

  async function start() {
    rebuildWalletMaps();
    if (!wallets.length) {
      console.warn('⚠ Aucun wallet actif — ajoute-en via Discord /wallet add');
    }

    if (process.env.SKIP_WARM_START !== '0' && wallets.length) {
      await warmStartSigsOnly();
    }

    await startAllWs();

    const pollOff = process.env.ENABLE_POLL_FALLBACK === '0';
    const wantPoll = railwayPollOnly || !pollOff || (isRailway && singleKey) || true;
    if (wantPoll) void pollLoop();

    return {
      rpcCall,
      resync: async () => {
        rebuildWalletMaps();
        await startAllWs();
      },
    };
  }

  onStoreChange(() => {
    void (async () => {
      rebuildWalletMaps();
      await startAllWs();
    })();
  });

  return { start, rpcCall, rebuildWalletMaps };
}
