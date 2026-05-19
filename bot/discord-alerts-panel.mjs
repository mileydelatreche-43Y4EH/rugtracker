import { ActionRowBuilder, ButtonStyle, EmbedBuilder } from 'discord.js';
import { getAllWalletsFlat, alertsLiveSummary } from '../api/lib/wallet-store.mjs';
import {
  UI_COLORS,
  uiBtn,
  uiRow,
  uiRowsPair,
  uiClampRows,
  btnHome,
  btnBack,
} from './discord-components.mjs';

/** 4 wallets = 2 rangées × 2 + 3 rangées nav = 5 max (Discord). */
export const PAGE_SIZE = 4;

export const ACID = {
  MENU: 'bt:alerts:live',
  ALL_ON: 'bt:alerts:allon',
  ALL_OFF: 'bt:alerts:alloff',
  PREV: 'bt:alerts:prev',
  NEXT: 'bt:alerts:next',
  BACK_SETTINGS: 'bt:settings',
  TOGGLE_PREFIX: 'bt:alerts:t:',
};

export function alertToggleId(addr) {
  return `${ACID.TOGGLE_PREFIX}${addr}`;
}

export function parseAlertToggleId(id) {
  if (!id?.startsWith(ACID.TOGGLE_PREFIX)) return null;
  return id.slice(ACID.TOGGLE_PREFIX.length);
}

export function buildAlertsLivePanel(page = 0) {
  const all = getAllWalletsFlat();
  const sum = alertsLiveSummary();
  const totalPages = Math.max(1, Math.ceil(all.length / PAGE_SIZE) || 1);
  const p = Math.min(Math.max(0, page), totalPages - 1);
  const slice = all.slice(p * PAGE_SIZE, p * PAGE_SIZE + PAGE_SIZE);

  const lines = slice.length
    ? slice.map(w => {
        const st = w.alertsOn ? '🟢 ON' : '⚫ OFF';
        const grp = w.groupActive ? '' : ' _(pause)_';
        return `${st} · **${w.label}** · ${w.groupEmoji} ${w.groupName}${grp}`;
      })
    : ['_Aucun wallet — menu 💼 Wallets pour en ajouter._'];

  const embed = new EmbedBuilder()
    .setColor(UI_COLORS.alerts)
    .setTitle('🔔 Alertes live')
    .setDescription(
      [
        `**${sum.on}** actif(s) sur **${all.length}** wallet(s) · page **${p + 1}/${totalPages}**`,
        '',
        '_Chaque bouton bascule ON/OFF pour ce wallet._',
        '',
        lines.join('\n'),
      ].join('\n'),
    )
    .setFooter({ text: 'Wallet ON + groupe actif = alerte Discord envoyée' })
    .setTimestamp();

  const toggleBtns = slice.map(w =>
    uiBtn(
      alertToggleId(w.addr),
      `${w.alertsOn ? '🟢' : '⚫'} ${w.label}`.slice(0, 80),
      w.alertsOn ? ButtonStyle.Success : ButtonStyle.Secondary,
    ),
  );

  const navRows = [];
  if (totalPages > 1) {
    navRows.push(
      uiRow(
        uiBtn(ACID.PREV, '⬅️ Page', ButtonStyle.Secondary),
        uiBtn(ACID.NEXT, '➡️ Page', ButtonStyle.Secondary),
      ),
    );
  }
  navRows.push(
    uiRow(
      uiBtn(ACID.ALL_ON, '✅ Tout ON', ButtonStyle.Success),
      uiBtn(ACID.ALL_OFF, '⛔ Tout OFF', ButtonStyle.Danger),
    ),
    uiRow(btnBack(ACID.BACK_SETTINGS, '⚙️ Paramètres'), btnHome()),
  );

  const components = uiClampRows([...uiRowsPair(toggleBtns, 2), ...navRows]);

  return { embeds: [embed], components };
}
