import {Action, Command, Ctx, Hears, On, Start, Update} from 'nestjs-telegraf';
import { OrdersService } from '../../orders/orders.service';
import { ServicesService } from '../../services/services.service';
import {Context, Markup} from 'telegraf';
import { type OrderWizardContext } from './interfaces/order-wizard-context.interface';
import {MainMenu, mainMenuButtons, OrderStepUa, Scene} from "../telegram-constants";
import {BurialsService} from "../../burials/burials.service";

@Update()
export class TelegramClientListener {
  constructor(
    private readonly ordersService: OrdersService,
    private readonly servicesService: ServicesService,
    private readonly burialsService: BurialsService,
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

      /*const inlineButtons = services.map((s, index) => {
        // Формат: "1. Тест (200 грн)"
        const shortDesc = s.description ? s.description.replace(/<\/?[^>]+(>|$)/g, "") : 'Опис відсутній';
        const buttonText = `${index + 1}. ${s.name} (${s.price} грн) - ${shortDesc}`;

        // Обрізаємо текст кнопки, якщо він перевищує 64 символи (ліміт Telegram для гарного відображення на мобільних)
        const finalText = buttonText.length > 60 ? `${buttonText.substring(0, 57)}...` : buttonText;
        return [
          Markup.button.callback(finalText, `client_order_service_${s.id}`),
        ];
      });*/

      // Формуємо масив рядків. Кожен рядок містить масив із 2 кнопок
      const inlineButtons = services.map((s, index) => {
        // Кнопка А: Назва + Ціна
        const mainButtonText = `${index + 1}. ${s.name}`;
        // const mainButtonText = `${index + 1}. ${s.name} (${s.price} грн)`;
        // Обрізаємо заголовок, якщо він раптом задовгий для однієї з двох кнопок (до 40 символів)
        const finalMainText = mainButtonText.length > 60 ? `${mainButtonText.substring(0, 57)}...` : mainButtonText;

        return [
          Markup.button.callback(finalMainText, `client_order_service_${s.id}`), // Твоя логіка замовлення
          Markup.button.callback('ℹ️', `client_service_desc_${s.id}`),     // Нова кнопка опису
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

    // Форматер для гарного відображення дати
    const dateFormatter = new Intl.DateTimeFormat('uk-UA', {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });

    const CHUNK_SIZE = 5; // Розмір однієї пачки

    // Ділимо масив orders на пачки по 5 штук
    for (let i = 0; i < orders.length; i += CHUNK_SIZE) {
      const chunk = orders.slice(i, i + CHUNK_SIZE);

      // Розраховуємо номери замовлень для заголовка (наприклад, "1-5 із 12")
      const fromIndex = i + 1;
      const toIndex = Math.min(i + CHUNK_SIZE, orders.length);

      let response = `<b>🗂 ${OrderStepUa.YourOrders} (Записи ${fromIndex}–${toIndex} із ${orders.length}):</b>\n\n`;

      for (const o of chunk) {
        // Форматуємо дату з Parse / Prisma, якщо вона є
        const dateStr = o.createdAt ? dateFormatter.format(new Date(o.createdAt)) : 'Невідомо';
        const burialRec = await this.burialsService.findBurialById(o.details.burialId);
        const burialPlaceName = burialRec?.name || 'Не вказано';

        response += `🔹 <b>Заявка №${o.id}</b>\n`;
        response += `📅 <b>Створено:</b> <code>${dateStr}</code>\n`;
        response += `🪦 <b>Місце пам'яті:</b> ${burialPlaceName}\n`;
        response += `📦 <b>Послуга:</b> ${o.service?.name ?? 'Індивідуальна'}\n`;
        response += `⚙️ <b>Статус:</b> ${o.status}\n\n`;
      }

      // Відправляємо кожну пачку окремим повідомленням
      await ctx.reply(response, {parse_mode: 'HTML'});

      // Невеличка штучна затримка між повідомленнями (опціонально),
      // щоб Telegram не заблокував за спам флуд-контролем, якщо пачок дуже багато
      if (orders.length > CHUNK_SIZE) {
        await new Promise((resolve) => setTimeout(resolve, 300));
      }
    }
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
    await ctx.reply(OrderStepUa.ReturnToMainMenu, { reply_markup: mainMenuButtons });
  }

  @Action(/^client_service_desc_(.+)$/)
  async onServiceDescription(@Ctx() ctx: Context & { match: RegExpExecArray }) {
    const callbackQuery = ctx.callbackQuery;
    if (!callbackQuery) return;

    try {
      const serviceId = ctx.match ? ctx.match[1] : null;

      if (!serviceId) {
        return await ctx.answerCbQuery(OrderStepUa.ErrorLoadDescription);
      }

      const service = await this.servicesService.findOne(serviceId).catch(() => null);

      if (!service || !service.description) {
        return await ctx.answerCbQuery(OrderStepUa.NotFoundDescription);
      }

      // Гасимо годинничок на кнопці
      await ctx.answerCbQuery().catch(() => null);

      // Очищаємо опис від брудних HTML-тегів, але залишаємо базові для гарного оформлення повідомлення
      const cleanDesc = service.description.replace(/<\/?[^>]+(>|$)/g, "");

      // Формуємо красивий детальний текст (тут ліміт до 4096 символів!)
      const descriptionText =
        `<b>🪦 Детальний опис послуги: ${service.name}</b>\n\n` +
        `💰 <b>Вартість:</b> <code>${service.price} грн</code>\n\n` +
        `📝 <b>Про послугу:</b>\n<i>${cleanDesc}</i>`;

      // Редагуємо поточну картку, замінюючи її на текст опису та кнопку повернення
      await ctx.editMessageText(descriptionText, {
        parse_mode: 'HTML',
        reply_markup: {
          inline_keyboard: [
            [
              // Кнопка замовлення залишається, якщо юзер прочитав і захотів купити
              Markup.button.callback(OrderStepUa.Order, `client_order_service_${service.id}`),
              // Кнопка повернення назад, яка знову викличе твій метод findAll()
              Markup.button.callback(OrderStepUa.BackToList, 'client_refresh_services_list')
            ]
          ]
        }
      });

    } catch (error) {
      console.error('Помилка при показі опису послуги:', error);
      await ctx.answerCbQuery(OrderStepUa.ErrorTryLater).catch(() => null);
    }
  }

  @Action('client_refresh_services_list')
  async onRefreshServicesList(@Ctx() ctx: Context) {
    try {
      // 1. Гасимо годинничок Telegram на кнопці
      await ctx.answerCbQuery().catch(() => null);
      // 2. Видаляємо поточне повідомлення з детальним описом послуги
      await ctx.deleteMessage().catch(() => null);

      // 3. Перевикликаємо твій основний метод виведення каталогу послуг
      // Бот знову завантажить сервіси з бази й виведе їх рівними картками
      return await this.onServicesCommand(ctx);
    } catch (error) {
      console.error(OrderStepUa.ErrorReturnToServices, error);
    }
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
