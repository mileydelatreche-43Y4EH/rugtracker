/** Durée avant suppression auto des éphémères (trade, erreurs, copier CA). */
export const EPHEMERAL_TTL_MS = Number(process.env.EPHEMERAL_TTL_MS || 3000);

/** Ferme la réponse éphémère (pas de spam dans le salon). */
export async function dismissEphemeral(interaction) {
  try {
    if (interaction.deferred || interaction.replied) {
      await interaction.deleteReply();
    }
  } catch {
    /* déjà supprimé ou expiré */
  }
}

/** Supprime l’éphémère après un délai (ex. 3 s). */
export function scheduleEphemeralDismiss(interaction, ms = EPHEMERAL_TTL_MS) {
  if (!ms || ms < 500) return;
  setTimeout(() => {
    void dismissEphemeral(interaction);
  }, ms);
}

/** Erreur éphémère — disparaît après quelques secondes. */
export async function showEphemeralError(interaction, message) {
  const text = `❌ ${message}`;
  try {
    if (interaction.deferred || interaction.replied) {
      await interaction.editReply({ content: text, embeds: [], components: [] });
    } else {
      await interaction.reply({ content: text, ephemeral: true });
    }
    scheduleEphemeralDismiss(interaction);
  } catch {
    /* ignore */
  }
}

/** Réponse éphémère courte (texte) avec auto-suppression. */
export async function replyEphemeralBrief(interaction, content, ms = EPHEMERAL_TTL_MS) {
  try {
    if (interaction.deferred || interaction.replied) {
      await interaction.editReply({ content, embeds: [], components: [] });
    } else {
      await interaction.reply({ content, ephemeral: true });
    }
    scheduleEphemeralDismiss(interaction, ms);
  } catch {
    /* ignore */
  }
}

/** Éphémère avec embed/boutons (ex. /menu) — pas d’auto-suppression. */
export async function replyEphemeralPanel(interaction, payload) {
  await interaction.reply({ ...payload, ephemeral: true });
}
