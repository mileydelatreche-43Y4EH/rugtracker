import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder,
} from 'discord.js';
import { fmtU, resolveTokenImageUrl } from './token-meta.mjs';
import { buildTradeButtonRows } from './discord-trade.mjs';
import { loadTradeSettings } from './trade-settings.mjs';
import { rememberAlertContext } from './alert-context.mjs';

export const COPY_CA_PREFIX = 'bt:ca:';
/** Ancien menu token (messages déjà envoyés). */
export const ALERT_MENU_PREFIX = 'bt:menu:';
/** Ouvre le menu principal du bot (panneau + éphémère). */
export const ALERT_BOT_HOME = 'bt:alert:home';

function venueLabel(venue) {
  if (venue === 'pumpswap') return 'PumpSwap';
  if (venue === 'curve') return 'Pump.fun';
  return venue || 'Pump';
}

export function buildBuyLinks(mint, sig, axiomUrl) {
  const m = String(mint || '').trim();
  const tx = String(sig || '').trim();
  return {
    axiom: axiomUrl || `https://axiom.trade/meme/${encodeURIComponent(m)}?chain=sol`,
    pump: `https://pump.fun/coin/${m}`,
    dex: `https://dexscreener.com/solana/${m}`,
    solscan: tx ? `https://solscan.io/tx/${tx}` : `https://solscan.io/account/${m}`,
    birdeye: `https://birdeye.so/token/${m}?chain=solana`,
  };
}

function linkBtn(label, url) {
  return new ButtonBuilder().setLabel(label).setStyle(ButtonStyle.Link).setURL(url);
}

export function buildBuyEmbed({ w, hit, meta, sig }) {
  const mint = String(hit.mint || '').trim();
  const sym = (meta.sym || mint.slice(0, 8)).toUpperCase();
  const tokenName = (meta.name || '').trim();
  const title = tokenName ? `🎯 ${sym} — ${tokenName}` : `🎯 ${sym}`;
  const groupLine = w.groupEmoji && w.groupName ? `${w.groupEmoji} ${w.groupName}` : '—';
  const embedColor =
    typeof w.groupColor === 'number' && w.groupColor >= 0 ? w.groupColor : 0x7c3aed;

  const embed = new EmbedBuilder()
    .setColor(embedColor)
    .setTitle(title)
    .setDescription(
      [
        `**Wallet** · ${w.label || w.addr?.slice(0, 8)}`,
        `**Groupe** · ${groupLine}`,
        `**Venue** · ${venueLabel(hit.venue)}`,
        `**MC** · ${fmtU(meta.mcUsd)}`,
        '',
        `**CA**`,
        `\`\`\`\n${mint}\n\`\`\``,
      ].join('\n'),
    )
    .setFooter({ text: sig ? `tx ${sig.slice(0, 16)}…` : 'Bundle Tracker' })
    .setTimestamp();

  const img = resolveTokenImageUrl(mint, meta);
  if (img) {
    embed.setImage(img).setThumbnail(img);
  }

  return embed;
}

/** Discord : max 5 lignes, 5 boutons par ligne. */
export function clampAlertComponents(rows) {
  return rows.slice(0, 5).map(row => {
    const next = new ActionRowBuilder();
    const comps = row.components?.slice(0, 5) || [];
    if (comps.length) next.addComponents(...comps);
    return next;
  }).filter(r => r.components.length > 0);
}

export function buildBuyButtons(links, mint) {
  const m = String(mint || '').trim();
  const row1 = new ActionRowBuilder().addComponents(
    linkBtn('⚡ Axiom', links.axiom),
    linkBtn('🟢 Pump', links.pump),
    linkBtn('📊 Dex', links.dex),
  );
  const row2 = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`${COPY_CA_PREFIX}${m}`)
      .setLabel('📋 Copier CA')
      .setStyle(ButtonStyle.Secondary),
    new ButtonBuilder()
      .setCustomId(ALERT_BOT_HOME)
      .setLabel('☰ Menu')
      .setStyle(ButtonStyle.Primary),
  );
  const rows = [row1, row2];
  const tradeRows = buildTradeButtonRows(m);
  if (tradeRows.length) rows.push(...tradeRows);
  return clampAlertComponents(rows);
}

export function buildAlertComponents(links, mint) {
  return buildBuyButtons(links, mint);
}

export function buildAlertMenuComponents(links, mint) {
  const m = String(mint || '').trim();
  return [
    new ActionRowBuilder().addComponents(
      linkBtn('🔍 Solscan', links.solscan),
      linkBtn('🦅 Birdeye', links.birdeye),
      linkBtn('📊 Dex', links.dex),
    ),
    new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId(`${COPY_CA_PREFIX}${m}`)
        .setLabel('📋 Copier CA')
        .setStyle(ButtonStyle.Secondary),
    ),
  ];
}

function buildAlertPayload(payload) {
  const { w, hit, meta, sig, axiomUrl } = payload;
  const links = buildBuyLinks(hit.mint, sig, axiomUrl);
  rememberAlertContext(hit.mint, { links, sig, sym: meta.sym, name: meta.name });
  const embed = buildBuyEmbed({ w, hit, meta, sig });
  const s = loadTradeSettings();
  if (s.tradingEnabled && s.showTradeButtonsOnAlerts) {
    embed.setFooter({
      text: sig
        ? `tx ${sig.slice(0, 12)}… · Trading ON — boutons ci-dessous`
        : 'Trading ON — boutons Buy/Sell ci-dessous',
    });
  } else if (meta.mcUsd === 0 && !meta.name) {
    embed.setFooter({ text: sig ? `tx ${sig.slice(0, 12)}…` : 'Mise à jour…' });
  }
  const components = buildBuyButtons(links, hit.mint);
  return { embeds: [embed], components };
}

export async function sendDiscordBuyAlert(channel, payload) {
  if (!channel?.send) throw new Error('Canal Discord invalide');
  const body = buildAlertPayload(payload);
  try {
    return await channel.send(body);
  } catch (e) {
    const msg = String(e.message || e);
    if (!msg.includes('COMPONENT') && !msg.includes('50035') && !msg.includes('button')) {
      throw e;
    }
    return channel.send({
      embeds: body.embeds,
      components: body.components.slice(0, 2),
    });
  }
}

/** Met à jour l’alerte (image, MC, nom) après fetch meta. */
export async function enrichDiscordBuyAlert(message, payload) {
  if (!message?.edit) return null;
  const body = buildAlertPayload(payload);
  try {
    return await message.edit(body);
  } catch (e) {
    const msg = String(e.message || e);
    if (msg.includes('COMPONENT') || msg.includes('50035')) {
      return message.edit({ embeds: body.embeds, components: body.components.slice(0, 2) });
    }
    throw e;
  }
}

export async function sendDiscordPlain(channel, title, description) {
  const embed = new EmbedBuilder()
    .setColor(0x5865f2)
    .setTitle(title)
    .setDescription(description)
    .setTimestamp();
  return channel.send({ embeds: [embed] });
}
