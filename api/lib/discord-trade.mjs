import { ActionRowBuilder, ButtonBuilder, ButtonStyle } from 'discord.js';
import { loadTradeSettings } from './trade-settings.mjs';
import { formatSolLabel } from './trade-format.mjs';

export const TRADE_BUY_PREFIX = 'bt:tb:';
export const TRADE_SELL_PREFIX = 'bt:ts:';
export const TRADE_MULTI_PREFIX = 'bt:tm:';
export const TRADE_CUSTOM_BUY_PREFIX = 'bt:tcb:';
export const TRADE_CUSTOM_SELL_PREFIX = 'bt:tcs:';

export function tradeBuyId(mint, presetIdx) {
  return `${TRADE_BUY_PREFIX}${mint}:${presetIdx}`;
}

export function tradeSellId(mint, presetIdx) {
  return `${TRADE_SELL_PREFIX}${mint}:${presetIdx}`;
}

export function tradeMultiId(mint) {
  return `${TRADE_MULTI_PREFIX}${mint}`;
}

export function tradeCustomBuyId(mint) {
  return `${TRADE_CUSTOM_BUY_PREFIX}${mint}`;
}

export function tradeCustomSellId(mint) {
  return `${TRADE_CUSTOM_SELL_PREFIX}${mint}`;
}

function parseMintIdx(id, prefix) {
  if (!id.startsWith(prefix)) return null;
  const body = id.slice(prefix.length);
  const i = body.lastIndexOf(':');
  if (i < 0) return null;
  return {
    mint: body.slice(0, i),
    presetIdx: parseInt(body.slice(i + 1), 10),
  };
}

export function parseTradeButtonId(id) {
  if (id.startsWith(TRADE_MULTI_PREFIX)) {
    return { type: 'multi', mint: id.slice(TRADE_MULTI_PREFIX.length) };
  }
  if (id.startsWith(TRADE_CUSTOM_BUY_PREFIX)) {
    return { type: 'custom_buy', mint: id.slice(TRADE_CUSTOM_BUY_PREFIX.length) };
  }
  if (id.startsWith(TRADE_CUSTOM_SELL_PREFIX)) {
    return { type: 'custom_sell', mint: id.slice(TRADE_CUSTOM_SELL_PREFIX.length) };
  }
  const buy = parseMintIdx(id, TRADE_BUY_PREFIX);
  if (buy) return { type: 'buy', ...buy };
  const sell = parseMintIdx(id, TRADE_SELL_PREFIX);
  if (sell) return { type: 'sell', ...sell };
  return null;
}

export function buildTradeButtonRows(mint) {
  const s = loadTradeSettings();
  if (!s.showTradeButtonsOnAlerts) return [];

  const m = String(mint || '').trim();
  const buys = s.buyPresetsSol.slice(0, 3);
  const sells = s.sellPresetsPct.slice(0, 3);

  const rowBuy = new ActionRowBuilder().addComponents(
    ...buys.map((sol, i) =>
      new ButtonBuilder()
        .setCustomId(tradeBuyId(m, i))
        .setLabel(`🟢 Buy ${formatSolLabel(sol)}`.slice(0, 80))
        .setStyle(ButtonStyle.Success),
    ),
    new ButtonBuilder()
      .setCustomId(tradeCustomBuyId(m))
      .setLabel('✏️ Buy…')
      .setStyle(ButtonStyle.Secondary),
  );

  const rowSell = new ActionRowBuilder().addComponents(
    ...sells.map((pct, i) =>
      new ButtonBuilder()
        .setCustomId(tradeSellId(m, i))
        .setLabel(`🔴 Sell ${pct}%`)
        .setStyle(ButtonStyle.Danger),
    ),
    new ButtonBuilder()
      .setCustomId(tradeMultiId(m))
      .setLabel('👛 Multi-buy')
      .setStyle(ButtonStyle.Primary),
    new ButtonBuilder()
      .setCustomId(tradeCustomSellId(m))
      .setLabel('✏️ Sell…')
      .setStyle(ButtonStyle.Secondary),
  );

  return [rowBuy, rowSell];
}

export function isTradeButtonId(id) {
  return (
    id?.startsWith(TRADE_BUY_PREFIX) ||
    id?.startsWith(TRADE_SELL_PREFIX) ||
    id?.startsWith(TRADE_MULTI_PREFIX) ||
    id?.startsWith(TRADE_CUSTOM_BUY_PREFIX) ||
    id?.startsWith(TRADE_CUSTOM_SELL_PREFIX)
  );
}
