import { importBackup, loadStore, storeSummary } from '../api/lib/wallet-store.mjs';

async function downloadJsonAttachment(att) {
  const res = await fetch(att.url);
  if (!res.ok) throw new Error('Impossible de télécharger le fichier Discord.');
  const raw = await res.text();
  return JSON.parse(raw);
}

function countWallets(store) {
  return store.groups.reduce((n, g) => n + g.wallets.length, 0);
}

/** Importe un fichier .json (export site ou bot). */
export async function importJsonAttachment(att) {
  let data;
  try {
    data = await downloadJsonAttachment(att);
  } catch (e) {
    if (e instanceof SyntaxError) {
      throw new Error('JSON illisible — envoie le .json complet (site ou Exporter .json).');
    }
    throw e;
  }
  importBackup(data);
  const store = loadStore();
  const sum = storeSummary(store);
  return {
    groups: store.groups.length,
    wallets: countWallets(store),
    active: sum.activeCount,
    fileName: att.name || 'backup.json',
  };
}

/** Bouton Importer : instructions. */
export async function startJsonFileImport(interaction) {
  await interaction.reply({
    content: [
      '📥 **Importer backup**',
      '',
      'Envoie **`wallets-export.json`** ou **`bundle-tracker-backup.json`**',
      '**dans ce salon** (glisse-dépose le fichier sur le chat).',
      '',
      '_Export site ou bot — le bot réagit ✅ automatiquement._',
    ].join('\n'),
    ephemeral: true,
  });
}

/**
 * Glisser-déposer dans le salon (sans clic préalable).
 * Nécessite Message Content Intent.
 */
export async function handleJsonImportMessage(message, { onDone, channelId, isAdmin }) {
  if (message.author?.bot) return false;
  if (String(message.channelId) !== String(channelId)) return false;
  if (typeof isAdmin === 'function' && !isAdmin(message.author.id)) return false;

  const att = message.attachments.find(a => /\.json$/i.test(a.name || ''));
  if (!att) return false;

  try {
    const r = await importJsonAttachment(att);
    await message.react('✅').catch(() => {});
    await message
      .reply(
        `✅ **Import OK** · \`${r.fileName}\`\n` +
          `**${r.wallets}** wallet(s) · **${r.groups}** groupe(s) · **${r.active}** actif(s) pour les alertes.`,
      )
      .catch(() => {});
    if (onDone) await onDone();
    return true;
  } catch (e) {
    await message.reply(`❌ Import : ${e.message || e}`).catch(() => {});
    return true;
  }
}
