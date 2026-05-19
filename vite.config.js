import { defineConfig, loadEnv } from 'vite';
import { join, dirname } from 'path';
import { fileURLToPath, pathToFileURL } from 'url';

const root = dirname(fileURLToPath(import.meta.url));

function applyEnvFile() {
  const env = loadEnv('development', root, '');
  for (const [k, v] of Object.entries(env)) {
    if (v != null && v !== '' && !process.env[k]) process.env[k] = v;
  }
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on('data', c => chunks.push(c));
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

/** Dev local : /api/cloud-sync → handler Node (sinon Vite sert le .mjs en texte). */
function cloudSyncDevApi() {
  return {
    name: 'cloud-sync-dev-api',
    configureServer(server) {
      server.middlewares.use(async (req, res, next) => {
        const pathOnly = (req.url || '').split('?')[0];
        if (pathOnly !== '/api/cloud-sync') return next();

        try {
          applyEnvFile();
          const mod = await import(pathToFileURL(join(root, 'api/cloud-sync.mjs')).href);
          const url = new URL(req.url, 'http://127.0.0.1');
          let body;
          if (req.method === 'POST' || req.method === 'PUT' || req.method === 'PATCH') {
            body = await readBody(req);
          }
          const request = new Request(url.href, {
            method: req.method,
            headers: req.headers,
            body: body?.length ? body : undefined,
          });
          const response =
            req.method === 'POST' ? await mod.POST(request) : await mod.GET(request);
          const text = await response.text();
          res.statusCode = response.status;
          res.setHeader('Content-Type', 'application/json; charset=utf-8');
          res.end(text);
        } catch (e) {
          res.statusCode = 503;
          res.setHeader('Content-Type', 'application/json; charset=utf-8');
          res.end(
            JSON.stringify({
              ok: false,
              error: 'Cloud dev : ' + (e.message || String(e)),
              hint: 'Ajoute KV_REST_API_URL et KV_REST_API_TOKEN dans .env',
            }),
          );
        }
      });
    },
  };
}

export default defineConfig({
  plugins: [cloudSyncDevApi()],
  server: {
    port: 5173,
    open: true,
    host: true,
  },
});
