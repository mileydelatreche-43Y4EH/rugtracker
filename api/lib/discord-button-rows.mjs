import { ActionRowBuilder } from 'discord.js';

/** Rangées de 2 boutons max (alertes achat). */
export function pairButtonRows(buttons, maxRows = 5) {
  const rows = [];
  for (let i = 0; i < buttons.length; i += 2) {
    const row = new ActionRowBuilder();
    row.addComponents(buttons[i]);
    if (buttons[i + 1]) row.addComponents(buttons[i + 1]);
    rows.push(row);
    if (rows.length >= maxRows) break;
  }
  return rows;
}
