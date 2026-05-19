import { loadTradeSettings, patchTradeSettings } from '../api/lib/trade-settings.mjs';
import {
  addTradeWallet,
  removeTradeWallet,
  listTradeWalletsPublic,
} from '../api/lib/trade-wallets.mjs';
import { parseTradeButtonId } from '../api/lib/discord-trade.mjs';
import { executeBuyTrade, executeSellTrade } from '../api/lib/trade-executor.mjs';
import { solToLamports, formatSolLabel } from '../api/lib/trade-format.mjs';
import { clearBalanceCache } from '../api/lib/wallet-balances.mjs';
import {
  TCID,
  renderTradeScreen,
  cycleMultiWalletMode,
  cyclePriorityPreset,
  parsePresetList,
  tradeBuyPresetsModal,
  tradeSellPresetsModal,
  tradeSlipModal,
  tradePrioModal,
  tradeWalletAddModal,
  tradeReserveModal,
  tradeCustomBuyModal,
  tradeCustomSellModal,
} from './discord-trade-panel.mjs';
import { renderSnipeScreen } from './discord-snipe-panel.mjs';
import {
  dismissEphemeral,
  showEphemeralError,
  scheduleEphemeralDismiss,
} from './discord-ui.mjs';

const tradeInflight = new Set();

async function updateTradeScreen(interaction, screen) {
  await interaction.deferUpdate();
  const payload = await renderTradeScreen(screen);
  await interaction.editReply(payload);
}

export async function handleTradePanelButton(interaction) {
  const id = interaction.customId;

  if (id === TCID.SNIPE) {
    await interaction.deferUpdate();
    await interaction.editReply(await renderSnipeScreen('snipe'));
    return true;
  }

  if (id === TCID.ADVANCED) {
    await updateTradeScreen(interaction, 'trade_adv');
    return true;
  }

  if (id === TCID.TOGGLE) {
    const s = loadTradeSettings();
    patchTradeSettings({ tradingEnabled: !s.tradingEnabled });
    await updateTradeScreen(interaction, 'trade');
    return true;
  }

  if (id === TCID.BTNS) {
    const s = loadTradeSettings();
    patchTradeSettings({ showTradeButtonsOnAlerts: !s.showTradeButtonsOnAlerts });
    await updateTradeScreen(interaction, 'trade_adv');
    return true;
  }

  if (id === TCID.BUY_PRESETS) {
    await interaction.showModal(tradeBuyPresetsModal());
    return true;
  }
  if (id === TCID.SELL_PRESETS) {
    await interaction.showModal(tradeSellPresetsModal());
    return true;
  }
  if (id === TCID.SLIP) {
    await interaction.showModal(tradeSlipModal());
    return true;
  }
  if (id === TCID.PRIO) {
    cyclePriorityPreset();
    await updateTradeScreen(interaction, 'trade');
    return true;
  }
  if (id === TCID.PRIO_CUSTOM) {
    await interaction.showModal(tradePrioModal());
    return true;
  }
  if (id === TCID.REFRESH_BAL) {
    clearBalanceCache();
    await updateTradeScreen(interaction, 'trade');
    return true;
  }
  if (id === TCID.WL_ADD) {
    await interaction.showModal(tradeWalletAddModal());
    return true;
  }
  if (id === TCID.RESERVE) {
    await interaction.showModal(tradeReserveModal());
    return true;
  }

  if (id === TCID.MULTI) {
    cycleMultiWalletMode();
    await updateTradeScreen(interaction, 'trade_adv');
    return true;
  }

  if (id === TCID.MENU) {
    await updateTradeScreen(interaction, 'trade');
    return true;
  }
  if (id === TCID.WALLETS) {
    await updateTradeScreen(interaction, 'trade_wallets');
    return true;
  }
  if (id === TCID.WL_RM) {
    await interaction.update(await renderTradeScreen('trade_wl_rm'));
    return true;
  }
  return false;
}

export async function handleTradePanelSelect(interaction) {
  const id = interaction.customId;
  const value = interaction.values[0];

  if (id === TCID.SEL_WL_TOGGLE) {
    const [action, walletId] = value.split(':');
    const s = loadTradeSettings();
    const enabled = action === 'on';
    const all = listTradeWalletsPublic().map(w => w.id);
    let ids = new Set(s.enabledWalletIds?.length ? s.enabledWalletIds : all);
    if (enabled) ids.add(walletId);
    else ids.delete(walletId);
    if (ids.size >= all.length) ids = new Set();
    patchTradeSettings({ enabledWalletIds: [...ids] });
    await updateTradeScreen(interaction, 'trade_wallets');
    return true;
  }

  if (id === TCID.SEL_WL_RM) {
    removeTradeWallet(value);
    clearBalanceCache();
    await interaction.update(await renderTradeScreen('trade_wl_rm'));
    return true;
  }

  return false;
}

export async function handleTradeAlertButton(interaction) {
  const parsed = parseTradeButtonId(interaction.customId);
  if (!parsed?.mint) return false;

  const inflightKey = `${interaction.user.id}:${interaction.customId}`;
  if (tradeInflight.has(inflightKey)) return true;
  tradeInflight.add(inflightKey);

  try {
    if (parsed.type === 'custom_buy') {
      await interaction.showModal(tradeCustomBuyModal(parsed.mint));
      return true;
    }
    if (parsed.type === 'custom_sell') {
      await interaction.showModal(tradeCustomSellModal(parsed.mint));
      return true;
    }

    await interaction.deferReply({ ephemeral: true });

    const s = loadTradeSettings();
    let result;

    if (parsed.type === 'buy') {
      const sol = s.buyPresetsSol[parsed.presetIdx];
      if (sol == null) throw new Error('Preset achat invalide.');
      result = await executeBuyTrade({ mint: parsed.mint, solAmount: sol });
    } else if (parsed.type === 'sell') {
      const pct = s.sellPresetsPct[parsed.presetIdx];
      if (pct == null) throw new Error('Preset vente invalide.');
      result = await executeSellTrade({ mint: parsed.mint, sellPct: pct });
    } else if (parsed.type === 'multi') {
      const sol = s.buyPresetsSol[s.defaultBuyPresetIndex] ?? s.buyPresetsSol[0];
      const prev = s.multiWalletMode;
      patchTradeSettings({ multiWalletMode: 'all' });
      result = await executeBuyTrade({ mint: parsed.mint, solAmount: sol });
      patchTradeSettings({ multiWalletMode: prev });
    } else {
      return false;
    }

    await interaction.editReply({
      content: `**${parsed.type === 'sell' ? 'Vente' : 'Achat'}** · \`${parsed.mint.slice(0, 8)}…\`\n${result.text}`,
    });
    scheduleEphemeralDismiss(interaction);
    return true;
  } catch (e) {
    await showEphemeralError(interaction, e.message || String(e));
    return true;
  } finally {
    tradeInflight.delete(inflightKey);
  }
}

export async function handleTradeModal(interaction) {
  const cid = interaction.customId;

  if (cid.startsWith(TCID.MODAL_CUSTOM_BUY)) {
    await interaction.deferReply({ ephemeral: true });
    const mint = cid.slice(TCID.MODAL_CUSTOM_BUY.length);
    const sol = parseFloat(interaction.fields.getTextInputValue('sol'));
    try {
      const result = await executeBuyTrade({ mint, solAmount: sol });
      await interaction.editReply({ content: result.text });
      scheduleEphemeralDismiss(interaction);
    } catch (e) {
      await showEphemeralError(interaction, e.message);
    }
    return true;
  }

  if (cid.startsWith(TCID.MODAL_CUSTOM_SELL)) {
    await interaction.deferReply({ ephemeral: true });
    const mint = cid.slice(TCID.MODAL_CUSTOM_SELL.length);
    const pct = parseFloat(interaction.fields.getTextInputValue('pct'));
    try {
      const result = await executeSellTrade({ mint, sellPct: pct });
      await interaction.editReply({ content: result.text });
      scheduleEphemeralDismiss(interaction);
    } catch (e) {
      await showEphemeralError(interaction, e.message);
    }
    return true;
  }

  await interaction.deferReply({ ephemeral: true });

  try {
    if (cid === TCID.MODAL_BUY_PRESETS) {
      const presets = parsePresetList(interaction.fields.getTextInputValue('presets'));
      patchTradeSettings({ buyPresetsSol: presets });
      await dismissEphemeral(interaction);
      return true;
    }
    if (cid === TCID.MODAL_SELL_PRESETS) {
      patchTradeSettings({
        sellPresetsPct: parsePresetList(interaction.fields.getTextInputValue('presets'), true),
      });
      await dismissEphemeral(interaction);
      return true;
    }
    if (cid === TCID.MODAL_SLIP) {
      patchTradeSettings({ slippageBps: parseInt(interaction.fields.getTextInputValue('bps'), 10) });
      await dismissEphemeral(interaction);
      return true;
    }
    if (cid === TCID.MODAL_PRIO) {
      const sol = parseFloat(interaction.fields.getTextInputValue('sol'));
      patchTradeSettings({ priorityFeeLamports: solToLamports(sol) });
      await dismissEphemeral(interaction);
      return true;
    }
    if (cid === TCID.MODAL_WL_ADD) {
      const label = interaction.fields.getTextInputValue('label').trim();
      const secret = interaction.fields.getTextInputValue('secret').trim();
      addTradeWallet(label, secret);
      clearBalanceCache();
      await dismissEphemeral(interaction);
      return true;
    }
    if (cid === TCID.MODAL_RESERVE) {
      patchTradeSettings({ minSolReserve: parseFloat(interaction.fields.getTextInputValue('sol')) });
      await dismissEphemeral(interaction);
      return true;
    }
  } catch (e) {
    await showEphemeralError(interaction, e.message || String(e));
    return true;
  }

  return false;
}

export function isTradePanelId(id) {
  return id === TCID.MENU || id === 'bt:trade' || id?.startsWith('bt:trade:');
}

export function isTradeModalId(id) {
  return (
    id?.startsWith('bt:modal:tr') ||
    id?.startsWith(TCID.MODAL_CUSTOM_BUY) ||
    id?.startsWith(TCID.MODAL_CUSTOM_SELL)
  );
}
