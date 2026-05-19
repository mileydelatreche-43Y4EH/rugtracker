/**
 * Worker Helius WS + poll — wallets dynamiques (wallet-store).
 */
import {
  heliusRpcUrl,
  rpc,
  extractAnyBuyFromTx,
  extractQuickBuyFromLogs,
  normalizeHeliusWsTransaction,
  PUMP,
  PUMP_SWAP,
} from '../api/lib/solana.mjs';
import { getActiveWallets, onStoreChange } from '../api/lib/wallet-store.mjs';

export function createBundleWorker({ heliusKeys, onBuy, getWallets = getActiveWallets }) {
  if (!heliusKeys?.length) throw new Error('Aucune clé Helius');

  let rpcRound = 0;
  const seenSigs = new Set();
  const seenMintAt = new Map();
  const mintDedupeTtl = Number(process.env.WALLET_MINT_DEDUPE_MS || 45_000);
  const wsBoxes = [];
  let walletIndexByAddr = new Map();
  let wallets = [];

  const isRailway = !!(process.env.RAILWAY_ENVIRONMENT || process.env.RAILWAY_PROJECT_ID);
  const singleKey = heliusKeys.length === 1;
  /** Poll seul = très lent (8 s). Par défaut WS actif même sur Railway. */
  const railwayPollOnly =
    process.env.RAILWAY_POLL_ONLY === '1' ||
    (isRailway && singleKey && process.env.RAILWAY_WS_MODE === '0');
  const useTxSubscribe = process.env.HELIUS_TX_SUBSCRIBE !== '0';
  const wsCommitment =
    process.env.WORKER_WS_COMMITMENT === 'confirmed' ? 'confirmed' : 'processed';
  const warmSigAgeSec = Number(process.env.WARM_SIG_AGE_SEC || 300);
  const txFetchDelayMs = Number(process.env.TX_FETCH_DELAY_MS || 50);

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

  function sigKey(w, sig) {
    return `${w.addr}:${sig}`;
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
    const attempts = Number(process.env.TX_FETCH_RETRIES || 4);
    for (let a = 0; a < attempts; a++) {
      const tx = await rpcCall(
        'getTransaction',
        [sig, { encoding: 'jsonParsed', maxSupportedTransactionVersion: 0 }],
        wi,
      );
      if (tx) return tx;
      if (a < attempts - 1) await sleep(txFetchDelayMs * (a + 1));
    }
    return null;
  }

  async function emitBuy(w, hit, sig, wi, detectedAt) {
    const dedupe = mintDedupeKey(w, hit.mint);
    const now = Date.now();
    const last = seenMintAt.get(dedupe);
    if (last && now - last < mintDedupeTtl) return;
    seenMintAt.set(dedupe, now);
    if (seenMintAt.size > 4000) {
      const cutoff = now - mintDedupeTtl;
      for (const [k, t] of seenMintAt) {
        if (t < cutoff) seenMintAt.delete(k);
      }
    }
    const ms = detectedAt ? Date.now() - detectedAt : 0;
    console.log(
      `🛒 achat ${w.label} · ${hit.mint.slice(0, 8)}… · ${hit.venue || 'curve'}` +
        (ms > 0 ? ` · ${ms}ms` : ''),
    );
    void onBuy(w, hit, { sig, rpcCall, walletIndex: wi, detectedAt });
  }

  async function handleTxDirect(w, sig, tx, detectedAt) {
    const sk = sigKey(w, sig);
    if (!sig || seenSigs.has(sk)) return;
    seenSigs.add(sk);
    const wi = walletIndexByAddr.get(w.addr) ?? 0;
    try {
      const buyHit = extractAnyBuyFromTx(tx, w.addr);
      if (buyHit) await emitBuy(w, buyHit, sig, wi, detectedAt);
    } catch (e) {
      console.warn('handleTxDirect', w.label, e.message || e);
      seenSigs.delete(sk);
    }
  }

  function logsLookLikeTrade(logs) {
    const s = String(logs || '');
    const pump = s.includes(PUMP) || s.includes(PUMP_SWAP);
    if (!pump) return false;
    return s.includes('Instruction: Buy');
  }

  async function handleSig(w, sig, { fromWarm = false, logs, detectedAt } = {}) {
    if (!sig) return;
    const sk = sigKey(w, sig);
    if (seenSigs.has(sk)) return;

    const wi = walletIndexByAddr.get(w.addr) ?? 0;
    const tDetect = detectedAt || Date.now();

    if (!fromWarm && logs) {
      const quick = extractQuickBuyFromLogs(logs);
      if (quick) {
        seenSigs.add(sk);
        await emitBuy(w, quick, sig, wi, tDetect);
        return;
      }
    }

    seenSigs.add(sk);
    if (seenSigs.size > 8000) {
      const a = [...seenSigs];
      seenSigs.clear();
      a.slice(-4000).forEach(s => seenSigs.add(s));
    }

    try {
      const tx = await fetchTxForSig(sig, wi);
      if (!tx) {
        console.warn(`⏳ tx pas encore dispo ${w.label} ${sig.slice(0, 12)}…`);
        if (!fromWarm) seenSigs.delete(sk);
        return;
      }
      const buyHit = extractAnyBuyFromTx(tx, w.addr);
      if (buyHit) await emitBuy(w, buyHit, sig, wi, tDetect);
    } catch (e) {
      console.warn('handleSig', w.label, e.message || e);
      if (!fromWarm) seenSigs.delete(sk);
    }
  }

  function stopAllWs() {
    for (const box of wsBoxes) {
      box.stopped = true;
      if (box.reconnectTimer) clearTimeout(box.reconnectTimer);
      if (box.pingTimer) clearInterval(box.pingTimer);
      try {
        box.ws?.close();
      } catch {}
    }
    wsBoxes.length = 0;
  }

  function walletsForKeyIndex(keyIndex) {
    return wallets.filter((_, i) => i % heliusKeys.length === keyIndex);
  }

  async function handleBatchedTx(result, keyWallets, detectedAt) {
    const sig = result.signature;
    if (!sig) return;
    let tx = normalizeHeliusWsTransaction(result);
    if (!tx) {
      const wi = walletIndexByAddr.get(keyWallets[0]?.addr) ?? 0;
      const fetched = await fetchTxForSig(sig, wi);
      if (!fetched) return;
      tx = fetched;
    }
    for (const w of keyWallets) {
      void handleTxDirect(w, sig, tx, detectedAt);
    }
  }

  function startKeyWs(keyIndex, keyWallets) {
    if (!keyWallets.length) return;
    const key = heliusKeys[keyIndex];
    const wsUrl = wsUrlForKey(key);
    const addrs = keyWallets.map(w => w.addr);
    const box = {
      keyIndex,
      wallets: keyWallets,
      stopped: false,
      ws: null,
      reconnectTimer: null,
      pingTimer: null,
      backoffMs: 3000,
      mode: useTxSubscribe ? 'tx' : 'logs',
      logSubByRpcId: new Map(),
    };

    function subscribe(ws) {
      if (box.mode === 'tx') {
        ws.send(
          JSON.stringify({
            jsonrpc: '2.0',
            id: 1,
            method: 'transactionSubscribe',
            params: [
              { accountInclude: addrs, failed: false },
              {
                commitment: wsCommitment,
                encoding: 'jsonParsed',
                transactionDetails: 'full',
                showRewards: false,
                maxSupportedTransactionVersion: 0,
              },
            ],
          }),
        );
        return;
      }
      keyWallets.forEach((w, j) => {
        ws.send(
          JSON.stringify({
            jsonrpc: '2.0',
            id: j + 1,
            method: 'logsSubscribe',
            params: [{ mentions: [w.addr] }, { commitment: wsCommitment }],
          }),
        );
      });
    }

    function connect() {
      if (box.stopped) return;
      if (box.ws && (box.ws.readyState === WebSocket.OPEN || box.ws.readyState === WebSocket.CONNECTING)) {
        return;
      }
      const ws = new WebSocket(wsUrl);
      box.ws = ws;

      ws.onopen = () => {
        box.backoffMs = 3000;
        box.logSubByRpcId.clear();
        subscribe(ws);
        if (box.pingTimer) clearInterval(box.pingTimer);
        box.pingTimer = setInterval(() => {
          if (ws.readyState === WebSocket.OPEN) ws.ping();
        }, 25000);
        const mode = box.mode === 'tx' ? 'txSubscribe' : 'logsSubscribe';
        console.log(`✅ WS clé #${keyIndex + 1} · ${mode} · ${keyWallets.length} wallet(s)`);
      };

      ws.onmessage = ev => {
        try {
          const d = JSON.parse(ev.data);
          if (d.error) {
            const errMsg = d.error.message || JSON.stringify(d.error);
            console.warn(`WS clé #${keyIndex + 1} erreur:`, errMsg);
            if (box.mode === 'tx' && d.id === 1) {
              console.warn('→ repli logsSubscribe (transactionSubscribe indisponible ?)');
              box.mode = 'logs';
              try {
                ws.close();
              } catch {}
            }
            return;
          }

          if (d.id != null && d.result !== undefined) {
            if (box.mode === 'logs' && d.id >= 1 && d.id <= keyWallets.length) {
              box.logSubByRpcId.set(d.result, keyWallets[d.id - 1]);
            }
            return;
          }

          const result = d?.params?.result;
          if (!result) return;
          const detectedAt = Date.now();

          if (result.transaction) {
            void handleBatchedTx(result, keyWallets, detectedAt);
            return;
          }

          const subId = d?.params?.subscription;
          const w = box.logSubByRpcId.get(subId) || keyWallets[0];
          const val = result.value || result;
          const logsArr = val.logs || [];
          const logs = logsArr.join(' ');
          const sig = val.signature || '';
          if (!logsLookLikeTrade(logs)) return;
          void handleSig(w, sig, { logs: logsArr, detectedAt });
        } catch (e) {
          console.warn('WS message', e.message || e);
        }
      };

      ws.onclose = () => {
        box.ws = null;
        if (box.pingTimer) {
          clearInterval(box.pingTimer);
          box.pingTimer = null;
        }
        if (box.stopped) return;
        if (box.reconnectTimer) return;
        const wait = box.backoffMs;
        box.reconnectTimer = setTimeout(() => {
          box.reconnectTimer = null;
          box.backoffMs = Math.min(box.backoffMs * 1.5, 45000);
          connect();
        }, wait);
      };

      ws.onerror = () => {
        console.warn(`WS clé #${keyIndex + 1} erreur réseau`);
      };
    }

    connect();
    wsBoxes.push(box);
  }

  async function startAllWs() {
    stopAllWs();
    if (railwayPollOnly) return;
    for (let ki = 0; ki < heliusKeys.length; ki++) {
      const batch = walletsForKeyIndex(ki);
      startKeyWs(ki, batch);
      if (ki < heliusKeys.length - 1) await sleep(Number(process.env.WS_STAGGER_MS || 400));
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
            seenSigs.add(sigKey(w, s.signature));
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
    const interval = Number(process.env.POLL_INTERVAL_SEC || 4) * 1000;
    console.log(`📡 Poll secours : ${interval / 1000}s`);
    while (pollRunning) {
      rebuildWalletMaps();
      for (let i = 0; i < wallets.length; i++) {
        const w = wallets[i];
        try {
          const sigs = await rpcCall('getSignaturesForAddress', [w.addr, { limit: 8 }], i);
          for (const s of sigs || []) {
            if (!s.signature || seenSigs.has(sigKey(w, s.signature))) continue;
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
    const wantPoll =
      railwayPollOnly ||
      process.env.ENABLE_POLL_FALLBACK === '1' ||
      (isRailway && !pollOff && wallets.length > 0);
    if (wantPoll) {
      const sec = Number(process.env.POLL_INTERVAL_SEC || 5);
      console.log(`📡 Poll secours actif (${sec}s) — alertes WS prioritaires`);
      void pollLoop();
    }

    return {
      rpcCall,
      resync: async () => {
        rebuildWalletMaps();
        await startAllWs();
      },
    };
  }

  let resyncDebounce = null;
  onStoreChange(() => {
    if (resyncDebounce) clearTimeout(resyncDebounce);
    resyncDebounce = setTimeout(() => {
      void (async () => {
        try {
          rebuildWalletMaps();
          await startAllWs();
          console.log('🔄 Wallets resynchronisés');
        } catch (e) {
          console.warn('resync wallets', e.message || e);
        }
      })();
    }, 600);
  });

  return { start, rpcCall, rebuildWalletMaps };
}
