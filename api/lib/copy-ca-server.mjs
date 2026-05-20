import { createServer } from 'http';

function copyPageHtml(mint) {
  const safe = JSON.stringify(String(mint || ''));
  return `<!DOCTYPE html>
<html lang="fr"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Copier CA</title></head>
<body style="margin:0;min-height:100vh;display:flex;align-items:center;justify-content:center;font-family:system-ui,sans-serif;background:#0f0f14;color:#e8e8f0">
<p id="s" style="font-size:18px;padding:24px;text-align:center">Copie en cours…</p>
<script>
const m=${safe};
(async()=>{
  const el=document.getElementById('s');
  if(!m){ el.textContent='CA manquant'; return; }
  try{
    await navigator.clipboard.writeText(m);
    el.textContent='✓ CA copié — retourne sur Discord';
  }catch(e){
    const t=document.createElement('textarea');
    t.value=m; t.style.cssText='position:fixed;left:-9999px';
    document.body.appendChild(t); t.select();
    try{ document.execCommand('copy'); el.textContent='✓ CA copié'; }catch(e2){ el.textContent=m; }
    t.remove();
  }
  setTimeout(()=>{ try{ window.close(); }catch(x){} }, 1200);
})();
</script></body></html>`;
}

let serverStarted = false;

/** Écoute PORT (Railway) — route GET /copy?m=… */
export function startCopyCaServer() {
  if (serverStarted) return;
  const port = Number(process.env.PORT || 0);
  if (!port) return;

  const server = createServer((req, res) => {
    try {
      const u = new URL(req.url || '/', `http://127.0.0.1:${port}`);
      if (u.pathname === '/health') {
        res.writeHead(200, { 'Content-Type': 'text/plain' });
        res.end('ok');
        return;
      }
      if (u.pathname !== '/copy') {
        res.writeHead(404);
        res.end();
        return;
      }
      const m = u.searchParams.get('m') || '';
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(copyPageHtml(m));
    } catch {
      res.writeHead(500);
      res.end();
    }
  });

  server.listen(port, '0.0.0.0', () => {
    serverStarted = true;
    console.log(`📋 Copier CA · http://0.0.0.0:${port}/copy?m=…`);
  });
}
