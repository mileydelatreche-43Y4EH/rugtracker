/** URL publique pour le bouton « Copier CA » (page /copy auto-copie). */
export function getCopyCaPublicBase() {
  const explicit = (process.env.COPY_CA_PUBLIC_URL || '').trim().replace(/\/$/, '');
  if (explicit) return explicit;
  const domain = (process.env.RAILWAY_PUBLIC_DOMAIN || '').trim();
  if (domain) return `https://${domain}`;
  return '';
}

export function copyCaLinkUrl(mint) {
  const base = getCopyCaPublicBase();
  const m = String(mint || '').trim();
  if (!base || !m) return '';
  return `${base}/copy?m=${encodeURIComponent(m)}`;
}
