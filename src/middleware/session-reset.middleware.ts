import { Middleware } from 'telegraf';
import type { Context } from 'telegraf';

/**
 * Middleware to reset stale sessions after server restart.
 *
 * When the server restarts, in-memory sessions are lost automatically.
 * However, if Redis is used for session persistence, sessions survive
 * the restart and users get stuck in the middle of a scene/flow.
 *
 * This middleware records the server start time and, on each update,
 * checks if the session was created before the current server start.
 * If so, it clears the scene state (__scenes) and any other stale
 * session data, forcing the user back to the initial flow (/start).
 *
 * Redis is NOT modified — this works at the Telegraf middleware level.
 */
export function createSessionResetMiddleware(botStartTime: number): Middleware<Context> {
  return async (ctx, next) => {
    const session = (ctx as any).session || {};

    // If session has a botStartTime that matches the current one, it's fresh
    if (session.botStartTime === botStartTime) {
      await next();
      return;
    }

    // Session is stale (created before server restart or missing botStartTime)
    // Clear scene state and other session data, but keep basic chat info
    const keysToKeep = [] as string[]; // we clear everything
    for (const key of Object.keys(session)) {
      delete session[key];
    }

    // Mark session as initialized with current bot start time
    session.botStartTime = botStartTime;
    (ctx as any).session = session;

    // Notify the user that their session was reset
    try {
      if (ctx.callbackQuery) {
        await ctx.answerCbQuery('Сесія скинута після перезапуску сервера').catch(() => null);
      }
      await ctx.reply(
        '⚠️ <b>Вашу сесію скинуто після перезапуску сервера.</b>\n\n' +
        'Будь ласка, натисніть /start, щоб повернутися до головного меню.',
        { parse_mode: 'HTML' },
      ).catch(() => null);
    } catch {
      // Ignore errors — the update will still be passed to global handlers
    }

    await next();
  };
}
