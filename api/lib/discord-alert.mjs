import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder,
} from 'discord.js';
import { buildBuyAlertText, fmtTokenSym, fmtWalletGroup, fmtMcShort } from './alert-format.mjs';
import { pairButtonRows } from './discord-button-rows.mjs';
import { rememberAlertContext } from './alert-context.mjs';
import { copyCaLinkUrl } from './copy-ca-url.mjs';
import { silentMessage } from './discord-silent.mjs';

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

/** Texte toast Windows — format compact sans markdown. */
export function buildBuyAlertContent({ w, hit, meta, axiomUrl }) {
  const mint = String(hit.mint || '').trim();
  const link = axiomUrl || buildBuyLinks(mint, '', axiomUrl).axiom;
  return buildBuyAlertText({ w, meta, mint, axiomUrl: link, withLink: true }).body.slice(0, 2000);
}

export function buildBuyEmbed({ w, hit, meta, sig }) {
  const mint = String(hit.mint || '').trim();
  const sym = fmtTokenSym(meta, mint);
  const tokenName = String(meta?.name || '').trim();
  const embedColor =
    typeof w.groupColor === 'number' && w.groupColor >= 0 ? w.groupColor : 0x7c3aed;

  const title = tokenName ? `🎯 ${sym} · ${tokenName}` : `🎯 ${sym}`;

  const embed = new EmbedBuilder()
    .setColor(embedColor)
    .setTitle(title)
    .setDescription(
      [
        `Wallet ${fmtWalletGroup(w)}`,
        `MC - ${fmtMcShort(meta.mcUsd)}`,
        `Venue · ${venueLabel(hit.venue)}`,
        '',
        `\`${mint}\``,
      ].join('\n'),
    )
    .setFooter({ text: sig ? `tx ${sig.slice(0, 16)}…` : 'Bundle Tracker' })
    .setTimestamp();

  const img = String(meta?.imageUrl || '').trim();
  if (img.startsWith('http')) embed.setThumbnail(img);

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

function copyCaButton(mint) {
  const m = String(mint || '').trim();
  const url = copyCaLinkUrl(m);
  if (url) return linkBtn('📋 Copier CA', url);
  return new ButtonBuilder()
    .setCustomId(`${COPY_CA_PREFIX}${m}`)
    .setLabel('📋 Copier CA')
    .setStyle(ButtonStyle.Secondary);
}

export function buildBuyButtons(links, mint) {
  const m = String(mint || '').trim();
  const core = [
    linkBtn('⚡ Axiom', links.axiom),
    copyCaButton(m),
    new ButtonBuilder()
      .setCustomId(ALERT_BOT_HOME)
      .setLabel('🏠 Menu bot')
      .setStyle(ButtonStyle.Primary),
  ];
  return clampAlertComponents(pairButtonRows(core, 2));
}

export function buildAlertComponents(links, mint) {
  return buildBuyButtons(links, mint);
}

export function buildAlertMenuComponents(links, mint) {
  const m = String(mint || '').trim();
  return pairButtonRows([
    linkBtn('🔍 Solscan', links.solscan),
    linkBtn('🦅 Birdeye', links.birdeye),
    linkBtn('📈 Dex', links.dex),
    copyCaButton(m),
  ]);
}

function buildAlertPayload(payload) {
  const { w, hit, meta, sig, axiomUrl } = payload;
  const links = buildBuyLinks(hit.mint, sig, axiomUrl);
  rememberAlertContext(hit.mint, { links, sig, sym: meta.sym, name: meta.name });
  const embed = buildBuyEmbed({ w, hit, meta, sig });
  if (meta.mcUsd === 0 && !meta.name) {
    embed.setFooter({ text: sig ? `tx ${sig.slice(0, 12)}…` : 'Mise à jour…' });
  }
  const components = buildBuyButtons(links, hit.mint);
  return { embeds: [embed], components };
}

export async function sendDiscordBuyAlert(channel, payload) {
  if (!channel?.send) throw new Error('Canal Discord invalide');
  const body = buildAlertPayload(payload);
  try {
    return await channel.send(silentMessage(body));
  } catch (e) {
    const msg = String(e.message || e);
    if (!msg.includes('COMPONENT') && !msg.includes('50035') && !msg.includes('button')) {
      throw e;
    }
    return channel.send(
      silentMessage({
        embeds: body.embeds,
        components: body.components.slice(0, 2),
      }),
    );
  }
}

/** Met à jour l’alerte (image, MC, nom) après fetch meta. */
export async function enrichDiscordBuyAlert(message, payload) {
  if (!message?.edit) return null;
  const body = buildAlertPayload(payload);
  try {
    return await message.edit(silentMessage(body));
  } catch (e) {
    const msg = String(e.message || e);
    if (msg.includes('COMPONENT') || msg.includes('50035')) {
      return message.edit(
        silentMessage({
          embeds: body.embeds,
          components: body.components.slice(0, 2),
        }),
      );
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
  return channel.send(silentMessage({ embeds: [embed] }));
}
