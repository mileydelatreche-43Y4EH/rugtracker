import {
  toggleWalletAlerts,
  setAllWalletAlerts,
  getAllWalletsFlat,
} from '../api/lib/wallet-store.mjs';
import {
  ACID,
  buildAlertsLivePanel,
  parseAlertToggleId,
  PAGE_SIZE,
} from './discord-alerts-panel.mjs';
import { safePanelUpdate } from './discord-ui.mjs';

const pageState = new Map();

function panelKey(interaction) {
  return `${interaction.guildId || 'dm'}:${interaction.channelId}`;
}

function getPage(interaction) {
  return pageState.get(panelKey(interaction)) || 0;
}

function setPage(interaction, page) {
  pageState.set(panelKey(interaction), page);
}

export function isAlertsPanelId(id) {
  return (
    id === ACID.MENU ||
    id === ACID.ALL_ON ||
    id === ACID.ALL_OFF ||
    id === ACID.PREV ||
    id === ACID.NEXT ||
    id?.startsWith(ACID.TOGGLE_PREFIX)
  );
}

export async function handleAlertsPanelButton(interaction) {
  const id = interaction.customId;

  if (id === ACID.ALL_ON) {
    setAllWalletAlerts(true);
    await safePanelUpdate(interaction, buildAlertsLivePanel(getPage(interaction)));
    return true;
  }

  if (id === ACID.ALL_OFF) {
    setAllWalletAlerts(false);
    await safePanelUpdate(interaction, buildAlertsLivePanel(getPage(interaction)));
    return true;
  }

  if (id === ACID.PREV) {
    const p = Math.max(0, getPage(interaction) - 1);
    setPage(interaction, p);
    await safePanelUpdate(interaction, buildAlertsLivePanel(p));
    return true;
  }

  if (id === ACID.NEXT) {
    const maxPage = Math.max(0, Math.ceil(getAllWalletsFlat().length / PAGE_SIZE) - 1);
    const p = Math.min(getPage(interaction) + 1, maxPage);
    setPage(interaction, p);
    await safePanelUpdate(interaction, buildAlertsLivePanel(p));
    return true;
  }

  const addr = parseAlertToggleId(id);
  if (addr) {
    toggleWalletAlerts(addr);
    await safePanelUpdate(interaction, buildAlertsLivePanel(getPage(interaction)));
    return true;
  }

  if (id === ACID.MENU) {
    setPage(interaction, 0);
    await safePanelUpdate(interaction, buildAlertsLivePanel(0));
    return true;
  }

  return false;
}
