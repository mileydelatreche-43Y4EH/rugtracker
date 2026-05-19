/** Durée avant suppression auto des éphémères (import, trade, erreurs, copier CA). */
export const EPHEMERAL_TTL_MS = Number(process.env.EPHEMERAL_TTL_MS || 5000);

export function isUnknownInteraction(err) {
  const code = err?.code ?? err?.rawError?.code;
  return code === 10062 || code === 40060;
}

/** Met à jour le panneau épinglé sans crash si le clic a expiré (>3 s). */
export async function safePanelUpdate(interaction, getPayload) {
  try {
    if (!interaction.deferred && !interaction.replied) {
      await interaction.deferUpdate();
    }
    const payload = typeof getPayload === 'function' ? await getPayload() : getPayload;
    await interaction.editReply(payload);
    return true;
  } catch (e) {
    if (isUnknownInteraction(e)) {
      console.warn('Interaction expirée — reclique sur le bouton');
      return false;
    }
    throw e;
  }
}

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

/** Supprime l’éphémère après un délai (défaut 5 s). */
export function scheduleEphemeralDismiss(interaction, ms = EPHEMERAL_TTL_MS) {
  if (!ms || ms < 500) return;
  setTimeout(() => {
    void dismissEphemeral(interaction);
  }, ms);
}

/** Supprime un followUp éphémère (boutons panneau après deferUpdate). */
export function scheduleMessageDismiss(message, ms = EPHEMERAL_TTL_MS) {
  if (!ms || ms < 500 || !message?.delete) return;
  setTimeout(() => {
    void message.delete().catch(() => {});
  }, ms);
}

/** Erreur éphémère en followUp (ne remplace pas le panneau épinglé). */
export async function showEphemeralFollowUp(interaction, message, ms = EPHEMERAL_TTL_MS) {
  const text = `❌ ${message}`;
  try {
    const follow = await interaction.followUp({ content: text, ephemeral: true });
    scheduleMessageDismiss(follow, ms);
  } catch {
    await showEphemeralError(interaction, message, ms);
  }
}

/** Erreur éphémère — disparaît après quelques secondes. */
export async function showEphemeralError(interaction, message, ms = EPHEMERAL_TTL_MS) {
  const text = `❌ ${message}`;
  try {
    if (interaction.deferred || interaction.replied) {
      await interaction.editReply({ content: text, embeds: [], components: [] });
    } else {
      await interaction.reply({ content: text, ephemeral: true });
    }
    scheduleEphemeralDismiss(interaction, ms);
  } catch (e) {
    if (!isUnknownInteraction(e)) {
      /* ignore autres */
    }
  }
}

/** Réponse ou édition éphémère courte (texte) — disparaît après 5 s par défaut. */
export async function replyEphemeralBrief(interaction, content, ms = EPHEMERAL_TTL_MS) {
  try {
    if (interaction.deferred || interaction.replied) {
      await interaction.editReply({ content, embeds: [], components: [], files: [] });
    } else {
      await interaction.reply({ content, ephemeral: true });
    }
    scheduleEphemeralDismiss(interaction, ms);
  } catch {
    /* ignore */
  }
}

/** Après deferReply éphémère : affiche le texte puis auto-suppression. */
export async function editEphemeralBrief(interaction, content, ms = EPHEMERAL_TTL_MS) {
  return replyEphemeralBrief(interaction, content, ms);
}

/** Éphémère avec embed/boutons (ex. /menu) — pas d’auto-suppression. */
export async function replyEphemeralPanel(interaction, payload) {
  await interaction.reply({ ...payload, ephemeral: true });
}
