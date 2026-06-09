import {Action, Ctx, Start, Update} from "nestjs-telegraf";
import {OrdersService} from "../../orders/orders.service";
import {Context} from "telegraf";

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
      '🛡️ <b>Панель адміністратора ДОГЛЯД+</b>\n\n' +
      'Сюди надходитимуть нові заявки від клієнтів. Ви зможете керувати їхніми статусами за допомогою інлайн-кнопок під картками замовлень.',
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

      const message = ctx.callbackQuery.message;
      const text = `🟢 <b>Заявку №${orderId} ПІДТВЕРДЖЕНО</b>`;

      // 🔥 ФІКС: Перевіряємо, чи є в повідомленні масив фотографій
      if (message && 'photo' in message && message.photo) {
        await ctx.editMessageCaption(text, { parse_mode: 'HTML' });
      } else {
        await ctx.editMessageText(text, { parse_mode: 'HTML' });
      }

      /*// Оновлюємо статус в базі (Parse / Back4app чи PostgreSQL)
      // Наприклад, статус 'confirmed' або 'in_progress'
      await this.ordersService.updateStatus(orderId, OrderStatus.Confirmed);

      // Сповіщаємо АДМІНА, що дія пройшла успішно (оновлюємо текст або плашку)
      ctx.editMessageCaption ?
        await ctx.editMessageCaption(`🟢 <b>Заявку №${orderId} ПІДТВЕРДЖЕНО</b>`, { parse_mode: 'HTML' }) :
        await ctx.editMessageText(`🟢 <b>Заявку №${orderId} ПІДТВЕРДЖЕНО</b>`, { parse_mode: 'HTML' });

      // 🔥 ГОЛОВНЕ: Сповіщаємо КЛІЄНТА через bot.telegram
      await ctx.telegram.sendMessage(
        clientId,
        `🟢 <b>Вашу заявку №${orderId} успішно підтверджено адміністратором!</b>\n` +
        `Ми вже взялися за виконання роботи. Очікуйте на фотозвіт.`,
        { parse_mode: 'HTML' }
      );
*/
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

      const message = ctx.callbackQuery.message;
      const text = `🔴 <b>Заявку №${orderId} ВІДХИЛЕНО</b>`;

      // 🔥 ФІКС: Перевіряємо наявність фото
      if (message && 'photo' in message && message.photo) {
        await ctx.editMessageCaption(text, { parse_mode: 'HTML' });
      } else {
        await ctx.editMessageText(text, { parse_mode: 'HTML' });
      }

      /*ctx.editMessageCaption ?
        await ctx.editMessageCaption(`🔴 <b>Заявку №${orderId} ВІДХИЛЕНО</b>`, { parse_mode: 'HTML' }) :
        await ctx.editMessageText(`🔴 <b>Заявку №${orderId} ВІДХИЛЕНО</b>`, { parse_mode: 'HTML' });

      await ctx.telegram.sendMessage(
        clientId,
        `🔴 <b>На жаль, вашу заявку №${orderId} було відхилено.</b>\n` +
        `Для уточнення деталей або якщо виникла помилка, будь ласка, зв'яжіться з нашою підтримкою або натисніть /help.`,
        { parse_mode: 'HTML' }
      );*/
    } catch (error) {
      console.error(error);
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

      /*ctx.editMessageCaption ?
        await ctx.editMessageCaption(`🟡 <b>Надіслано запит на УТОЧНЕННЯ до заявки №${orderId}</b>`, { parse_mode: 'HTML' }) :
        await ctx.editMessageText(`🟡 <b>Надіслано запит на УТОЧНЕННЯ до заявки №${orderId}</b>`, { parse_mode: 'HTML' });

      await ctx.telegram.sendMessage(
        clientId,
        `🟡 <b>Адміністратор просить уточнити дані щодо заявки №${orderId}.</b>\n\n` +
        `Найближчим часом менеджер зв'яжеться з вами за вказаним номером телефону або безпосередньо в Telegram для узгодження деталей.`,
        { parse_mode: 'HTML' }
      );*/
    } catch (error) {
      console.error(error);
    }
  }

}

