import {Command, Ctx, Hears, On, Start, Update} from 'nestjs-telegraf';
import { OrdersService } from '../../orders/orders.service';
import { ServicesService } from '../../services/services.service';
import {Context, Markup} from 'telegraf';
import { type OrderWizardContext } from './interfaces/order-wizard-context.interface';

@Update()
export class TelegramClientListener {
  constructor(
    private readonly ordersService: OrdersService,
    private readonly servicesService: ServicesService,
  ) {}

  /**
   * 1. Обробка команди /start (Головне меню клієнта за ТЗ)
   */
  @Start()
  async onStart(@Ctx() ctx: Context) {
    // Головне меню
    const mainMenu = Markup.keyboard([
      ['✨ Створити замовлення'],
      ['🗂 Мої замовлення', 'ℹ️ Допомога'],
    ]).resize();

    await ctx.reply(
      'Вітаємо у сервісі <b>ДОГЛЯД+</b> 🕊\nМи допоможемо дистанційно піклуватися про місця пам’яті.',
      { parse_mode: 'HTML', reply_markup: mainMenu.reply_markup },
    );
  }

  /**
   * Слухаємо кнопку ТЗ "Створити замовлення" -> Входимо в Сцену-Вайзард
   */
  @Hears('✨ Створити замовлення')
  @Command('create_order')
  async onCreateOrder(@Ctx() ctx: OrderWizardContext) {
    ctx.session.orderForm = {};

    // 🔥 ГОЛОВНИЙ ФІКС: Надсилаємо невидиме повідомлення про вхід, яке згортає меню
    await ctx.reply('⏳ Ініціалізую оформлення замовлення...', Markup.removeKeyboard());

    // Входимо в раніше створену нами покрокову сцену
    await ctx.scene.enter('CREATE_ORDER_WIZARD');
  }

  /**
   * 2. Команда перегляду послуг (Витягує дані з нашого ServicesService без any)
   */
  @Command('services')
  async onServicesCommand(@Ctx() ctx: Context) {
    await ctx.reply('🔄 Завантажую список актуальних послуг...');

    try {
      const services = await this.servicesService.findAll();

      if (services.length === 0) {
        await ctx.reply('Наразі список послуг порожній.');
        return;
      }

      let responseText = '📋 <b>Доступні послуги сервісу ДОГЛЯД+:</b>\n\n';
      services.forEach((s, index) => {
        responseText += `${index + 1}. <b>${s.name}</b>\n💰 Ціна: ${s.price} грн\n📝 Опис: ${s.description}\n\n`;
      });

      // await ctx.replyWithMarkdownV2(responseText);
      await ctx.reply(responseText, { parse_mode: 'HTML' });
    } catch (error) {
      console.log(error);
      await ctx.reply(
        'Сталася помилка при отриманні списку послуг. Спробуйте пізніше.',
      );
    }
  }

  /**
   * 3. Перегляд статусів своїх замовлень за Telegram ID
   * Слухаємо кнопку ТЗ "Мої замовлення"
   */
  @Hears('🗂 Мої замовлення')
  @Command('my_orders')
  async onMyOrders(@Ctx() ctx: Context) {
    const telegramId = ctx.from?.id.toString();
    if (!telegramId) return;

    const orders = await this.ordersService.findByTelegramId(telegramId);
    if (orders.length === 0) {
      await ctx.reply('У вас ще немає створених замовлень.');
      return;
    }

    let response = '<b>Ваші замовлення:</b>\n\n';
    orders.forEach((o) => {
      response += `🔹 <b>Заявка №${o.id}</b>\nСтатус: ${o.status}\nПослуга: ${o.service?.name ?? 'Кастомна'}\n\n`;
    });

    await ctx.reply(response, { parse_mode: 'HTML' });
  }

  /**
   * Слухаємо кнопку ТЗ "Допомога"
   */
  @Hears('ℹ️ Допомога')
  @Command('help')
  async onHelp(@Ctx() ctx: Context) {
    await ctx.reply(
      '🕊 <b>Сервіс ДОГЛЯД+</b>\n\n' +
        'Якщо у вас виникли запитання, чи вам потрібна кастомна послуга, якої немає в переліку, ' +
        'зв’яжіться з нашим адміністратором: @admin_username',
      { parse_mode: 'HTML' },
    );
  }

  /**
   * 4. Слухач усіх інших текстових повідомлень (Логіка "Слухати все" по ТЗ)
   */
  @On('text')
  async onTextMessage(@Ctx() ctx: Context) {
    // eslint-disable-next-line @typescript-eslint/ban-ts-comment
    // @ts-ignore (Безпечний ігнор динамічного тексту повідомлення для Telegraf)
    const text = ctx.message?.text as string;

    // Тут можна реалізувати текстову аналітику, роботу з кроками створення заявки (State Machine),
    // або автоматичну відповідь менеджера, якщо це не команда.
    await ctx.reply(
      `Отримано повідомлення: "${text}".\n` +
        `Якщо ви хочете подати заявку або дізнатися статус, використовуйте меню команд (натисніть /start).`,
    );
  }

  /**
   * Допоміжний метод для красивого виведення статусів клієнту
   */
  /*private getStatusEmoji(status: OrderStatus): string {
    switch (status) {
      case OrderStatus.New:
        return '🆕';
      case OrderStatus.InProgress:
        return '🛠';
      case OrderStatus.AwaitingConfirmation:
        return '👀';
      case OrderStatus.Done:
        return '✅';
      case OrderStatus.Canceled:
        return '❌';
      default:
        return '📄';
    }
  }*/
}
