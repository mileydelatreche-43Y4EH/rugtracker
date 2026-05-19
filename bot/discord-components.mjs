import { ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder } from 'discord.js';

/** Couleurs thème (embeds). */
export const UI_COLORS = {
  home: 0x5865f2,
  trade: 0x22c55e,
  snipe: 0xf59e0b,
  alerts: 0x3b82f6,
  wallets: 0x8b5cf6,
  groups: 0x06b6d4,
  settings: 0x64748b,
};

export function uiBtn(id, label, style = ButtonStyle.Secondary) {
  return new ButtonBuilder().setCustomId(id).setLabel(String(label).slice(0, 80)).setStyle(style);
}

export function uiLink(label, url) {
  return new ButtonBuilder().setLabel(String(label).slice(0, 80)).setStyle(ButtonStyle.Link).setURL(url);
}

/** Une rangée de 1 ou 2 boutons (style bots pro). */
export function uiRow(...buttons) {
  const list = buttons.filter(Boolean).slice(0, 2);
  if (!list.length) return null;
  return new ActionRowBuilder().addComponents(...list);
}

/** Découpe une liste de boutons en rangées de 2. */
export function uiRowsPair(buttons, maxRows = 5) {
  const rows = [];
  for (let i = 0; i < buttons.length; i += 2) {
    const row = uiRow(buttons[i], buttons[i + 1]);
    if (row) rows.push(row);
    if (rows.length >= maxRows) break;
  }
  return rows;
}

export function uiClampRows(rows, max = 5) {
  return rows.filter(Boolean).slice(0, max);
}

export function uiEmbed(color, title, body, opts = {}) {
  const embed = new EmbedBuilder()
    .setColor(color)
    .setTitle(title)
    .setDescription(body)
    .setTimestamp();
  if (opts.footer) embed.setFooter({ text: opts.footer });
  if (opts.fields?.length) embed.addFields(opts.fields);
  if (opts.thumbnail) embed.setThumbnail(opts.thumbnail);
  return embed;
}

export function btnHome() {
  return uiBtn('bt:home', '🏠 Accueil', ButtonStyle.Primary);
}

export function btnBack(id, label = '⬅️ Retour') {
  return uiBtn(id, label, ButtonStyle.Secondary);
}

export function navBackHome(backId) {
  return uiRow(btnBack(backId), btnHome());
}
