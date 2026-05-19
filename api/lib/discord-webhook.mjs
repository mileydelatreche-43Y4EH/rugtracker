import { buildBuyButtons, buildBuyEmbed, buildBuyLinks } from './discord-alert.mjs';
import { silentWebhookBody } from './discord-silent.mjs';

function webhookUrlWithWait(url) {
  const u = String(url || '').trim();
  if (!u) throw new Error('DISCORD_WEBHOOK_URL manquant');
  return u.includes('?') ? `${u}&wait=true` : `${u}?wait=true`;
}

export function buildBuyWebhookPayload({ w, hit, meta, sig, axiomUrl }) {
  const links = buildBuyLinks(hit.mint, sig, axiomUrl);
  const embed = buildBuyEmbed({ w, hit, meta, sig });
  const components = buildBuyButtons(links, hit.mint);
  return {
    embeds: [embed.toJSON()],
    components: components.map(r => r.toJSON()),
  };
}

export async function postDiscordWebhook(webhookUrl, body) {
  const r = await fetch(webhookUrlWithWait(webhookUrl), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(silentWebhookBody(body)),
  });
  if (!r.ok) {
    const t = await r.text().catch(() => '');
    throw new Error(`Webhook Discord HTTP ${r.status}${t ? `: ${t.slice(0, 160)}` : ''}`);
  }
  return r.json().catch(() => ({}));
}

export async function sendWebhookBuyAlert(webhookUrl, payload) {
  const body = buildBuyWebhookPayload(payload);
  return postDiscordWebhook(webhookUrl, body);
}

export async function sendWebhookPlain(webhookUrl, title, description) {
  return postDiscordWebhook(webhookUrl, {
    embeds: [
      {
        title,
        description,
        color: 0x5865f2,
        timestamp: new Date().toISOString(),
      },
    ],
  });
}
