import { Action, Ctx, On, Start, Update } from "nestjs-telegraf";
import { Logger } from "@nestjs/common";
import { OrdersService } from "../../orders/orders.service";
import { AdminService } from "./admin.service";
import { Context, Markup } from "telegraf";
import { OrderStepUa } from "../telegram-constants";
import { OrderStatus, UnassignReason } from "../../orders/models/order-status";
import { ExecutorConst } from "../../telegram-bot/executor/model/executor-const";

@Update()
export class TelegramAdminListener {
  private readonly logger = new Logger(TelegramAdminListener.name);

  constructor(
    private readonly ordersService: OrdersService,
    private readonly adminService: AdminService,
  ) {
  }

  /**
   * 👑 Обробка команди /start для Адмін-бота
   */
  @Start()
  async onStart(@Ctx() ctx: Context) {
    this.logger.log(`[TelegramAdminListener] onStart`, { userId: ctx.from?.id });

    const telegramId = ctx.from?.id?.toString() ?? '';
    if (telegramId) {
      await this.adminService.upsertAdmin({
        telegramId,
        username: ctx.from?.username ?? null,
        firstName: ctx.from?.first_name ?? null,
        lastName: ctx.from?.last_name ?? null,
      });
    }

    await ctx.reply(
      OrderStepUa.AdminWelcome + OrderStepUa.AdminWelcomeDescription,
      { parse_mode: 'HTML' }
    );
  }

  // 1. Admin confirms executor assignment (after executor took order + before-photos)
  @Action(/^admin_confirm_executor_(.+)$/)
  async handleAdminConfirmExecutor(@Ctx() ctx: Context) {
    this.logger.log(`[TelegramAdminListener] handleAdminConfirmExecutor`, { data: (ctx as any).callbackQuery?.data });
    if (!ctx.has('callback_query') || !('data' in ctx.callbackQuery)) return;
    const orderId = ctx.callbackQuery.data.replace('admin_confirm_executor_', '');

    try {
      const adminId = ctx.from?.id.toString() ?? '';
      await this.ordersService.confirmExecutorAssignment(orderId, adminId);

      await ctx.editMessageReplyMarkup({ inline_keyboard: [] }).catch(() => null);
      const message = ctx.callbackQuery.message;
      const text = `✅ <b>Виконавця підтверджено для замовлення №${orderId}</b>\n\nВиконавець може приступати до виконання робіт.`;

      // Оновлюємо повідомлення у всіх інших адмінах (прибираємо кнопки)
      if (ctx.from?.id) {
        await this.ordersService.notifyAdminsOrderResolved(orderId, ctx.from.id, text).catch(() => null);
      }

      if (message && 'photo' in message && message.photo) {
        await ctx.editMessageCaption(text, { parse_mode: 'HTML' });
      } else {
        await ctx.reply(text, { parse_mode: 'HTML' });
      }
    } catch (error) {
      console.error(error);
      await ctx.answerCbQuery('Помилка підтвердження виконавця.');
    }
  }

  // 2. Admin clarifies executor assignment
  @Action(/^admin_clarify_executor_(.+)$/)
  async handleAdminClarifyExecutor(@Ctx() ctx: any) {
    this.logger.log(`[TelegramAdminListener] handleAdminClarifyExecutor`, { data: ctx.callbackQuery?.data });
    if (!ctx.has('callback_query') || !('data' in ctx.callbackQuery)) return;
    const orderId = ctx.callbackQuery.data.replace('admin_clarify_executor_', '');

    try {
      // Hide inline keyboard buttons after click
      await ctx.editMessageReplyMarkup({ inline_keyboard: [] }).catch(() => null);

      // Validate order exists and is in Assigned status
      const order = await this.ordersService.findById(orderId);
      if (!order) {
        await ctx.answerCbQuery('Замовлення не знайдено.');
        return;
      }
      if (order.status !== OrderStatus.Assigned) {
        await ctx.answerCbQuery('Замовлення не в статусі Assigned. Уточнення неможливе.');
        return;
      }

      ctx.session = ctx.session || {};
      ctx.session.adminClarifyingOrderId = orderId;

      await ctx.reply(
        `❓ <b>Уточнення по замовленню №${orderId}</b>\n\nБудь ласка, напишіть коментар для виконавця (що саме потрібно уточнити/виправити).`,
        { parse_mode: 'HTML' },
      );
      await ctx.answerCbQuery('Очікую на ваш коментар...');
    } catch (error) {
      console.error(error);
      await ctx.answerCbQuery('Помилка ініціації уточнення.');
    }
  }

  // 3. Admin confirms before photos (specific — must be before generic admin_confirm_)
  @Action(/^admin_confirm_before_photos_(.+)$/)
  async handleAdminConfirmBeforePhotos(@Ctx() ctx: Context) {
    this.logger.log(`[TelegramAdminListener] handleAdminConfirmBeforePhotos`, { data: (ctx as any).callbackQuery?.data });
    if (!ctx.has('callback_query') || !('data' in ctx.callbackQuery)) return;
    const orderId = ctx.callbackQuery.data.replace('admin_confirm_before_photos_', '');

    try {
      const adminId = ctx.from?.id.toString() ?? '';
      await this.ordersService.confirmBeforePhotos(orderId, adminId);

      await ctx.editMessageReplyMarkup({ inline_keyboard: [] }).catch(() => null);
      const message = ctx.callbackQuery.message;
      const text = `✅ <b>Фото «до» підтверджено для замовлення №${orderId}</b>\n\nВиконавець може приступати до виконання робіт.`;

      // Оновлюємо повідомлення у всіх інших адмінах (прибираємо кнопки)
      if (ctx.from?.id) {
        await this.ordersService.notifyAdminsOrderResolved(orderId, ctx.from.id, text).catch(() => null);
      }

      if (message && 'photo' in message && message.photo) {
        await ctx.editMessageCaption(text, { parse_mode: 'HTML' });
      } else {
        await ctx.reply(text, { parse_mode: 'HTML' });
      }
    } catch (error) {
      console.error(error);
      await ctx.answerCbQuery('Помилка підтвердження фото «до».');
    }
  }

  // 4. Admin requests clarification on before photos (specific — must be before generic admin_clarify_)
  @Action(/^admin_clarify_before_photos_(.+)$/)
  async handleAdminClarifyBeforePhotos(@Ctx() ctx: any) {
    this.logger.log(`[TelegramAdminListener] handleAdminClarifyBeforePhotos`, { data: ctx.callbackQuery?.data });
    if (!ctx.has('callback_query') || !('data' in ctx.callbackQuery)) return;
    const orderId = ctx.callbackQuery.data.replace('admin_clarify_before_photos_', '');

    try {
      ctx.session = ctx.session || {};
      ctx.session.adminClarifyingBeforePhotosOrderId = orderId;

      await ctx.reply(
        `❓ <b>Уточнення щодо фото «до» (замовлення №${orderId})</b>\n\nБудь ласка, напишіть коментар для виконавця (що саме потрібно уточнити/виправити у фото).`,
        { parse_mode: 'HTML' },
      );
      await ctx.answerCbQuery('Очікую на ваш коментар...');
    } catch (error) {
      console.error(error);
      await ctx.answerCbQuery('Помилка ініціації уточнення.');
    }
  }

  // 5. Admin confirms completion of work (specific — must be before generic admin_confirm_)
  @Action(/^admin_confirm_completion_(.+)$/)
  async handleAdminConfirmCompletion(@Ctx() ctx: Context) {
    this.logger.log(`[TelegramAdminListener] handleAdminConfirmCompletion`, { data: (ctx as any).callbackQuery?.data });
    if (!ctx.has('callback_query') || !('data' in ctx.callbackQuery)) return;
    const orderId = ctx.callbackQuery.data.replace('admin_confirm_completion_', '');

    try {
      const adminId = ctx.from?.id.toString() ?? '';
      await this.ordersService.confirmCompletion(orderId, adminId);
      //
      await this.ordersService.notifyExecutorCompletion(orderId);

      await ctx.editMessageReplyMarkup({ inline_keyboard: [] }).catch(() => null);
      const message = ctx.callbackQuery.message;
      const text = `✅ <b>Виконання підтверджено для замовлення №${orderId}</b>\n\nЗамовлення завершено. Звіт надіслано клієнту.`;

      // Оновлюємо повідомлення у всіх інших адмінах (прибираємо кнопки)
      if (ctx.from?.id) {
        await this.ordersService.notifyAdminsOrderResolved(orderId, ctx.from.id, text).catch(() => null);
      }

      if (message && 'photo' in message && message.photo) {
        await ctx.editMessageCaption(text, { parse_mode: 'HTML' });
      } else {
        await ctx.reply(text, { parse_mode: 'HTML' });
      }
    } catch (error) {
      console.error(error);
      await ctx.answerCbQuery('Помилка підтвердження виконання.');
    }
  }

  // 6. Admin requests revision (specific)
  @Action(/^admin_request_revision_(.+)$/)
  async handleAdminRequestRevision(@Ctx() ctx: any) {
    this.logger.log(`[TelegramAdminListener] handleAdminRequestRevision`, { data: ctx.callbackQuery?.data });
    if (!ctx.has('callback_query') || !('data' in ctx.callbackQuery)) return;
    const orderId = ctx.callbackQuery.data.replace('admin_request_revision_', '');

    try {
      ctx.session = ctx.session || {};
      ctx.session.adminRequestingRevisionOrderId = orderId;

      await ctx.reply(
        `🔄 <b>Повернення на доопрацювання (замовлення №${orderId})</b>\n\nБудь ласка, напишіть опис недоліків, які потрібно виправити виконавцю.`,
        { parse_mode: 'HTML' },
      );
      await ctx.answerCbQuery('Очікую на опис недоліків...');
    } catch (error) {
      console.error(error);
      await ctx.answerCbQuery('Помилка ініціації доопрацювання.');
    }
  }

  // 7. Обробка кнопки "Підтвердити" (клієнтське замовлення) — GENERIC, must be after specific handlers
  @Action(/^admin_confirm_(.+)_(.+)$/)
  async handleAdminConfirm(@Ctx() ctx: Context) {
    this.logger.log(`[TelegramAdminListener] handleAdminConfirm`, { data: (ctx as any).callbackQuery?.data });
    if (!ctx.has('callback_query') || !('data' in ctx.callbackQuery)) return;

    // Витягуємо orderId та clientId за допомогою регулярного виразу
    const [, orderId, clientId] = ctx.callbackQuery.data.match(/^admin_confirm_(.+)_(.+)$/) || [];

    try {
      await this.ordersService.confirmAndNotify(orderId, clientId);

      // Передаємо порожній inlineKeyboard, щоб кнопки миттєво зникли
      await ctx.editMessageReplyMarkup({ inline_keyboard: [] }).catch(() => null);

      const message = ctx.callbackQuery.message;
      const text = `🟢 <b>Заявку №${orderId} ПІДТВЕРДЖЕНО</b>`;

      // 🔥 ФІКС: Перевіряємо, чи є в повідомленні масив фотографій
      if (message && 'photo' in message && message.photo) {
        await ctx.editMessageCaption(text, { parse_mode: 'HTML' });
      } else {
        // await ctx.editMessageText(text, { parse_mode: 'HTML' });
        await ctx.reply(text, { parse_mode: 'HTML' })
      }

      // Оновлюємо повідомлення у всіх інших адмінах (прибираємо кнопки)
      if (ctx.from?.id) {
        await this.ordersService.notifyAdminsOrderResolved(orderId, ctx.from.id, text).catch(() => null);
      }

      // Оновлюємо статус замовлення
      await this.ordersService.updateStatus(orderId, OrderStatus.AvailableForExecutor);
    } catch (error) {
      console.error(error);
      await ctx.answerCbQuery('Помилка оновлення статусу.');
    }
  }

  // 8. Обробка кнопки "Відхилити"
  @Action(/^admin_reject_(.+)_(.+)$/)
  async handleAdminReject(@Ctx() ctx: Context) {
    this.logger.log(`[TelegramAdminListener] handleAdminReject`, { data: (ctx as any).callbackQuery?.data });
    if (!ctx.has('callback_query') || !('data' in ctx.callbackQuery)) return;
    const [, orderId, clientId] = ctx.callbackQuery.data.match(/^admin_reject_(.+)_(.+)$/) || [];

    try {
      await this.ordersService.rejectAndNotify(orderId, clientId);

      // Передаємо порожній inlineKeyboard, щоб кнопки миттєво зникли
      await ctx.editMessageReplyMarkup({ inline_keyboard: [] }).catch(() => null);

      const message = ctx.callbackQuery.message;
      const text = `🔴 <b>Заявку №${orderId} ВІДХИЛЕНО</b>`;

      // Оновлюємо повідомлення у всіх інших адмінах (прибираємо кнопки)
      if (ctx.from?.id) {
        await this.ordersService.notifyAdminsOrderResolved(orderId, ctx.from.id, text).catch(() => null);
      }

      // 🔥 ФІКС: Перевіряємо наявність фото
      if (message && 'photo' in message && message.photo) {
        await ctx.editMessageCaption(text, { parse_mode: 'HTML' });
      } else {
        // await ctx.editMessageText(text, { parse_mode: 'HTML' });
        await ctx.reply(text, { parse_mode: 'HTML' })
      }
    } catch (error) {
      console.error(error);
      await ctx.answerCbQuery('Помилка оновлення статусу.');
    }
  }

  // 9. Admin requests clarification from executor (GENERIC — after specific admin_clarify_before_photos_)
  @Action(/^admin_clarify_(.+)_(.+)$/)
  async handleAdminClarify(@Ctx() ctx: Context) {
    this.logger.log(`[TelegramAdminListener] handleAdminClarify`, { data: (ctx as any).callbackQuery?.data });
    if (!ctx.has('callback_query') || !('data' in ctx.callbackQuery)) return;
    const [, orderId, clientId] = ctx.callbackQuery.data.match(/^admin_clarify_(.+)_(.+)$/) || [];

    try {
      await this.ordersService.clarifyAndNotify(orderId, clientId);

      const message = ctx.callbackQuery.message;
      const text = `🟡 <b>Надіслано запит на УТОЧНЕННЯ до заявки №${orderId}</b>`;

      // Оновлюємо повідомлення у всіх інших адмінах (прибираємо кнопки)
      if (ctx.from?.id) {
        await this.ordersService.notifyAdminsOrderResolved(orderId, ctx.from.id, text).catch(() => null);
      }

      // 🔥 ФІКС: Перевіряємо наявність фото
      if (message && 'photo' in message && message.photo) {
        await ctx.editMessageCaption(text, { parse_mode: 'HTML' });
      } else {
        await ctx.editMessageText(text, { parse_mode: 'HTML' });
      }
    } catch (error) {
      console.error(error);
      await ctx.answerCbQuery('Помилка оновлення статусу.');
    }
  }

  // 10. Обробка кнопки "Надіслати на ревізію"
  @Action(/^admin_revision_(.+)$/)
  async handleAdminRevision(@Ctx() ctx: Context) {
    this.logger.log(`[TelegramAdminListener] handleAdminRevision`, { data: (ctx as any).callbackQuery?.data });
    if (!ctx.has('callback_query') || !('data' in ctx.callbackQuery)) return;
    const orderId = ctx.callbackQuery.data.replace('admin_revision_', '');

    try {
      const adminId = ctx.from?.id.toString() ?? '';
      await this.ordersService.revisionRequired(orderId, adminId, 'Замовлення потребує ревізії');

      await ctx.editMessageReplyMarkup({ inline_keyboard: [] }).catch(() => null);
      const message = ctx.callbackQuery.message;
      const text = `🔄 <b>Заявку №${orderId} НАДІСЛАНО НА РЕВІЗІЮ</b>`;

      // Оновлюємо повідомлення у всіх інших адмінах (прибираємо кнопки)
      if (ctx.from?.id) {
        await this.ordersService.notifyAdminsOrderResolved(orderId, ctx.from.id, text).catch(() => null);
      }

      if (message && 'photo' in message && message.photo) {
        await ctx.editMessageCaption(text, { parse_mode: 'HTML' });
      } else {
        await ctx.reply(text, { parse_mode: 'HTML' });
      }
    } catch (error) {
      console.error(error);
      await ctx.answerCbQuery('Помилка створення ревізії.');
    }
  }

  // 11. Обробка кнопки "Схвалити"
  @Action(/^admin_approve_(.+)$/)
  async handleAdminApprove(@Ctx() ctx: Context) {
    this.logger.log(`[TelegramAdminListener] handleAdminApprove`, { data: (ctx as any).callbackQuery?.data });
    if (!ctx.has('callback_query') || !('data' in ctx.callbackQuery)) return;
    const orderId = ctx.callbackQuery.data.replace('admin_approve_', '');

    try {
      const adminId = ctx.from?.id.toString() ?? '';
      await this.ordersService.approveCompletion(orderId, adminId);
      await this.ordersService.sendClientReport(orderId);
      // await this.ordersService.notifyExecutorCompletion(orderId);

      await ctx.editMessageReplyMarkup({ inline_keyboard: [] }).catch(() => null);
      const message = ctx.callbackQuery.message;
      const text = `✅ <b>Заявку №${orderId} СХВАЛЕНО</b>`;

      // Оновлюємо повідомлення у всіх інших адмінах (прибираємо кнопки)
      if (ctx.from?.id) {
        await this.ordersService.notifyAdminsOrderResolved(orderId, ctx.from.id, text).catch(() => null);
      }

      if (message && 'photo' in message && message.photo) {
        await ctx.editMessageCaption(text, { parse_mode: 'HTML' });
      } else {
        await ctx.reply(text, { parse_mode: 'HTML' });
      }
    } catch (error) {
      console.error(error);
      await ctx.answerCbQuery('Помилка схвалення.');
    }
  }

  // 12. Unassign Executor - show reason selection
  @Action(/^admin_unassign_(.+)$/)
  async handleAdminUnassign(@Ctx() ctx: Context) {
    this.logger.log(`[TelegramAdminListener] handleAdminUnassign`, { data: (ctx as any).callbackQuery?.data });
    if (!ctx.has('callback_query') || !('data' in ctx.callbackQuery)) return;
    const orderId = ctx.callbackQuery.data.replace('admin_unassign_', '');

    const reasons = Object.values(UnassignReason);
    const buttons = reasons.map(r => [
      Markup.button.callback(
        `➖ ${r}`,
        `admin_unassign_reason_${orderId}_${r}`
      ),
    ]);
    buttons.push([Markup.button.callback('❌ Скасувати', 'admin_cancel_unassign')]);

    await ctx.reply(
      `📋 <b>Оберіть причину скасування призначення виконавця для заявки №${orderId}</b>`,
      { parse_mode: 'HTML', reply_markup: Markup.inlineKeyboard(buttons).reply_markup }
    );
  }

  // 13. Unassign Executor - confirm with reason
  @Action(/^admin_unassign_reason_(.+)_(.+)$/)
  async handleAdminUnassignReason(@Ctx() ctx: Context) {
    this.logger.log(`[TelegramAdminListener] handleAdminUnassignReason`, { data: (ctx as any).callbackQuery?.data });
    if (!ctx.has('callback_query') || !('data' in ctx.callbackQuery)) return;
    const match = ctx.callbackQuery.data.match(/^admin_unassign_reason_(.+)_(.+)$/);
    if (!match) return;
    const [, orderId, reason] = match;

    try {
      const adminId = ctx.from?.id.toString() ?? '';
      await this.ordersService.unassignExecutor(orderId, adminId, reason as UnassignReason);

      await ctx.editMessageReplyMarkup({ inline_keyboard: [] }).catch(() => null);
      const message = ctx.callbackQuery.message;
      const text = `➖ <b>Виконавця скасовано для заявки №${orderId}</b>\nПричина: ${reason}`;

      // Оновлюємо повідомлення у всіх інших адмінах (прибираємо кнопки)
      if (ctx.from?.id) {
        await this.ordersService.notifyAdminsOrderResolved(orderId, ctx.from.id, text).catch(() => null);
      }

      if (message && 'photo' in message && message.photo) {
        await ctx.editMessageCaption(text, { parse_mode: 'HTML' });
      } else {
        await ctx.reply(text, { parse_mode: 'HTML' });
      }
    } catch (error) {
      console.error(error);
      await ctx.answerCbQuery('Помилка скасування призначення.');
    }
  }

  // 14. Change Executor
  @Action(/^admin_change_executor_(.+)$/)
  async handleAdminChangeExecutor(@Ctx() ctx: Context) {
    this.logger.log(`[TelegramAdminListener] handleAdminChangeExecutor`, { data: (ctx as any).callbackQuery?.data });
    if (!ctx.has('callback_query') || !('data' in ctx.callbackQuery)) return;
    const orderId = ctx.callbackQuery.data.replace('admin_change_executor_', '');

    await ctx.reply(
      `🔄 <b>Зміна виконавця для заявки №${orderId}</b>\n\n` +
      `Надішліть ID нового виконавця.`,
      { parse_mode: 'HTML' }
    );
    await ctx.answerCbQuery('Введіть ID нового виконавця');
  }

  // 15. Take Over - admin becomes executor
  @Action(/^admin_take_over_(.+)$/)
  async handleAdminTakeOver(@Ctx() ctx: Context) {
    this.logger.log(`[TelegramAdminListener] handleAdminTakeOver`, { data: (ctx as any).callbackQuery?.data });
    if (!ctx.has('callback_query') || !('data' in ctx.callbackQuery)) return;
    const orderId = ctx.callbackQuery.data.replace('admin_take_over_', '');

    try {
      const adminId = ctx.from?.id.toString() ?? '';
      await this.ordersService.takeOverExecutor(orderId, adminId);

      await ctx.editMessageReplyMarkup({ inline_keyboard: [] }).catch(() => null);
      const message = ctx.callbackQuery.message;
      const text = `👑 <b>Ви взяли замовлення №${orderId} на себе як виконавець</b>`;

      // Оновлюємо повідомлення у всіх інших адмінах (прибираємо кнопки)
      if (ctx.from?.id) {
        await this.ordersService.notifyAdminsOrderResolved(orderId, ctx.from.id, text).catch(() => null);
      }

      if (message && 'photo' in message && message.photo) {
        await ctx.editMessageCaption(text, { parse_mode: 'HTML' });
      } else {
        await ctx.reply(text, { parse_mode: 'HTML' });
      }
    } catch (error) {
      console.error(error);
      await ctx.answerCbQuery('Помилка переймання замовлення.');
    }
  }

  // ==================== Not Found flow: Admin actions ====================

  // Admin clicks "Уточнить в клиента"
  @Action(/^admin_notfound_clarify_client_(.+)$/)
  async handleAdminClarifyClient(@Ctx() ctx: any) {
    this.logger.log(`[TelegramAdminListener] handleAdminClarifyClient`, { data: ctx.callbackQuery?.data });
    if (!ctx.has('callback_query') || !('data' in ctx.callbackQuery)) return;
    const orderId = ctx.callbackQuery.data.replace('admin_notfound_clarify_client_', '');

    try {
      const adminId = ctx.from?.id.toString() ?? '';
      ctx.session = ctx.session || {};
      ctx.session.adminClarifyingClientOrderId = orderId;
      ctx.session.adminClarifyingClientAdminId = adminId;

      // Отримуємо замовлення, щоб знати clientTelegramId
      const order = await this.ordersService.findById(orderId);
      if (!order) {
        await ctx.answerCbQuery('Замовлення не знайдено.');
        return;
      }

      const clientTelegramId = order.client?.telegramId;
      if (!clientTelegramId) {
        await ctx.answerCbQuery('У замовлення немає телеграм-ID клієнта.');
        return;
      }

      // Реєструємо сесію уточнення: коли клієнт відповість, повідомлення піде цьому адміну
      this.ordersService.registerClientClarificationSession(clientTelegramId, adminId, orderId);

      // Надсилаємо клієнту запит на уточнення
      await this.ordersService.sendClarificationToClient(clientTelegramId, orderId);

      await ctx.answerCbQuery('Запит на уточнення надіслано клієнту.');
      await ctx.reply(
        ExecutorConst.AdminClarificationSentToClient(orderId),
        { parse_mode: 'HTML' },
      );
    } catch (error) {
      console.error(error);
      await ctx.answerCbQuery('Помилка надсилання запиту клієнту.');
    }
  }

  // Admin clicks "Написать сообщение"
  @Action(/^admin_write_message_(.+)$/)
  async handleAdminWriteMessage(@Ctx() ctx: any) {
    this.logger.log(`[TelegramAdminListener] handleAdminWriteMessage`, { data: ctx.callbackQuery?.data });
    if (!ctx.has('callback_query') || !('data' in ctx.callbackQuery)) return;
    const orderId = ctx.callbackQuery.data.replace('admin_write_message_', '');

    try {
      ctx.session = ctx.session || {};
      ctx.session.adminWritingMessageOrderId = orderId;
      ctx.session.adminWritingMessageAdminId = ctx.from?.id?.toString() ?? '';

      await ctx.reply(
        `✍️ <b>Напишіть повідомлення виконавцю для замовлення №${orderId}</b>\n\nВведіть текст повідомлення:`,
        { parse_mode: 'HTML' },
      );
      await ctx.answerCbQuery('Очікую на ваш текст...');
    } catch (error) {
      console.error(error);
      await ctx.answerCbQuery('Помилка ініціації написання повідомлення.');
    }
  }

  // Admin clicks "Переслать виконавцю" (forward client's message to executor)
  @Action(/^admin_forward_to_executor_(.+)$/)
  async handleAdminForwardToExecutor(@Ctx() ctx: any) {
    this.logger.log(`[TelegramAdminListener] handleAdminForwardToExecutor`, { data: ctx.callbackQuery?.data });
    if (!ctx.has('callback_query') || !('data' in ctx.callbackQuery)) return;
    const orderId = ctx.callbackQuery.data.replace('admin_forward_to_executor_', '');

    try {
      const adminId = ctx.from?.id.toString() ?? '';
      const order = await this.ordersService.findById(orderId);
      if (!order) {
        await ctx.answerCbQuery('Замовлення не знайдено.');
        return;
      }

      const executorId = order.assignment?.executorId;
      if (!executorId) {
        await ctx.answerCbQuery('Для замовлення не призначено виконавця.');
        return;
      }

      // Отримуємо telegramId виконавця
      const executorTelegramId = await this.ordersService.getExecutorTelegramId(executorId) ?? executorId;

      // Отримуємо повідомлення клієнта для адміна
      const clientMessageData = this.ordersService.popClientMessageForAdmin(adminId);
      if (!clientMessageData) {
        await ctx.answerCbQuery('Повідомлення клієнта не знайдено.');
        return;
      }

      await this.ordersService.sendMessageToExecutorWithButtons(
        executorTelegramId,
        orderId,
        'Клієнт (через адміністратора)',
        clientMessageData.messageText,
      );

      await ctx.answerCbQuery('Повідомлення переслано виконавцю.');
      await ctx.reply(
        ExecutorConst.AdminForwardedToExecutor(orderId),
        { parse_mode: 'HTML' },
      );
    } catch (error) {
      console.error(error);
      await ctx.answerCbQuery('Помилка пересилання повідомлення виконавцю.');
    }
  }

  // 16. Capture admin's clarification comment for before photos / revision / executor
  @On('message')
  async handleAdminClarificationComment(@Ctx() ctx: any) {
    this.logger.log(`[TelegramAdminListener] handleAdminClarificationComment`, { text: ctx.message?.text });
    const beforePhotosOrderId = (ctx.session as any)?.adminClarifyingBeforePhotosOrderId;
    const revisionOrderId = (ctx.session as any)?.adminRequestingRevisionOrderId;

    if (beforePhotosOrderId) {
      const adminId = ctx.from?.id?.toString() ?? '';
      const comment = ctx.message?.text?.trim();
      if (!comment) return;

      try {
        await this.ordersService.clarifyBeforePhotos(beforePhotosOrderId, adminId, comment);

        // Clear session state
        (ctx.session as any).adminClarifyingBeforePhotosOrderId = null;

        await ctx.reply(
          `🟡 <b>Запит на уточнення фото «до» надіслано виконавцю (замовлення №${beforePhotosOrderId})</b>\n\nКоментар: ${comment}`,
          { parse_mode: 'HTML' },
        );
      } catch (error) {
        console.error(error);
        await ctx.reply('Помилка надсилання запиту на уточнення.');
      }
      return;
    }

    if (revisionOrderId) {
      const adminId = ctx.from?.id?.toString() ?? '';
      const comment = ctx.message?.text?.trim();
      if (!comment) return;

      try {
        await this.ordersService.requestRevision(revisionOrderId, adminId, comment);

        // Clear session state
        (ctx.session as any).adminRequestingRevisionOrderId = null;

        await ctx.reply(
          `🔄 <b>Замовлення повернено на доопрацювання (замовлення №${revisionOrderId})</b>\n\nОпис недоліків: ${comment}`,
          { parse_mode: 'HTML' },
        );
      } catch (error) {
        console.error(error);
        await ctx.reply('Помилка повернення на доопрацювання.');
      }
      return;
    }

    // Admin is writing a message to executor (from "Написать сообщение" flow)
    const writingOrderId = (ctx.session as any)?.adminWritingMessageOrderId;
    if (writingOrderId) {
      const adminId = ctx.from?.id?.toString() ?? '';
      const messageText = ctx.message?.text?.trim();
      if (!messageText) return;

      try {
        const order = await this.ordersService.findById(writingOrderId);
        if (!order) {
          await ctx.reply('Замовлення не знайдено.');
          (ctx.session as any).adminWritingMessageOrderId = null;
          return;
        }

        const executorId = order.assignment?.executorId;
        if (!executorId) {
          await ctx.reply('Для замовлення не призначено виконавця.');
          (ctx.session as any).adminWritingMessageOrderId = null;
          return;
        }

        // Отримуємо telegramId виконавця
        const executorTelegramId = await this.ordersService.getExecutorTelegramId(executorId) ?? executorId;

        // Отримуємо ім'я адміна
        const admin = await this.adminService.findByTelegramId(adminId);
        const senderName = admin?.firstName || admin?.lastName
          ? `${admin?.lastName ?? ''} ${admin?.firstName ?? ''}`.trim()
          : 'Адміністратор';

        await this.ordersService.sendMessageToExecutorWithButtons(
          executorTelegramId,
          writingOrderId,
          senderName,
          messageText,
        );

        // Clear session state
        (ctx.session as any).adminWritingMessageOrderId = null;
        (ctx.session as any).adminWritingMessageAdminId = null;

        await ctx.reply(
          ExecutorConst.AdminMessageSentToExecutor(writingOrderId),
          { parse_mode: 'HTML' },
        );
      } catch (error) {
        console.error(error);
        await ctx.reply('Помилка надсилання повідомлення виконавцю.');
      }
      return;
    }

    // Legacy: executor clarification comment
    const orderId = (ctx.session as any)?.adminClarifyingOrderId;
    if (!orderId) return;

    const adminId = ctx.from?.id?.toString() ?? '';
    const comment = ctx.message?.text?.trim();
    if (!comment) return;

    try {
      await this.ordersService.clarifyExecutorAssignment(orderId, adminId, comment);

      // Clear session state
      (ctx.session as any).adminClarifyingOrderId = null;

      await ctx.reply(
        `🟡 <b>Запит на уточнення надіслано виконавцю (замовлення №${orderId})</b>\n\nКоментар: ${comment}`,
        { parse_mode: 'HTML' },
      );
    } catch (error) {
      console.error(error);
      await ctx.reply('Помилка надсилання запиту на уточнення.');
    }
  }

}
