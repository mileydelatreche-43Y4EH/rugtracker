import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder,
} from 'discord.js';
import { fmtU } from './token-meta.mjs';

export const COPY_CA_PREFIX = 'bt:ca:';

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
  const sym = (meta.sym || hit.mint.slice(0, 8)).toUpperCase();
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
      ].join('\n'),
    )
    .setFooter({ text: sig ? `tx ${sig.slice(0, 16)}…` : 'Bundle Tracker' })
    .setTimestamp();

  const img = String(meta.imageUrl || '').trim();
  if (img.startsWith('http')) {
    embed.setThumbnail(img);
  }

  return embed;
}

export function buildBuyButtons(links, mint) {
  const m = String(mint || '').trim();
  const row1 = new ActionRowBuilder().addComponents(
    linkBtn('⚡ Axiom', links.axiom),
    linkBtn('🟢 Pump', links.pump),
    linkBtn('📊 Dex', links.dex),
  );
  const row2 = new ActionRowBuilder().addComponents(
    linkBtn('🔍 Solscan', links.solscan),
    linkBtn('🦅 Birdeye', links.birdeye),
    new ButtonBuilder()
      .setCustomId(`${COPY_CA_PREFIX}${m}`)
      .setLabel('Copier CA')
      .setStyle(ButtonStyle.Secondary)
      .setEmoji('📋'),
  );
  return [row1, row2];
}

export async function sendDiscordBuyAlert(channel, payload) {
  if (!channel?.send) throw new Error('Canal Discord invalide');
  const { w, hit, meta, sig, axiomUrl } = payload;
  const links = buildBuyLinks(hit.mint, sig, axiomUrl);
  const embed = buildBuyEmbed({ w, hit, meta, sig });
  const components = buildBuyButtons(links, hit.mint);
  return channel.send({ embeds: [embed], components });
}

export async function sendDiscordPlain(channel, title, description) {
  const embed = new EmbedBuilder()
    .setColor(0x5865f2)
    .setTitle(title)
    .setDescription(description)
    .setTimestamp();
  return channel.send({ embeds: [embed] });
}
