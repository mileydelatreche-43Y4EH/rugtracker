import {
  upsertSnipe,
  removeSnipe,
  toggleSnipeAuto,
  toggleSnipeAutoSell,
  getSnipeByAddr,
} from '../api/lib/snipe-settings.mjs';
import { getActiveWallets } from '../api/lib/wallet-store.mjs';
import {
  SCID,
  renderSnipeScreen,
  snipeSolModal,
  snipeBuyPctModal,
  snipeSellPctModal,
  buildSnipeConfigPanel,
} from './discord-snipe-panel.mjs';
import { dismissEphemeral, showEphemeralError } from './discord-ui.mjs';

export function isSnipePanelId(id) {
  return (
    id === SCID.MENU ||
    id === SCID.ADD ||
    id === 'bt:trade:snipe' ||
    id?.startsWith('bt:snipe:') ||
    id?.startsWith('bt:sel:snipe')
  );
}

export function isSnipeModalId(id) {
  return id?.startsWith('bt:modal:snipe');
}

async function updateSnipeScreen(interaction, screen, watchAddr) {
  await interaction.deferUpdate();
  const payload = await renderSnipeScreen(screen, watchAddr);
  await interaction.editReply(payload);
}

export async function handleSnipePanelButton(interaction) {
  const id = interaction.customId;

  if (id === SCID.MENU || id === 'bt:trade:snipe') {
    await updateSnipeScreen(interaction, 'snipe');
    return true;
  }
  if (id === SCID.ADD) {
    await updateSnipeScreen(interaction, 'snipe_add');
    return true;
  }
  if (id === SCID.BACK_TRADE) {
    return false;
  }

  if (id.startsWith('bt:snipe:tog:')) {
    const addr = id.slice('bt:snipe:tog:'.length);
    const snipe = getSnipeByAddr(addr);
    await toggleSnipeAuto(addr, !snipe?.autoBuy?.enabled);
    await interaction.update(buildSnipeConfigPanel(addr));
    return true;
  }
  if (id.startsWith('bt:snipe:selltog:')) {
    const addr = id.slice('bt:snipe:selltog:'.length);
    const snipe = getSnipeByAddr(addr);
    await toggleSnipeAutoSell(addr, !snipe?.autoBuy?.autoSellEnabled);
    await interaction.update(buildSnipeConfigPanel(addr));
    return true;
  }
  if (id.startsWith('bt:snipe:sol:')) {
    const addr = id.slice('bt:snipe:sol:'.length);
    await interaction.showModal(snipeSolModal(addr));
    return true;
  }
  if (id.startsWith('bt:snipe:buypct:')) {
    const addr = id.slice('bt:snipe:buypct:'.length);
    await interaction.showModal(snipeBuyPctModal(addr));
    return true;
  }
  if (id.startsWith('bt:snipe:sellpct:')) {
    const addr = id.slice('bt:snipe:sellpct:'.length);
    await interaction.showModal(snipeSellPctModal(addr));
    return true;
  }

  return false;
}

export async function handleSnipePanelSelect(interaction) {
  const id = interaction.customId;
  const value = interaction.values[0];

  if (id === SCID.SEL_ADD) {
    const w = getActiveWallets().find(x => x.addr === value);
    upsertSnipe(value, {
      label: w?.label,
      autoBuy: { enabled: false },
    });
    await updateSnipeScreen(interaction, 'snipe_cfg', value);
    return true;
  }

  if (id === SCID.SEL_CFG) {
    await updateSnipeScreen(interaction, 'snipe_cfg', value);
    return true;
  }

  if (id === SCID.SEL_RM) {
    removeSnipe(value);
    await updateSnipeScreen(interaction, 'snipe');
    return true;
  }

  return false;
}

export async function handleSnipeModal(interaction) {
  const cid = interaction.customId;
  await interaction.deferReply({ ephemeral: true });

  try {
    if (cid.startsWith(SCID.MODAL_SOL)) {
      const addr = cid.slice(SCID.MODAL_SOL.length);
      const sol = parseFloat(interaction.fields.getTextInputValue('sol'));
      upsertSnipe(addr, { autoBuy: { solAmount: sol } });
      await dismissEphemeral(interaction);
      return true;
    }
    if (cid.startsWith(SCID.MODAL_BUY_PCT)) {
      const addr = cid.slice(SCID.MODAL_BUY_PCT.length);
      const pct = parseFloat(interaction.fields.getTextInputValue('pct'));
      if (!pct || pct <= 0 || pct > 1000) throw new Error('% achat entre 1 et 1000.');
      upsertSnipe(addr, { autoBuy: { buyCopyPct: pct } });
      await dismissEphemeral(interaction);
      return true;
    }
    if (cid.startsWith(SCID.MODAL_SELL_PCT)) {
      const addr = cid.slice(SCID.MODAL_SELL_PCT.length);
      const pct = parseFloat(interaction.fields.getTextInputValue('pct'));
      if (!pct || pct <= 0 || pct > 100) throw new Error('% vente entre 1 et 100.');
      upsertSnipe(addr, { autoBuy: { sellCopyPct: pct } });
      await dismissEphemeral(interaction);
      return true;
    }
  } catch (e) {
    await showEphemeralError(interaction, e.message || String(e));
    return true;
  }
  return false;
}
