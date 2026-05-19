import {
  ActionRowBuilder,
  ButtonStyle,
  ModalBuilder,
  StringSelectMenuBuilder,
  StringSelectMenuOptionBuilder,
  TextInputBuilder,
  TextInputStyle,
} from 'discord.js';
import { getActiveWallets } from '../api/lib/wallet-store.mjs';
import { listSnipes, getSnipeByAddr, snipeSummaryLines } from '../api/lib/snipe-settings.mjs';
import { formatSolLabel } from '../api/lib/trade-format.mjs';
import {
  UI_COLORS,
  uiBtn,
  uiEmbed,
  uiRow,
  uiRowsPair,
  uiClampRows,
  btnHome,
  navBackHome,
} from './discord-components.mjs';

export const SCID = {
  MENU: 'bt:snipe',
  ADD: 'bt:snipe:add',
  SEL_ADD: 'bt:sel:snipeadd',
  SEL_CFG: 'bt:sel:snipecfg',
  SEL_RM: 'bt:sel:sniperm',
  BACK_TRADE: 'bt:trade',
  MODAL_SOL: 'bt:modal:snipesol:',
  MODAL_BUY_PCT: 'bt:modal:snipebuypct:',
  MODAL_SELL_PCT: 'bt:modal:snipesellpct:',
};

export async function buildSnipeMenu() {
  const lines = snipeSummaryLines();
  const count = listSnipes().length;
  const embed = uiEmbed(
    UI_COLORS.snipe,
    '🎯 Sniping wallets',
    [
      'Copie automatiquement les achats des wallets que tu ajoutes ici.',
      '',
      `**${count}** cible(s) configurée(s)`,
      '',
      lines.join('\n\n').slice(0, 3200) || '_Aucune cible — ajoute un wallet surveillé._',
    ].join('\n'),
    { footer: 'Trading Jupiter doit être ON · réglages par cible dans le menu déroulant' },
  );

  const components = uiClampRows([
    uiRow(uiBtn(SCID.ADD, '➕ Ajouter cible', ButtonStyle.Success), uiBtn(SCID.BACK_TRADE, '💹 Trading', ButtonStyle.Secondary)),
    uiRow(btnHome()),
  ]);

  const snipes = listSnipes();
  if (snipes.length) {
    components.unshift(
      new ActionRowBuilder().addComponents(
        new StringSelectMenuBuilder()
          .setCustomId(SCID.SEL_CFG)
          .setPlaceholder('⚙️ Configurer une cible…')
          .addOptions(
            snipes.slice(0, 25).map(s => {
              const ab = s.autoBuy;
              return new StringSelectMenuOptionBuilder()
                .setLabel(`${ab.enabled ? '🟢' : '⚫'} ${s.label || s.watchAddr.slice(0, 8)}`.slice(0, 100))
                .setDescription(
                  `${ab.enabled ? formatSolLabel(ab.solAmount) : 'off'} · ${s.watchAddr.slice(0, 20)}`,
                )
                .setValue(s.watchAddr);
            }),
          ),
      ),
      new ActionRowBuilder().addComponents(
        new StringSelectMenuBuilder()
          .setCustomId(SCID.SEL_RM)
          .setPlaceholder('🗑️ Retirer une cible…')
          .addOptions(
            snipes.slice(0, 25).map(s =>
              new StringSelectMenuOptionBuilder()
                .setLabel((s.label || s.watchAddr.slice(0, 8)).slice(0, 100))
                .setDescription(s.watchAddr.slice(0, 50))
                .setValue(s.watchAddr),
            ),
          ),
      ),
    );
  }

  return { embeds: [embed], components };
}

export function buildSnipeAddSelect() {
  const sniped = new Set(listSnipes().map(s => s.watchAddr));
  const candidates = getActiveWallets().filter(w => !sniped.has(w.addr));

  const embed = uiEmbed(
    UI_COLORS.snipe,
    '➕ Nouvelle cible snipe',
    candidates.length
      ? 'Choisis un wallet **déjà surveillé** dans tes groupes :'
      : '_Tous tes wallets actifs sont déjà en snipe, ou aucun wallet surveillé._',
  );

  const components = uiClampRows([navBackHome(SCID.MENU)]);
  if (candidates.length) {
    components.unshift(
      new ActionRowBuilder().addComponents(
        new StringSelectMenuBuilder()
          .setCustomId(SCID.SEL_ADD)
          .setPlaceholder('👛 Wallet à sniper…')
          .addOptions(
            candidates.slice(0, 25).map(w =>
              new StringSelectMenuOptionBuilder()
                .setLabel(`${w.groupEmoji} ${w.label}`.slice(0, 100))
                .setDescription(`${w.groupName} · ${w.addr.slice(0, 24)}`)
                .setValue(w.addr),
            ),
          ),
      ),
    );
  }
  return { embeds: [embed], components };
}

export function buildSnipeConfigPanel(watchAddr) {
  const w = getActiveWallets().find(x => x.addr === watchAddr);
  const snipe = getSnipeByAddr(watchAddr);
  if (!snipe) {
    return buildSnipeMenu();
  }
  const ab = snipe.autoBuy;
  const embed = uiEmbed(
    UI_COLORS.snipe,
    `🎯 ${w?.label || watchAddr.slice(0, 8)}`,
    [
      `**Adresse** · \`${watchAddr}\``,
      w?.groupName ? `**Groupe** · ${w.groupEmoji} ${w.groupName}` : '',
      '',
      `**Auto-buy** · ${ab.enabled ? '🟢 ON' : '⚫ OFF'} · **${ab.buyCopyPct}%** du SOL copié · plafond **${formatSolLabel(ab.solAmount)}**`,
      `**Auto-sell** · ${ab.autoSellEnabled ? '🟢 ON' : '⚫ OFF'} · **${ab.sellCopyPct}%** de sa vente`,
      `**Venues** · ${(ab.venues || []).join(', ')} · max **${ab.maxPerMint}** achat(s)/mint`,
    ]
      .filter(Boolean)
      .join('\n'),
  );

  const buyTogLabel = ab.enabled ? '⛔ Stop buy' : '✅ Auto-buy';
  const buyTogStyle = ab.enabled ? ButtonStyle.Danger : ButtonStyle.Success;
  const sellTogLabel = ab.autoSellEnabled ? '⛔ Stop sell' : '✅ Auto-sell';
  const sellTogStyle = ab.autoSellEnabled ? ButtonStyle.Danger : ButtonStyle.Success;

  return {
    embeds: [embed],
    components: uiClampRows(
      uiRowsPair([
        uiBtn(`bt:snipe:tog:${watchAddr}`, buyTogLabel, buyTogStyle),
        uiBtn(`bt:snipe:selltog:${watchAddr}`, sellTogLabel, sellTogStyle),
        uiBtn(`bt:snipe:buypct:${watchAddr}`, `📊 Buy ${ab.buyCopyPct}%`, ButtonStyle.Secondary),
        uiBtn(`bt:snipe:sol:${watchAddr}`, '💰 Plafond SOL', ButtonStyle.Secondary),
        uiBtn(`bt:snipe:sellpct:${watchAddr}`, `📤 Sell ${ab.sellCopyPct}%`, ButtonStyle.Secondary),
        uiBtn(SCID.MENU, '⬅️ Liste', ButtonStyle.Primary),
      ]),
    ),
  };
}

export function snipeSolModal(watchAddr) {
  const snipe = getSnipeByAddr(watchAddr);
  return new ModalBuilder()
    .setCustomId(`${SCID.MODAL_SOL}${watchAddr}`)
    .setTitle('Snipe — plafond SOL')
    .addComponents(
      new ActionRowBuilder().addComponents(
        new TextInputBuilder()
          .setCustomId('sol')
          .setLabel('SOL max par achat auto')
          .setStyle(TextInputStyle.Short)
          .setRequired(true)
          .setValue(String(snipe?.autoBuy?.solAmount ?? 0.1)),
      ),
    );
}

export function snipeBuyPctModal(watchAddr) {
  const ab = getSnipeByAddr(watchAddr)?.autoBuy;
  return new ModalBuilder()
    .setCustomId(`${SCID.MODAL_BUY_PCT}${watchAddr}`)
    .setTitle('Snipe — % achat copié')
    .addComponents(
      new ActionRowBuilder().addComponents(
        new TextInputBuilder()
          .setCustomId('pct')
          .setLabel('% du montant SOL qu’il achète (ex. 50)')
          .setStyle(TextInputStyle.Short)
          .setRequired(true)
          .setValue(String(ab?.buyCopyPct ?? 100)),
      ),
    );
}

export function snipeSellPctModal(watchAddr) {
  const ab = getSnipeByAddr(watchAddr)?.autoBuy;
  return new ModalBuilder()
    .setCustomId(`${SCID.MODAL_SELL_PCT}${watchAddr}`)
    .setTitle('Snipe — % vente copiée')
    .addComponents(
      new ActionRowBuilder().addComponents(
        new TextInputBuilder()
          .setCustomId('pct')
          .setLabel('% de sa vente à copier (100 = miroir)')
          .setStyle(TextInputStyle.Short)
          .setRequired(true)
          .setValue(String(ab?.sellCopyPct ?? 100)),
      ),
    );
}

export function resolveSnipeScreen(id) {
  if (id === SCID.MENU) return 'snipe';
  if (id === SCID.ADD) return 'snipe_add';
  return null;
}

export async function renderSnipeScreen(screen, watchAddr) {
  switch (screen) {
    case 'snipe':
      return await buildSnipeMenu();
    case 'snipe_add':
      return buildSnipeAddSelect();
    case 'snipe_cfg':
      return buildSnipeConfigPanel(watchAddr);
    default:
      return await buildSnipeMenu();
  }
}
