import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder,
} from 'discord.js';
import {
  getAllWalletsFlat,
  alertsLiveSummary,
} from '../api/lib/wallet-store.mjs';

const ALERTS_COLOR = 0x3b82f6;
/** Max 8 wallets = 2 rangées de boutons + 1 nav (limite Discord : 5 rangées). */
export const PAGE_SIZE = 8;

export const ACID = {
  MENU: 'bt:alerts:live',
  ALL_ON: 'bt:alerts:allon',
  ALL_OFF: 'bt:alerts:alloff',
  PREV: 'bt:alerts:prev',
  NEXT: 'bt:alerts:next',
  BACK_SETTINGS: 'bt:settings',
  TOGGLE_PREFIX: 'bt:alerts:t:',
};

function abtn(id, label, style = ButtonStyle.Secondary) {
  return new ButtonBuilder().setCustomId(id).setLabel(label).setStyle(style);
}

function arow(...buttons) {
  return new ActionRowBuilder().addComponents(...buttons.slice(0, 5));
}

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
        const st = w.alertsOn ? '🟢 ON' : '⚪ OFF';
        const grp = w.groupActive ? '' : ' _(groupe pause)_';
        return `${st} · **${w.label}** · ${w.groupEmoji} ${w.groupName}${grp}`;
      })
    : ['_Aucun wallet — ajoute-en dans Wallets._'];

  const embed = new EmbedBuilder()
    .setColor(ALERTS_COLOR)
    .setTitle('🔔 Alertes live')
    .setDescription(
      [
        `**${sum.on}** actif(s) · **${all.filter(w => w.alertsOn).length}** ON · **${all.length}** total`,
        `Page **${p + 1} / ${totalPages}**`,
        '',
        '_Clique un bouton pour passer ON ou OFF._',
        '',
        lines.join('\n'),
      ].join('\n'),
    )
    .setFooter({ text: 'Wallet ON + groupe actif = alertes Discord envoyées' });

  const components = [];

  for (let i = 0; i < slice.length; i += 5) {
    const chunk = slice.slice(i, i + 5);
    components.push(
      arow(
        ...chunk.map(w =>
          abtn(
            alertToggleId(w.addr),
            `${w.alertsOn ? '🟢' : '⚫'} ${w.label}`.slice(0, 80),
            w.alertsOn ? ButtonStyle.Success : ButtonStyle.Secondary,
          ),
        ),
      ),
    );
  }

  const nav = [];
  if (totalPages > 1) {
    nav.push(abtn(ACID.PREV, '⬅️', ButtonStyle.Secondary));
    nav.push(abtn(ACID.NEXT, '➡️', ButtonStyle.Secondary));
  }
  nav.push(abtn(ACID.ALL_ON, '✅ Tout ON', ButtonStyle.Success));
  nav.push(abtn(ACID.ALL_OFF, '⛔ Tout OFF', ButtonStyle.Danger));
  nav.push(abtn(ACID.BACK_SETTINGS, '⚙️ Paramètres'));
  components.push(arow(...nav));

  return { embeds: [embed], components: components.slice(0, 5) };
}
