import { loadTradeSettings, patchTradeSettings } from '../api/lib/trade-settings.mjs';
import {
  addTradeWallet,
  removeTradeWallet,
  listTradeWalletsPublic,
} from '../api/lib/trade-wallets.mjs';
import { parseTradeButtonId } from '../api/lib/discord-trade.mjs';
import { executeBuyTrade, executeSellTrade } from '../api/lib/trade-executor.mjs';
import {
  TCID,
  renderTradeScreen,
  cycleMultiWalletMode,
  parsePresetList,
  tradeBuyPresetsModal,
  tradeSellPresetsModal,
  tradeSlipModal,
  tradePrioModal,
  tradeWalletAddModal,
  tradeAutoSolModal,
  tradeAutoMcModal,
  tradeReserveModal,
  tradeCustomBuyModal,
  tradeCustomSellModal,
} from './discord-trade-panel.mjs';

export async function handleTradePanelButton(interaction) {
  const id = interaction.customId;

  if (id === TCID.TOGGLE) {
    const s = loadTradeSettings();
    patchTradeSettings({ tradingEnabled: !s.tradingEnabled });
    await interaction.update(renderTradeScreen('trade'));
    return true;
  }

  if (id === TCID.BTNS) {
    const s = loadTradeSettings();
    patchTradeSettings({ showTradeButtonsOnAlerts: !s.showTradeButtonsOnAlerts });
    await interaction.update(renderTradeScreen('trade'));
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
    await interaction.showModal(tradePrioModal());
    return true;
  }
  if (id === TCID.WL_ADD) {
    await interaction.showModal(tradeWalletAddModal());
    return true;
  }
  if (id === TCID.AUTO_SOL) {
    await interaction.showModal(tradeAutoSolModal());
    return true;
  }
  if (id === TCID.AUTO_MC) {
    await interaction.showModal(tradeAutoMcModal());
    return true;
  }
  if (id === TCID.RESERVE) {
    await interaction.showModal(tradeReserveModal());
    return true;
  }

  if (id === TCID.MULTI) {
    const mode = cycleMultiWalletMode();
    await interaction.update(renderTradeScreen('trade'));
    await interaction.followUp({ content: `👛 Mode multi-wallet : **${mode}**`, ephemeral: true });
    return true;
  }

  if (id === TCID.AUTO_TOGGLE) {
    const s = loadTradeSettings();
    patchTradeSettings({ autoBuy: { ...s.autoBuy, enabled: !s.autoBuy.enabled } });
    await interaction.update(renderTradeScreen('trade_auto'));
    return true;
  }

  if (id === TCID.MENU) {
    await interaction.update(renderTradeScreen('trade'));
    return true;
  }
  if (id === TCID.WALLETS) {
    await interaction.update(renderTradeScreen('trade_wallets'));
    return true;
  }
  if (id === TCID.WL_RM) {
    await interaction.update(renderTradeScreen('trade_wl_rm'));
    return true;
  }
  if (id === TCID.AUTO) {
    await interaction.update(renderTradeScreen('trade_auto'));
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
    await interaction.update(renderTradeScreen('trade_wallets'));
    await interaction.followUp({
      content: enabled ? `🟢 **${walletId}** activé pour le trading.` : `⚪ **${walletId}** désactivé.`,
      ephemeral: true,
    });
    return true;
  }

  if (id === TCID.SEL_WL_RM) {
    removeTradeWallet(value);
    await interaction.update(renderTradeScreen('trade_wl_rm'));
    await interaction.followUp({ content: '🗑 Wallet trading retiré.', ephemeral: true });
    return true;
  }

  return false;
}

export async function handleTradeAlertButton(interaction) {
  const parsed = parseTradeButtonId(interaction.customId);
  if (!parsed?.mint) return false;

  if (parsed.type === 'custom_buy') {
    await interaction.showModal(tradeCustomBuyModal(parsed.mint));
    return true;
  }
  if (parsed.type === 'custom_sell') {
    await interaction.showModal(tradeCustomSellModal(parsed.mint));
    return true;
  }

  await interaction.deferReply({ ephemeral: true });

  try {
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
  } catch (e) {
    await interaction.editReply({ content: `❌ ${e.message || e}` });
  }
  return true;
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
    } catch (e) {
      await interaction.editReply({ content: `❌ ${e.message}` });
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
    } catch (e) {
      await interaction.editReply({ content: `❌ ${e.message}` });
    }
    return true;
  }

  await interaction.deferReply({ ephemeral: true });

  try {
    if (cid === TCID.MODAL_BUY_PRESETS) {
      const presets = parsePresetList(interaction.fields.getTextInputValue('presets'));
      patchTradeSettings({ buyPresetsSol: presets });
      await interaction.editReply({ content: `✅ Presets achat : ${presets.join(', ')} SOL` });
      return true;
    }
    if (cid === TCID.MODAL_SELL_PRESETS) {
      const presets = parsePresetList(interaction.fields.getTextInputValue('presets'), true);
      patchTradeSettings({ sellPresetsPct: presets });
      await interaction.editReply({ content: `✅ Presets vente : ${presets.join(', ')}%` });
      return true;
    }
    if (cid === TCID.MODAL_SLIP) {
      const bps = parseInt(interaction.fields.getTextInputValue('bps'), 10);
      patchTradeSettings({ slippageBps: bps });
      await interaction.editReply({ content: `✅ Slippage : ${(bps / 100).toFixed(1)}%` });
      return true;
    }
    if (cid === TCID.MODAL_PRIO) {
      const lamports = parseInt(interaction.fields.getTextInputValue('lamports'), 10);
      patchTradeSettings({ priorityFeeLamports: lamports });
      await interaction.editReply({ content: `✅ Priorité : ${lamports} lamports` });
      return true;
    }
    if (cid === TCID.MODAL_WL_ADD) {
      const label = interaction.fields.getTextInputValue('label').trim();
      const secret = interaction.fields.getTextInputValue('secret').trim();
      const w = addTradeWallet(label, secret);
      await interaction.editReply({
        content: `✅ Wallet **${w.label}** enregistré (\`${w.pubkey.slice(0, 8)}…\`).`,
      });
      return true;
    }
    if (cid === TCID.MODAL_AUTO_SOL) {
      const sol = parseFloat(interaction.fields.getTextInputValue('sol'));
      const s = loadTradeSettings();
      patchTradeSettings({ autoBuy: { ...s.autoBuy, solAmount: sol } });
      await interaction.editReply({ content: `✅ Auto-buy : ${sol} SOL` });
      return true;
    }
    if (cid === TCID.MODAL_AUTO_MC) {
      const min = parseFloat(interaction.fields.getTextInputValue('min'));
      const max = parseFloat(interaction.fields.getTextInputValue('max'));
      const s = loadTradeSettings();
      patchTradeSettings({ autoBuy: { ...s.autoBuy, minMcUsd: min, maxMcUsd: max } });
      await interaction.editReply({ content: `✅ MC auto-buy : ${min} – ${max} USD` });
      return true;
    }
    if (cid === TCID.MODAL_RESERVE) {
      const sol = parseFloat(interaction.fields.getTextInputValue('sol'));
      patchTradeSettings({ minSolReserve: sol });
      await interaction.editReply({ content: `✅ Réserve SOL : ${sol}◎` });
      return true;
    }
  } catch (e) {
    await interaction.editReply({ content: `❌ ${e.message || e}` });
    return true;
  }

  return false;
}

export function isTradePanelId(id) {
  return id === TCID.MENU || id?.startsWith('bt:trade:') || id === 'bt:trade';
}

export function isTradeModalId(id) {
  return (
    id?.startsWith('bt:modal:tr') ||
    id?.startsWith(TCID.MODAL_CUSTOM_BUY) ||
    id?.startsWith(TCID.MODAL_CUSTOM_SELL)
  );
}
