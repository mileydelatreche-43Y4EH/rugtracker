import { MessageFlags } from 'discord.js';

/** Pas de pop-up Windows / push mobile pour les messages du bot. */
export const DISCORD_SUPPRESS_NOTIFICATIONS = MessageFlags.SuppressNotifications;

export function silentMessage(payload) {
  return { ...payload, flags: DISCORD_SUPPRESS_NOTIFICATIONS };
}

/** Webhook REST : même flag (4096). */
export const WEBHOOK_FLAG_SUPPRESS_NOTIFICATIONS = 4096;

export function silentWebhookBody(body) {
  return { ...body, flags: WEBHOOK_FLAG_SUPPRESS_NOTIFICATIONS };
}
