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

/** Erreur éphémère uniquement si nécessaire. */
export async function showEphemeralError(interaction, message) {
  const text = `❌ ${message}`;
  try {
    if (interaction.deferred || interaction.replied) {
      await interaction.editReply({ content: text, embeds: [], components: [] });
    } else {
      await interaction.reply({ content: text, ephemeral: true });
    }
  } catch {
    /* ignore */
  }
}
