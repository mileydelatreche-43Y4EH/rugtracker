import { ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder } from 'discord.js';

export const UI_COLORS = {
  home: 0x5865f2,
  alerts: 0x3b82f6,
  wallets: 0x8b5cf6,
  groups: 0x06b6d4,
  settings: 0x64748b,
};

/** Emojis cohérents — surveillance & alertes uniquement. */
export const ICO = {
  home: '🏠',
  wallets: '👛',
  groups: '🗂️',
  alerts: '🔔',
  settings: '⚙️',
  status: '📡',
  list: '📋',
  add: '➕',
  remove: '🗑️',
  import: '📥',
  export: '📤',
  pause: '⏸️',
  resume: '▶️',
  create: '✨',
  back: '◀️',
  test: '🧪',
  resync: '🔃',
  on: '🟢',
  off: '⚫',
  allOn: '✅',
  allOff: '⛔',
  pageL: '⬅️',
  pageR: '➡️',
};

export function L(icon, text) {
  return `${icon} ${text}`.trim().slice(0, 80);
}

export function uiBtn(id, label, style = ButtonStyle.Secondary) {
  return new ButtonBuilder().setCustomId(id).setLabel(String(label).slice(0, 80)).setStyle(style);
}

export function uiRow(...buttons) {
  const list = buttons.filter(Boolean).slice(0, 2);
  if (!list.length) return null;
  return new ActionRowBuilder().addComponents(...list);
}

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
  const embed = new EmbedBuilder().setColor(color).setTitle(title).setDescription(body);
  if (opts.timestamp !== false) embed.setTimestamp();
  if (opts.footer) embed.setFooter({ text: opts.footer });
  if (opts.fields?.length) embed.addFields(opts.fields);
  if (opts.thumbnail) embed.setThumbnail(opts.thumbnail);
  return embed;
}

export function btnHome() {
  return uiBtn('bt:home', L(ICO.home, 'Accueil'), ButtonStyle.Primary);
}

export function btnBack(id, text = 'Retour') {
  return uiBtn(id, L(ICO.back, text), ButtonStyle.Secondary);
}

export function navBackHome(backId, backText = 'Retour') {
  return uiRow(btnBack(backId, backText), btnHome());
}
