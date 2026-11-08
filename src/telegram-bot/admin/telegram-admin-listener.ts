import {Action, Ctx, Start, Update} from "nestjs-telegraf";
import {OrdersService} from "../../orders/orders.service";
import {Context, Markup} from "telegraf";
import {OrderStepUa} from "../telegram-constants";
import {UnassignReason} from "../../orders/models/order-status";

@Update()
export class TelegramAdminListener {
  constructor(
    private readonly ordersService: OrdersService,
  ) {}
  /**
   * 👑 Обробка команди /start для Адмін-бота
   */
  @Start()
  async onStart(@Ctx() ctx: Context) {
    await ctx.reply(
      OrderStepUa.AdminWelcome + OrderStepUa.AdminWelcomeDescription,
      { parse_mode: 'HTML' }
    );
  }

  // 1. Обробка кнопки "Підтвердити"
  @Action(/^admin_confirm_(.+)_(.+)$/)
  async handleAdminConfirm(@Ctx() ctx: Context) {
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
    } catch (error) {
      console.error(error);
      await ctx.answerCbQuery('Помилка оновлення статусу.');
    }
  }

  // 2. Обробка кнопки "Відхилити"
  @Action(/^admin_reject_(.+)_(.+)$/)
  async handleAdminReject(@Ctx() ctx: Context) {
    if (!ctx.has('callback_query') || !('data' in ctx.callbackQuery)) return;
    const [, orderId, clientId] = ctx.callbackQuery.data.match(/^admin_reject_(.+)_(.+)$/) || [];

    try {
      await this.ordersService.rejectAndNotify(orderId, clientId);

      // Передаємо порожній inlineKeyboard, щоб кнопки миттєво зникли
      await ctx.editMessageReplyMarkup({ inline_keyboard: [] }).catch(() => null);

      const message = ctx.callbackQuery.message;
      const text = `🔴 <b>Заявку №${orderId} ВІДХИЛЕНО</b>`;

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

  // 3. Обробка кнопки "Уточнити"
  @Action(/^admin_clarify_(.+)_(.+)$/)
  async handleAdminClarify(@Ctx() ctx: Context) {
    if (!ctx.has('callback_query') || !('data' in ctx.callbackQuery)) return;
    const [, orderId, clientId] = ctx.callbackQuery.data.match(/^admin_clarify_(.+)_(.+)$/) || [];

    try {
      await this.ordersService.clarifyAndNotify(orderId, clientId);

      const message = ctx.callbackQuery.message;
      const text = `🟡 <b>Надіслано запит на УТОЧНЕННЯ до заявки №${orderId}</b>`;

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

  // 4. Обробка кнопки "Надіслати на ревізію"
  @Action(/^admin_revision_(.+)$/)
  async handleAdminRevision(@Ctx() ctx: Context) {
    if (!ctx.has('callback_query') || !('data' in ctx.callbackQuery)) return;
    const orderId = ctx.callbackQuery.data.replace('admin_revision_', '');

    try {
      const adminId = ctx.from?.id.toString() ?? '';
      await this.ordersService.revisionRequired(orderId, adminId, 'Замовлення потребує ревізії');

      await ctx.editMessageReplyMarkup({ inline_keyboard: [] }).catch(() => null);
      const message = ctx.callbackQuery.message;
      const text = `🔄 <b>Заявку №${orderId} НАДІСЛАНО НА РЕВІЗІЮ</b>`;

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

  // 5. Обробка кнопки "Схвалити"
  @Action(/^admin_approve_(.+)$/)
  async handleAdminApprove(@Ctx() ctx: Context) {
    if (!ctx.has('callback_query') || !('data' in ctx.callbackQuery)) return;
    const orderId = ctx.callbackQuery.data.replace('admin_approve_', '');

    try {
      const adminId = ctx.from?.id.toString() ?? '';
      await this.ordersService.approveCompletion(orderId, adminId);
      await this.ordersService.sendClientReport(orderId);

      await ctx.editMessageReplyMarkup({ inline_keyboard: [] }).catch(() => null);
      const message = ctx.callbackQuery.message;
      const text = `✅ <b>Заявку №${orderId} СХВАЛЕНО</b>`;

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

  // 6. Unassign Executor - show reason selection
  @Action(/^admin_unassign_(.+)$/)
  async handleAdminUnassign(@Ctx() ctx: Context) {
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

  // 7. Unassign Executor - confirm with reason
  @Action(/^admin_unassign_reason_(.+)_(.+)$/)
  async handleAdminUnassignReason(@Ctx() ctx: Context) {
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

  // 8. Change Executor
  @Action(/^admin_change_executor_(.+)$/)
  async handleAdminChangeExecutor(@Ctx() ctx: Context) {
    if (!ctx.has('callback_query') || !('data' in ctx.callbackQuery)) return;
    const orderId = ctx.callbackQuery.data.replace('admin_change_executor_', '');

    await ctx.reply(
      `🔄 <b>Зміна виконавця для заявки №${orderId}</b>\n\n` +
      `Надішліть ID нового виконавця.`,
      { parse_mode: 'HTML' }
    );
    await ctx.answerCbQuery('Введіть ID нового виконавця');
  }

  // 9. Take Over - admin becomes executor
  @Action(/^admin_take_over_(.+)$/)
  async handleAdminTakeOver(@Ctx() ctx: Context) {
    if (!ctx.has('callback_query') || !('data' in ctx.callbackQuery)) return;
    const orderId = ctx.callbackQuery.data.replace('admin_take_over_', '');

    try {
      const adminId = ctx.from?.id.toString() ?? '';
      await this.ordersService.takeOverExecutor(orderId, adminId);

      await ctx.editMessageReplyMarkup({ inline_keyboard: [] }).catch(() => null);
      const message = ctx.callbackQuery.message;
      const text = `👑 <b>Ви взяли замовлення №${orderId} на себе як виконавець</b>`;

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

}

