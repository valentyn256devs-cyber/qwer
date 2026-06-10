import {Action, Command, Ctx, Hears, On, Start, Update} from 'nestjs-telegraf';
import { OrdersService } from '../../orders/orders.service';
import { ServicesService } from '../../services/services.service';
import {Context, Markup} from 'telegraf';
import { type OrderWizardContext } from './interfaces/order-wizard-context.interface';
import {MainMenu, OrderStepUa, Scene} from "../telegram-constants";

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
      [MainMenu.Services],
      [MainMenu.CreateOrder],
      [MainMenu.MyOrders, MainMenu.Help],
    ]).resize();

    await ctx.reply(
      OrderStepUa.Welcome,
      { parse_mode: 'HTML', reply_markup: mainMenu.reply_markup },
    );
  }

  /**
   * Слухаємо кнопку ТЗ "Створити замовлення" -> Входимо в Сцену-Вайзард
   */
  @Hears(MainMenu.CreateOrder)
  @Command('create_order')
  async onCreateOrder(@Ctx() ctx: OrderWizardContext) {
    ctx.session.orderForm = {};

    // 🔥 ГОЛОВНИЙ ФІКС: Надсилаємо невидиме повідомлення про вхід, яке згортає меню
    await ctx.reply(OrderStepUa.InitOrder, Markup.removeKeyboard());

    // Входимо в раніше створену нами покрокову сцену
    await ctx.scene.enter(Scene.CREATE_ORDER_WIZARD);
  }

  /**
   * 2. Команда перегляду послуг (Витягує дані з нашого ServicesService без any)
   */
  @Hears(MainMenu.Services)
  @Command('services')
  async onServicesCommand(@Ctx() ctx: Context) {
    const loadingMsg = await ctx.reply(OrderStepUa.LoadingServices).catch(() => null);
    const chatId = ctx.chat?.id ?? '';

    try {
      const services = await this.servicesService.findAll();

      if (services.length === 0) {
        if (loadingMsg) await ctx.telegram.deleteMessage(chatId, loadingMsg.message_id).catch(() => null);
        await ctx.reply('Наразі список послуг порожній.');
        return;
      }

      // 1. Формуємо гарне текстове меню з детальним описом
      let responseText = OrderStepUa.ServicesCatalog;
      responseText += OrderStepUa.GenerateOrder;

      const inlineButtons = services.map((s, index) => {
        // Формат: "1. Тест (200 грн)"
        // const shortDesc = s.description ? s.description.replace(/<\/?[^>]+(>|$)/g, "") : 'Опис відсутній';
        const buttonText = `${index + 1}. ${s.name} (${s.price} грн)`;

        // Обрізаємо текст кнопки, якщо він перевищує 64 символи (ліміт Telegram для гарного відображення на мобільних)
        const finalText = buttonText.length > 60 ? `${buttonText.substring(0, 57)}...` : buttonText;
        return [
          Markup.button.callback(finalText, `client_order_service_${s.id}`),
        ];
      });

      // Кнопка повернення назад до головного меню
      inlineButtons.push([
        Markup.button.callback(OrderStepUa.GoBack, 'client_back_to_menu'),
      ]);

      // Видаляємо плашку завантаження перед відправкою каталогу
      if (loadingMsg) await ctx.telegram.deleteMessage(chatId, loadingMsg.message_id).catch(() => null);

      await ctx.reply(responseText, {
        parse_mode: 'HTML',
        reply_markup: Markup.inlineKeyboard(inlineButtons).reply_markup
      });
    } catch (error) {
      console.log(error);
      if (loadingMsg) await ctx.telegram.deleteMessage(chatId, loadingMsg.message_id).catch(() => null);
      await ctx.reply(OrderStepUa.ErrorLoadingServices);
    }
  }

  /**
   * 3. Перегляд статусів своїх замовлень за Telegram ID
   * Слухаємо кнопку ТЗ "Мої замовлення"
   */
  @Hears(MainMenu.MyOrders)
  @Command('my_orders')
  async onMyOrders(@Ctx() ctx: Context) {
    const telegramId = ctx.from?.id.toString();
    if (!telegramId) return;

    const orders = await this.ordersService.findByTelegramId(telegramId);
    if (orders.length === 0) {
      await ctx.reply(OrderStepUa.EmptyServices);
      return;
    }

    let response = OrderStepUa.YourOrders;
    orders.forEach((o) => {
      response += `🔹 <b>Заявка №${o.id}</b>\nСтатус: ${o.status}\nПослуга: ${o.service?.name ?? 'Кастомна'}\n\n`;
    });

    await ctx.reply(response, { parse_mode: 'HTML' });
  }

  /**
   * Слухаємо кнопку ТЗ "Допомога"
   */
  @Hears(MainMenu.Help)
  @Command('help')
  async onHelp(@Ctx() ctx: Context) {
    await ctx.reply(OrderStepUa.HintAdminFeedbackHelp, { parse_mode: 'HTML' });
  }

  /**
   * Обробка кліку по будь-якій кнопці послуги з каталогу
   */
  @Action(/^client_order_service_(.+)$/)
  async onClientOrderServiceClick(@Ctx() ctx: OrderWizardContext) {
    // 1. Обов'язково знімаємо "годинничок" (анімацію завантаження) з інлайн-кнопки
    await ctx.telegram.answerCbQuery(ctx.callbackQuery?.id ?? '').catch(() => null);

    // 2. Витягуємо унікальний ID послуги з регулярного виразу (це перша група захвату (.+))
    // @ts-ignore (ігноруємо динамічний match для Telegraf)
    const serviceId = ctx.match[1];

    // 3. Ініціалізуємо об'єкт форми у сесії та записуємо туди ID обраної послуги
    ctx.session.orderForm = {
      serviceId: serviceId,
    };

    // 4. (Опціонально) Підтягуємо назву послуги з бази, щоб у майбутньому резюме замовлення виглядало гарно
    try {
      const service = await this.servicesService.findOne(serviceId);
      ctx.session.orderForm.serviceName = service.name;
    } catch (e) {
      ctx.session.orderForm.serviceName = 'Обрана послуга';
    }

    // 5. Ховаємо нижню Reply-клавіатуру головного меню, щоб вона не заважала проходити візард
    await ctx.reply('⏳ Ініціалізую швидке замовлення послуги...', Markup.removeKeyboard());

    // 6. Спрямовуємо користувача у твій візард замовлення
    await ctx.scene.enter(Scene.CREATE_ORDER_WIZARD);
  }

  /**
   * Обробка кліку на кнопку "Повернутися назад"
   */
  @Action('client_back_to_menu')
  async onBackToMenuClick(@Ctx() ctx: Context) {
    const id = ctx.callbackQuery?.id ?? ''
    await ctx.telegram.answerCbQuery(id);

    // Видаляємо інлайн-кнопки або старе повідомлення, щоб не засмічувати чат
    await ctx.deleteMessage().catch(() => null);

    const mainMenu = Markup.keyboard([
      [MainMenu.Services],
      [MainMenu.CreateOrder],
      [MainMenu.MyOrders, MainMenu.Help],
    ]).resize().reply_markup;

    await ctx.reply('Повертаємось до головного меню:', { reply_markup: mainMenu });
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
      OrderStepUa.GetMessage + ` "${text}".\n` + OrderStepUa.HintHelp,
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
