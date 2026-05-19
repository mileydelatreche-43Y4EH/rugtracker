/** URL RPC HTTP Helius (première clé disponible). */
export function heliusHttpRpcUrl(key) {
  const k = String(key || '').trim();
  if (!k) throw new Error('Clé Helius manquante');
  return `https://mainnet.helius-rpc.com/?api-key=${k}`;
}

export function parseHeliusKeysFromEnv() {
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

export function primaryHeliusRpcUrl() {
  const keys = parseHeliusKeysFromEnv();
  if (!keys.length) throw new Error('HELIUS_API_KEYS requis pour la surveillance');
  return heliusHttpRpcUrl(keys[0]);
}
