/**
 * Point d’entrée Railway / serveur :
 * - DISCORD_BOT_TOKEN → bot complet (/wallet, /import…)
 * - sinon DISCORD_WEBHOOK_URL → mode webhook (plus simple)
 */
import { readFileSync, existsSync } from 'fs';

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

loadEnvFile();

const hasBot = !!(process.env.DISCORD_BOT_TOKEN || '').trim();
const hasHook = !!(process.env.DISCORD_WEBHOOK_URL || '').trim();

if (hasBot) {
  await import('../bot/discord-bot.mjs');
} else if (hasHook) {
  await import('./webhook-worker.mjs');
} else {
  console.error('Ajoute DISCORD_BOT_TOKEN (bot) ou DISCORD_WEBHOOK_URL (webhook) dans .env');
  process.exit(1);
}
