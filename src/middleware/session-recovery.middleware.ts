import { Middleware } from 'telegraf';
import type { Context } from 'telegraf';

/**
 * Middleware to handle lost sessions after server restart.
 *
 * The `session()` middleware uses in-memory storage by default, so all session
 * data (including scene state `ctx.session.__scenes`) is lost on server restart.
 * When a user presses a button that belongs to a scene, the Telegraf stage
 * middleware cannot find the user's scene context and the update is silently
 * ignored — no response is sent to the user.
 *
 * This middleware detects when a callback query arrives with an empty (freshly
 * initialized) session and notifies the user that their session was reset. It
 * still calls `next()` so global (non-scene) @Action handlers can continue to
 * process the update normally.
 */
export const sessionRecoveryMiddleware: Middleware<Context> = async (ctx, next) => {
  // Only handle callback queries (inline button presses)
  if (!ctx.callbackQuery) {
    await next();
    return;
  }

  // If session has any data, the user has an active session — nothing to recover
  // ctx.session is added by the session() middleware at runtime, not in the base type
  const sessionKeys = Object.keys((ctx as any).session || {});
  if (sessionKeys.length > 0) {
    await next();
    return;
  }

  // Session is empty — it was lost (e.g., after server restart).
  // Notify the user and let the update continue to global handlers.
  try {
    await ctx.answerCbQuery('Сесія скинута після перезапуску сервера').catch(() => null);
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

// redis-cli -u "$REDIS_URL" ping
// redis-cli -u redis://localhost:6379 ping