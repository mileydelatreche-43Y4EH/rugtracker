import {
  Connection,
  VersionedTransaction,
  LAMPORTS_PER_SOL,
  PublicKey,
} from '@solana/web3.js';

export const SOL_MINT = 'So11111111111111111111111111111111111111112';
const JUPITER_QUOTE = 'https://quote-api.jup.ag/v6/quote';
const JUPITER_SWAP = 'https://api.jup.ag/swap/v1/swap';

async function fetchJson(url, opts) {
  const res = await fetch(url, opts);
  const text = await res.text();
  let body;
  try {
    body = text ? JSON.parse(text) : {};
  } catch {
    body = { error: text };
  }
  if (!res.ok) {
    throw new Error(body.error || body.message || `Jupiter HTTP ${res.status}`);
  }
  return body;
}

export async function getQuote({
  inputMint,
  outputMint,
  amount,
  slippageBps,
}) {
  const params = new URLSearchParams({
    inputMint,
    outputMint,
    amount: String(amount),
    slippageBps: String(slippageBps),
    onlyDirectRoutes: 'false',
  });
  return fetchJson(`${JUPITER_QUOTE}?${params}`);
}

export async function buildSwapTransaction({
  quoteResponse,
  userPublicKey,
  priorityFeeLamports,
}) {
  return fetchJson(JUPITER_SWAP, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      quoteResponse,
      userPublicKey,
      dynamicComputeUnitLimit: true,
      prioritizationFeeLamports: priorityFeeLamports || 'auto',
    }),
  });
}

export async function sendSwapTransaction(connection, keypair, swapTransactionB64) {
  const tx = VersionedTransaction.deserialize(Buffer.from(swapTransactionB64, 'base64'));
  tx.sign([keypair]);
  const sig = await connection.sendTransaction(tx, {
    skipPreflight: false,
    maxRetries: 2,
  });
  const conf = await connection.confirmTransaction(sig, 'confirmed');
  if (conf.value?.err) throw new Error(`Transaction échouée: ${JSON.stringify(conf.value.err)}`);
  return sig;
}

export async function swapSolToToken({
  rpcUrl,
  keypair,
  outputMint,
  solAmount,
  slippageBps,
  priorityFeeLamports,
}) {
  const lamports = Math.floor(Number(solAmount) * LAMPORTS_PER_SOL);
  if (lamports < 10_000) throw new Error('Montant SOL trop faible');

  const quote = await getQuote({
    inputMint: SOL_MINT,
    outputMint,
    amount: lamports,
    slippageBps,
  });

  const swap = await buildSwapTransaction({
    quoteResponse: quote,
    userPublicKey: keypair.publicKey.toBase58(),
    priorityFeeLamports,
  });

  const connection = new Connection(rpcUrl, 'confirmed');
  const sig = await sendSwapTransaction(connection, keypair, swap.swapTransaction);
  return { signature: sig, quote };
}

export async function getTokenBalanceRaw(connection, owner, mint) {
  const accounts = await connection.getParsedTokenAccountsByOwner(new PublicKey(owner), {
    mint: new PublicKey(mint),
  });
  if (!accounts.value.length) return { amount: '0', decimals: 0 };
  const info = accounts.value[0].account.data.parsed.info;
  return {
    amount: info.tokenAmount.amount,
    decimals: info.tokenAmount.decimals,
    uiAmount: info.tokenAmount.uiAmount,
  };
}

export async function swapTokenToSol({
  rpcUrl,
  keypair,
  inputMint,
  sellPct,
  slippageBps,
  priorityFeeLamports,
}) {
  const connection = new Connection(rpcUrl, 'confirmed');
  const bal = await getTokenBalanceRaw(connection, keypair.publicKey.toBase58(), inputMint);
  const total = BigInt(bal.amount);
  if (total <= 0n) throw new Error('Aucun token à vendre sur ce wallet');

  const pct = Math.min(100, Math.max(1, Number(sellPct) || 100));
  const amount = (total * BigInt(pct)) / 100n;
  if (amount <= 0n) throw new Error('Montant vente nul');

  const quote = await getQuote({
    inputMint,
    outputMint: SOL_MINT,
    amount: amount.toString(),
    slippageBps,
  });

  const swap = await buildSwapTransaction({
    quoteResponse: quote,
    userPublicKey: keypair.publicKey.toBase58(),
    priorityFeeLamports,
  });

  const sig = await sendSwapTransaction(connection, keypair, swap.swapTransaction);
  return { signature: sig, soldPct: pct, quote };
}

export async function getSolBalance(connection, pubkey) {
  const lamports = await connection.getBalance(new PublicKey(pubkey));
  return lamports / LAMPORTS_PER_SOL;
}
