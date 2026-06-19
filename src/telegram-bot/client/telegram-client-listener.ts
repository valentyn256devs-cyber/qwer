import {Action, Command, Ctx, Hears, On, Start, Update} from 'nestjs-telegraf';
import {OrdersService} from '../../orders/orders.service';
import {ServicesService} from '../../services/services.service';
import {Context, Markup} from 'telegraf';
import {type OrderWizardContext} from './interfaces/order-wizard-context.interface';
import {
  getOrderStatusDescription,
  MainMenu,
  mainMenuButtons,
  OrderStepUa,
  Scene,
  showMainMenu
} from "../telegram-constants";
import {BurialsService} from "../../burials/burials.service";
import {ServiceResponseDto} from "../../services/dto/service-response.dto";
import {Message} from "telegraf/types";

@Update()
export class TelegramClientListener {
  constructor(
    private readonly ordersService: OrdersService,
    private readonly servicesService: ServicesService,
    private readonly burialsService: BurialsService,
  ) {
  }

  /**
   * 1. Обробка команди /start (Головне меню клієнта за ТЗ)
   */
  @Start()
  async onStart(@Ctx() ctx: Context) {
    // Головне меню
    await ctx.reply(
      OrderStepUa.Welcome,
      {parse_mode: 'HTML', reply_markup: mainMenuButtons},
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
    const chatId = ctx.chat?.id ?? 0;

    try {
      const services = await this.servicesService.findAll();

      if (services.length === 0) {
        if (loadingMsg) await ctx.telegram.deleteMessage(chatId, loadingMsg.message_id).catch(() => null);
        await ctx.reply('Наразі список послуг порожній.');
        return;
      }

      const btnResponse = await this.prepareServicesButtons(ctx, services, chatId, loadingMsg);

      await ctx.reply(btnResponse.responseText, {
        parse_mode: 'HTML',
        reply_markup: Markup.inlineKeyboard(btnResponse.inlineButtons).reply_markup
      });

      // 1. Формуємо гарне текстове меню з детальним описом
      /*let responseText = OrderStepUa.ServicesCatalog;
      responseText += OrderStepUa.GenerateOrder;

      // Формуємо масив рядків. Кожен рядок містить масив із 2 кнопок
      const inlineButtons = services.map((s, index) => {
        const mainButtonText = `${index + 1}. ${s.name}`;

        // 1. Обрізаємо заголовок, якщо він задовгий
        let finalMainText = mainButtonText.length > 45 ? `${mainButtonText.substring(0, 42)}...` : mainButtonText;

        // 2. ХАК: Добиваємо рядок нерозривними пробілами до фіксованої довжини (наприклад, 45 символів).
        // Це змусить кнопку розтягнутися на всю доступну їй ширину, а текст залишиться ліворуч.
        finalMainText = finalMainText.padEnd(45, '\u00A0');

        return [
          Markup.button.callback(finalMainText, `client_order_service_${s.id}`),
          Markup.button.callback('ℹ️', `client_service_desc_${s.id}`),
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
      });*/
    } catch (error) {
      console.log(error);
      if (loadingMsg) await ctx.telegram.deleteMessage(chatId, loadingMsg.message_id).catch(() => null);
      await ctx.reply(OrderStepUa.ErrorLoadingServices);
    }
  }

  /**
   * Перегляд усіх місць пам'яті (поховань), створених користувачем за Telegram ID
   */
  @Hears(MainMenu.MyBurialsMemorials)
  @Command('my_memorials')
  async onMyMemorials(@Ctx() ctx: Context) {
    const telegramId = ctx.from?.id.toString();
    if (!telegramId) return;

    const loadingMsg = await ctx.reply(
      '⏳ Завантаження...',
      Markup.removeKeyboard()).catch(() => null
    );
    const chatId = ctx.chat?.id ?? '';

    try {
      const burials = await this.burialsService.findByTelegramId(telegramId);
      if (loadingMsg) await ctx.telegram.deleteMessage(chatId, loadingMsg.message_id).catch(() => null);
      await ctx.reply(`🗂 <b>Ваші зареєстровані місця пам'яті:</b>`, {parse_mode: 'HTML'});

      if (burials.length === 0) {
        // Якщо місць немає, пропонуємо створити перше
        await ctx.reply('У вас ще немає доданих місць пам\'яті.', {
          reply_markup: {
            inline_keyboard: [
              [Markup.button.callback('➕ Додати нове місце', 'client_memorial_add')],
              [Markup.button.callback(OrderStepUa.GoBack, 'client_back_to_menu')]
            ]
          }
        });
        return;
      }

      // Виводимо кожне місце окремою карткою (аналогічно до каталогу послуг)
      for (const b of burials) {
        const invisibleSpacer = '<code>👉 Поховання: ' + '━'.repeat(24) + '</code>';

        // 1. Красиво збираємо ПІБ, відсікаючи null значення
        // const fioParts = [b.burialLastName, b.burialName, b.burialFatherName].filter(Boolean);
        // const fullName = fioParts.length > 0 ? fioParts.join(' ') : 'Не вказано';

        const lastName = b.burialLastName?.trim() ? b.burialLastName : 'Не вказано';
        const name = b.burialName?.trim() ? b.burialName : 'Не вказано';
        const father = b.burialFatherName?.trim() ? b.burialFatherName : 'Не вказано';

        // Перевіряємо та форматуємо значення дат (якщо приходить пустий рядок)
        const birth = b.birthDate?.trim() ? b.birthDate : 'Не вказано';
        const death = b.deathDate?.trim() ? b.deathDate : 'Не вказано';
        // Визначаємо локацію: пріоритет на coordinates, потім cemetery
        let location = 'Не вказано';
        if (b.coordinates) {
          location = `\n📍 Координати: <code>${b.coordinates}</code>`;
        } else if (b.cemetery) {
          location = b.cemetery;
        }

        const comment = b.notes?.trim() ? b.notes : '---';

        const cardText =
          `${invisibleSpacer}\n` +
          `🪦 <b>${b.name}</b>\n` +
          `👤 <b>Прізвище:</b> ${lastName}\n` +
          `👤 <b>Ім'я:</b> ${name}\n` +
          `👤 <b>По батькові:</b> ${father}\n` +
          `📅 <b>Дата народження:</b> ${birth}\n` +
          `🕯 <b>Дата смерті:</b> ${death}\n` +
          `📍 <b>Місто/Локація:</b> ${location}\n` +
          `💬 <b>Коментар:</b> ${comment}\n`;

        await ctx.reply(cardText, {
          parse_mode: 'HTML',
          reply_markup: {
            inline_keyboard: [
              [
                Markup.button.callback('🛍 Замовити послугу', `memorial_order_service_${b.id}`),
                Markup.button.callback('✏️ Редагувати', `memorial_edit_${b.id}`)
              ]
            ]
          }
        });
        await new Promise((resolve) => setTimeout(resolve, 150));
      }

      // Нижня панель навігації та додавання
      await ctx.reply('⬇️ Керування списком:', {
        reply_markup: {
          inline_keyboard: [
            [Markup.button.callback('➕ Додати нове місце пам\'яті', 'client_memorial_add')],
            [Markup.button.callback(OrderStepUa.GoBack, 'client_back_to_menu')]
          ]
        }
      });

    } catch (error) {
      console.error(error);
      if (loadingMsg) await ctx.telegram.deleteMessage(chatId, loadingMsg.message_id).catch(() => null);
      await ctx.reply('❌ Помилка завантаження місць пам\'яті.');
      await showMainMenu(ctx);
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
      timeZone: 'Europe/Kyiv',
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
        response += `⚙️ <b>Статус:</b> ${getOrderStatusDescription(o.status)}\n\n`;
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
    await ctx.reply(OrderStepUa.HintAdminFeedbackHelp, {parse_mode: 'HTML'});
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
    await ctx.reply(OrderStepUa.ReturnToMainMenu, {reply_markup: mainMenuButtons});
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
   * Екшен 1: Швидке замовлення послуги прямо з картки конкретного місця
   */
  @Action(/^memorial_order_service_(.+)$/)
  async onMemorialOrderService(@Ctx() ctx: OrderWizardContext) {
    await ctx.telegram.answerCbQuery(ctx.callbackQuery?.id ?? '').catch(() => null);
    // @ts-ignore
    const burialId = ctx.match[1];

    ctx.session.orderForm = {
      burialId: burialId
    };

    try {
      const burial = await this.burialsService.findBurialById(burialId);
      ctx.session.orderForm.burialDisplayName = burial?.name;
      ctx.session.orderForm.burialLastName = burial?.burialLastName ?? undefined;
      ctx.session.orderForm.burialName = burial?.burialName ?? undefined;
      ctx.session.orderForm.burialFatherName = burial?.burialFatherName ?? undefined;
      ctx.session.orderForm.burialBirthDate = burial?.birthDate ?? undefined;
      ctx.session.orderForm.burialDeathDate = burial?.deathDate ?? undefined;

      ctx.session.orderForm.locationData = burial?.coordinates;
      ctx.session.orderForm.customComment = burial?.notes;
      ctx.session.orderForm.cemeteryDetails = burial?.cemetery;
    } catch (e) {
      console.log(e);
    }

    await ctx.reply('⏳ Ініціалізую замовлення для цього місця...', Markup.removeKeyboard());
    // Відправляємо у візард замовлення, де Крок 1 побачить, що burialId вже є, і відправить на вибір послуги
    await ctx.scene.enter(Scene.CREATE_ORDER_WIZARD);
  }

  /**
   * Екшен 2: Редагування існуючого місця пам'яті
   */
  @Action(/^memorial_edit_(.+)$/)
  async onMemorialEdit(@Ctx() ctx: OrderWizardContext) {
    await ctx.telegram.answerCbQuery(ctx.callbackQuery?.id ?? '').catch(() => null);
    // @ts-ignore
    const burialId = ctx.match[1];
    if (!ctx.session.orderForm) {
      ctx.session.orderForm = {};
    }
    // Тут ти будеш викликати сцену редагування, передаючи туди ID:
    ctx.session.orderForm.burialId = burialId;

    // 🔥 ГОЛОВНИЙ ФІКС: Надсилаємо сервісне повідомлення, яке згортає/приховує нижнє меню
    await ctx.reply('⏳ Вхід до режиму редагування...', Markup.removeKeyboard());

    return ctx.scene.enter(Scene.EDIT_BURIAL_WIZARD);
  }

  /**
   * Екшен 3: Додавання нового місця пам'яті з меню списку
   */
  @Action('client_memorial_add')
  async onMemorialAdd(@Ctx() ctx: OrderWizardContext) {
    await ctx.telegram.answerCbQuery(ctx.callbackQuery?.id ?? '').catch(() => null);
    await ctx.reply('⏳ Перехід до створення картки об\'єкта...', Markup.removeKeyboard());
    if (!ctx.session.orderForm) {
      ctx.session.orderForm = {};
    }
    ctx.session.orderForm.addBurialOnly = true;
    // Вхід у твій існуючий візард створення поховання
    await ctx.scene.enter(Scene.CREATE_BURIAL_WIZARD);
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

  private async prepareServicesButtons(
    ctx: Context,
    services: ServiceResponseDto[],
    chatId: number,
    loadingMsg: Message.TextMessage | null
  ) {

    // 1. Формуємо гарне текстове меню з детальним описом
    let responseText = OrderStepUa.ServicesCatalog;
    responseText += OrderStepUa.GenerateOrder;

    // Формуємо масив рядків. Кожен рядок містить масив із 2 кнопок
    const inlineButtons = services.map((s, index) => {
      const mainButtonText = `${index + 1}. ${s.name}`;

      // 1. Обрізаємо заголовок, якщо він задовгий
      let finalMainText = mainButtonText.length > 45 ? `${mainButtonText.substring(0, 42)}...` : mainButtonText;

      // 2. ХАК: Добиваємо рядок нерозривними пробілами до фіксованої довжини (наприклад, 45 символів).
      // Це змусить кнопку розтягнутися на всю доступну їй ширину, а текст залишиться ліворуч.
      finalMainText = finalMainText.padEnd(45, '\u00A0');

      return [
        Markup.button.callback(finalMainText, `client_order_service_${s.id}`),
        Markup.button.callback('ℹ️', `client_service_desc_${s.id}`),
      ];
    });

    // Кнопка повернення назад до головного меню
    inlineButtons.push([
      Markup.button.callback(OrderStepUa.GoBack, 'client_back_to_menu'),
    ]);

    // Видаляємо плашку завантаження перед відправкою каталогу
    if (loadingMsg) await ctx.telegram.deleteMessage(chatId, loadingMsg.message_id).catch(() => null);

    return {
      responseText,
      inlineButtons
    }
  }

}
