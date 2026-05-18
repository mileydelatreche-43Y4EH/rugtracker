import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder,
} from 'discord.js';
import { fmtU } from './token-meta.mjs';

const RISK_COLOR = {
  DANGER: 0xed4245,
  HIGH: 0xfaa61a,
  MEDIUM: 0xfee75c,
  LOW: 0x57f287,
  SAFE: 0x5865f2,
  UNKNOWN: 0x95a5a6,
};

function riskColor(risk) {
  return RISK_COLOR[String(risk || '').toUpperCase()] ?? RISK_COLOR.UNKNOWN;
}

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

export function buildBuyEmbed({ w, hit, meta, sig }) {
  const sym = meta.sym || hit.mint.slice(0, 8).toUpperCase();
  const risk = meta.snap?.risk || 'UNKNOWN';
  const groupLine = w.groupEmoji && w.groupName ? `${w.groupEmoji} ${w.groupName}` : '—';
  const sol = hit.sol != null ? `${Number(hit.sol).toFixed(4)} SOL` : '—';

  return new EmbedBuilder()
    .setColor(riskColor(risk))
    .setTitle(`🎯 ${sym} — nouveau token`)
    .setDescription(
      [
        `**Wallet** · ${w.label || w.addr?.slice(0, 8)}`,
        `**Groupe** · ${groupLine}`,
        `**Venue** · ${venueLabel(hit.venue)}`,
      ].join('\n'),
    )
    .addFields(
      { name: 'Market cap', value: fmtU(meta.mcUsd), inline: true },
      { name: 'Risque', value: risk, inline: true },
      { name: 'Dépensé', value: sol, inline: true },
      {
        name: 'Contrat (CA)',
        value: `\`\`\`${hit.mint}\`\`\``,
        inline: false,
      },
    )
    .setFooter({ text: sig ? `tx ${sig.slice(0, 16)}…` : 'Bundle Tracker' })
    .setTimestamp();
}

export function buildBuyButtons(links) {
  const row1 = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setLabel('Axiom').setStyle(ButtonStyle.Link).setURL(links.axiom),
    new ButtonBuilder().setLabel('Pump.fun').setStyle(ButtonStyle.Link).setURL(links.pump),
    new ButtonBuilder().setLabel('DexScreener').setStyle(ButtonStyle.Link).setURL(links.dex),
  );
  const row2 = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setLabel('Solscan TX').setStyle(ButtonStyle.Link).setURL(links.solscan),
    new ButtonBuilder().setLabel('Birdeye').setStyle(ButtonStyle.Link).setURL(links.birdeye),
  );
  return [row1, row2];
}

export async function sendDiscordBuyAlert(channel, payload) {
  if (!channel?.send) throw new Error('Canal Discord invalide');
  const { w, hit, meta, sig, axiomUrl } = payload;
  const links = buildBuyLinks(hit.mint, sig, axiomUrl);
  const embed = buildBuyEmbed({ w, hit, meta, sig });
  const components = buildBuyButtons(links);
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
