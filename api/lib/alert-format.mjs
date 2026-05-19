/** MC compact type notif : 24k, 1.2M, — */
export function fmtMcShort(n) {
  const x = Number(n) || 0;
  if (x <= 0) return '—';
  if (x >= 1e6) {
    const m = x / 1e6;
    return (m >= 10 ? Math.round(m) : m.toFixed(1).replace(/\.0$/, '')) + 'M';
  }
  if (x >= 1e3) return Math.round(x / 1e3) + 'k';
  return String(Math.round(x));
}

/** Symbole style $pepecoin */
export function fmtTokenSym(meta, mint) {
  const raw = String(meta?.sym || mint || '')
    .trim()
    .replace(/^\$/, '')
    .toLowerCase();
  const sym = raw || String(mint).slice(0, 8).toLowerCase();
  return `$${sym}`;
}

/** Ligne wallet = nom du groupe (emoji collé au nom). */
export function fmtWalletGroup(w) {
  const name = String(w?.groupName || w?.label || w?.addr?.slice(0, 8) || '—').trim();
  const emoji = String(w?.groupEmoji || '').trim();
  if (emoji && w?.groupName) return `${emoji}${name}`;
  return name;
}

/** Bloc texte notif (3 lignes + lien optionnel). */
export function buildBuyAlertText({ w, meta, mint, axiomUrl, withLink = true }) {
  const m = String(mint || '').trim();
  const sym = fmtTokenSym(meta, m);
  const mc = fmtMcShort(meta?.mcUsd);

  const lines = [`🎯 ${sym}`, `Wallet ${fmtWalletGroup(w)}`, `MC - ${mc}`];

  if (withLink && axiomUrl) {
    lines.push('', String(axiomUrl).trim());
  }

  return {
    sym,
    mc,
    walletGroup: fmtWalletGroup(w),
    body: lines.join('\n'),
  };
}
