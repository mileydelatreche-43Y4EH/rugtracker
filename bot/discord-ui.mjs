import { silentMessage } from '../api/lib/discord-silent.mjs';

/** Durée avant suppression auto des éphémères (import, erreurs, copier CA). */
export const EPHEMERAL_TTL_MS = Number(process.env.EPHEMERAL_TTL_MS || 5000);

export function isUnknownInteraction(err) {
  const code = err?.code ?? err?.rawError?.code;
  return code === 10062 || code === 40060;
}

/**
 * Met à jour le panneau épinglé sans spinner (pas de deferUpdate).
 * interaction.update() = instantané si le payload est prêt en <3 s.
 */
export async function safePanelUpdate(interaction, getPayload) {
  const raw = typeof getPayload === 'function' ? getPayload() : getPayload;
  const payload = silentMessage(await raw);

  try {
    if (!interaction.deferred && !interaction.replied) {
      await interaction.update(payload);
      return true;
    }
    await interaction.editReply(payload);
    return true;
  } catch (e) {
    if (interaction.message?.edit) {
      try {
        await interaction.message.edit(payload);
        return true;
      } catch (e2) {
        if (isUnknownInteraction(e) || isUnknownInteraction(e2)) {
          console.warn('Interaction expirée — reclique sur le bouton');
          return false;
        }
        throw e2;
      }
    }
    if (isUnknownInteraction(e)) {
      console.warn('Interaction expirée — reclique sur le bouton');
      return false;
    }
    throw e;
  }
}

export async function dismissEphemeral(interaction) {
  try {
    if (interaction.deferred || interaction.replied) {
      await interaction.deleteReply();
    }
  } catch {
    /* déjà supprimé ou expiré */
  }
}

export function scheduleEphemeralDismiss(interaction, ms = EPHEMERAL_TTL_MS) {
  if (!ms || ms < 500) return;
  setTimeout(() => {
    void dismissEphemeral(interaction);
  }, ms);
}

export function scheduleMessageDismiss(message, ms = EPHEMERAL_TTL_MS) {
  if (!ms || ms < 500 || !message?.delete) return;
  setTimeout(() => {
    void message.delete().catch(() => {});
  }, ms);
}

export async function showEphemeralFollowUp(interaction, message, ms = EPHEMERAL_TTL_MS) {
  const text = `❌ ${message}`;
  try {
    const follow = await interaction.followUp({ content: text, ephemeral: true });
    scheduleMessageDismiss(follow, ms);
  } catch {
    await showEphemeralError(interaction, message, ms);
  }
}

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

export async function editEphemeralBrief(interaction, content, ms = EPHEMERAL_TTL_MS) {
  return replyEphemeralBrief(interaction, content, ms);
}

export async function replyEphemeralPanel(interaction, payload) {
  await interaction.reply({ ...payload, ephemeral: true });
}
