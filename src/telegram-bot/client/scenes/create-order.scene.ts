import {Context as Ctx, InjectBot, Wizard, WizardStep} from 'nestjs-telegraf';
import {Context, Markup, Telegraf} from 'telegraf';
import {ServicesService} from '../../../services/services.service';
import {OrdersService} from '../../../orders/orders.service';
import {OrderForm, type OrderWizardContext} from '../interfaces/order-wizard-context.interface';
import {TelegramBot} from "../../telegram-constants";

@Wizard('CREATE_ORDER_WIZARD')
export class CreateOrderScene {
  constructor(
    private readonly ordersService: OrdersService,
    private readonly servicesService: ServicesService,
    @InjectBot(TelegramBot.AdminBot)
    private readonly adminBot: Telegraf<Context>,
  ) {
  }

  /**
   * КРОК 1: Вибір типу послуги
   */
  @WizardStep(1)
  async stepStart(@Ctx() ctx: OrderWizardContext) {
    if (!ctx.session.orderForm) {
      ctx.session.orderForm = {};
    }

    // 🔥 Якщо користувач повернувся зі створеним похованням
    if (ctx.session.pendingBurial) {
      ctx.session.orderForm.burialId = ctx.session.pendingBurial?.id;
      ctx.session.orderForm.burialDisplayName = ctx.session.pendingBurial?.displayName;

      delete ctx.session.pendingBurial;

      ctx.wizard.selectStep(3);
      // 2. Викликаємо метод Кроку 2 напряму, щоб юзер не чекав наступного повідомлення
      return this.stepChooseLocation(ctx);
    }

    await ctx.reply('🔄 Завантажую доступні послуги...');
    try {
      const services = await this.servicesService.findAll();
      if (services.length === 0) {
        await ctx.reply('Наразі немає доступних послуг. Спробуйте пізніше.');
        await ctx.scene.leave();
        return;
      }

      // Створюємо інлайн-кнопки з послугами з бази Back4app
      const buttons = services.map((s) => [
        Markup.button.callback(`${s.name} (${s.price} грн)`, `service_${s.id}`),
      ]);

      await ctx.reply('<b>Крок 1. Оберіть тип послуги:</b>', {
        parse_mode: 'HTML',
        reply_markup: Markup.inlineKeyboard(buttons).reply_markup,
      });

      ctx.wizard.next();
    } catch (error) {
      console.log(error);
      await ctx.reply('Помилка завантаження послуг.');
      return ctx.scene.leave();
    }
  }

  @WizardStep(2)
  async stepAddBurial(@Ctx() ctx: OrderWizardContext) {
    const callbackQuery = ctx.callbackQuery;
    if (callbackQuery && 'data' in callbackQuery) {
      const callbackData = callbackQuery.data;

      if (callbackData.startsWith('service_')) {
        const [, serviceId] = callbackData.split('_');

        if (!ctx.session.orderForm) {
          ctx.session.orderForm = {};
        }

        try {
          const service = await this.servicesService.findOne(serviceId);
          ctx.session.orderForm.serviceId = serviceId;
          ctx.session.orderForm.serviceName = service.name;
        } catch (e) {
          ctx.session.orderForm.serviceId = serviceId;
          ctx.session.orderForm.serviceName = 'Послуга';
        }

        await ctx.telegram.answerCbQuery(callbackQuery.id);

        // 🔥 ПЕРЕХІД: Одразу викликаємо інший візард
        await ctx.reply('Зараз необхідно заповнити картку поховання (ПІБ, дати тощо)...');
        return ctx.scene.enter('CREATE_BURIAL_WIZARD');
      }
    }

    if (!ctx.session.orderForm?.serviceId) {
      await ctx.reply('Будь ласка, оберіть послугу зі списку вище, натиснувши на кнопку.');
      return;
    }
  }

  /**
   * КРОК 2: Обробка вибору послуги та вибір варіанту локації
   */
  @WizardStep(3)
  async stepChooseLocation(@Ctx() ctx: OrderWizardContext) {
    if (!ctx.session.orderForm) {
      ctx.session.orderForm = {};
    }

    // 1. Отримуємо об'єкт callbackQuery
    // const callbackQuery = ctx.callbackQuery;

    // 2. Перевіряємо за допомогою оператора 'in', чи є в ньому дані (data)
    /*if (callbackQuery && 'data' in callbackQuery) {
      const callbackData = callbackQuery.data;

      if (callbackData.startsWith('service_')) {
        const [, serviceId] = callbackData.split('_');
        try {
          const service = await this.servicesService.findOne(serviceId);

          ctx.session.orderForm.serviceId = serviceId;
          ctx.session.orderForm.serviceName = service.name;
        } catch (e) {
          console.log(e);
          ctx.session.orderForm.serviceId = serviceId;
          ctx.session.orderForm.serviceName = 'Послуга';
        }
        // Передаємо ID запиту, щоб зняти "зависання" (годинничок) з інлайн-кнопки.
        await ctx.telegram.answerCbQuery(callbackQuery.id);
      }
    }*/

    // Якщо користувач щойно прийшов зі створення послуги через callback
    const callbackQuery = ctx.callbackQuery;
    if (callbackQuery && 'data' in callbackQuery) {
      await ctx.telegram.answerCbQuery(callbackQuery.id);
    }

    // 3. Якщо користувач чомусь не обрав послугу, а просто надіслав текст
    if (!ctx.session.orderForm?.serviceId) {
      await ctx.reply('Будь ласка, оберіть послугу зі списку вище, натиснувши на кнопку.');
      return; // Залишаємо користувача на цьому ж кроці
    }

    // 4. Виводимо клавіатуру вибору локації за ТЗ
    await ctx.reply('<b>Крок 2. Як ви хочете вказати місце поховання?</b>', {
      parse_mode: 'HTML',
      reply_markup: Markup.keyboard([
        ['📍 Геолокація Telegram', '🔗 Посилання Google Maps'],
        ['✍️ Текстовий опис', '🏛 Область / Населений пункт'],
      ])
        .oneTime()
        .resize().reply_markup,
    });

    // Переходимо до наступного кроку візарда
    // ctx.wizard.next();
    ctx.wizard.selectStep(3);
  }

  /**
   * КРОК 3: Очікування вибору варіанту і підказка як ввести дані
   */
  @WizardStep(4)
  async stepGeoLocation(@Ctx() ctx: OrderWizardContext) {
    // eslint-disable-next-line @typescript-eslint/ban-ts-comment
    // @ts-ignore
    const text = ctx.message && 'text' in ctx.message ? ctx.message.text : undefined;

    // Якщо користувач прислав не текст, або текст не з кнопок меню
    const validButtons = [
      '📍 Геолокація Telegram',
      '🔗 Посилання Google Maps',
      '✍️ Текстовий опис',
      '🏛 Область / Населений пункт'
    ];

    if (!text || !validButtons.includes(text)) {
      await ctx.reply('Будь ласка, оберіть один з варіантів на клавіатурі меню.');
      return; // 🛑 ЗУПИНЯЄМО ФЛОУ. Користувач залишається на цьому кроці, поки не натисне кнопку.
    }

    if (!ctx.session.orderForm) {
      ctx.session.orderForm = {};
    }

    if (text === '📍 Геолокація Telegram') {
      ctx.session.orderForm.locationType = 'coordinates';
      await ctx.reply(
        'Надішліть, будь ласка, локацію (кнопка Скріпка -> Локація):',
        Markup.keyboard([
          [Markup.button.locationRequest('Надіслати мою поточну геолокацію')],
        ]).resize(),
      );
    } else if (text === '🔗 Посилання Google Maps') {
      ctx.session.orderForm.locationType = 'google_maps';
      await ctx.reply(
        '✍️ <b>Надішліть посилання на Google Maps:</b>',
        { parse_mode: 'HTML', reply_markup: Markup.removeKeyboard().reply_markup }
      );
    } else {
      ctx.session.orderForm.locationType = 'address_text';
      await ctx.reply(
        '✍️ <b>Введіть повний опис місця</b> (Область, Населений пункт, Цвинтар, Сектор/Ряд/Номер):',
        { parse_mode: 'HTML', reply_markup: Markup.removeKeyboard().reply_markup }
      );
    }
    ctx.wizard.next();
  }

  /**
   * КРОК 4: Запис локації та перехід до Опису завдання / Коментаря
   */
  @WizardStep(5)
  async stepCoordinates(@Ctx() ctx: OrderWizardContext) {
    const msg = ctx.message;

    if (!ctx.session.orderForm) {
      ctx.session.orderForm = {};
    }

    // 1. Перевіряємо, чи взагалі існує об'єкт повідомлення
    if (!msg) {
      await ctx.reply('Будь ласка, надішліть коректні дані локації.');
      return; // Залишаємо користувача на цьому ж кроці
    }

    // 2. Безпечно перевіряємо наявність геолокації (Варіант 2 з ТЗ)
    if (ctx.session.orderForm.locationType === 'coordinates' && 'location' in msg) {
      ctx.session.orderForm.locationData = `${msg.location.latitude},${msg.location.longitude}`;
    }
    // 3. Безпечно перевіряємо наявність тексту (Варіанти 1, 3, 4 з ТЗ)
    else if ('text' in msg && msg.text) {
      ctx.session.orderForm.locationData = msg.text;
    }
    // 4. Якщо прийшов не той тип даних (наприклад, користувач замість локації скинув стікер)
    else {
      await ctx.reply(
        'Некоректний формат. Будь ласка, надішліть локацію або текст.',
      );
      return;
    }

    // 5. Переходимо до наступного кроку за ТЗ
    await ctx.reply(
      '<b>Крок 4. Додайте опис завдання</b> (напишіть текст коментаря або побажань):',
      {
        parse_mode: 'HTML',
        reply_markup: Markup.removeKeyboard().reply_markup,
      },
    );

    ctx.wizard.next();
  }

  /**
   * КРОК 5: Контактні дані (Ім'я, телефон)
   */
  @WizardStep(6)
  async stepContacts(@Ctx() ctx: OrderWizardContext) {
    if (!ctx.session.orderForm) {
      ctx.session.orderForm = {};
    }

    if (ctx.message && 'text' in ctx.message) {
      ctx.session.orderForm.customComment = ctx.message.text;
    }

    // За замовчуванням беремо ім'я з телеграму
    ctx.session.orderForm.clientName = ctx.from?.first_name ?? 'Клієнт';

    await ctx.reply('<b>Крок 5. Поділіться контактом</b> для зв’язку з вами:', {
      parse_mode: 'HTML',
      reply_markup: Markup.keyboard([
        [Markup.button.contactRequest('📱 Поділитися номером телефону')],
      ]).resize().reply_markup,
    });
    ctx.wizard.next();
  }

  /**
   * КРОК 6: Підтвердження заявки
   */
  @WizardStep(7)
  async stepPhone(@Ctx() ctx: OrderWizardContext) {
    const msg = ctx.message;

    if (!ctx.session.orderForm) {
      ctx.session.orderForm = {};
    }

    // 1. Перевіряємо, чи взагалі існує об'єкт повідомлення
    if (!msg) {
      await ctx.reply(
        'Будь ласка, натисніть кнопку або введіть номер телефону вручну.',
      );
      return;
    }

    // 2. Безпечно перевіряємо, чи це повідомлення з контактом (кнопка "Поділитися номером")
    if ('contact' in msg) {
      ctx.session.orderForm.clientPhone = msg.contact.phone_number;
    }
    // 3. Безпечно перевіряємо, чи користувач ввів телефон текстом вручну
    else if ('text' in msg && msg.text) {
      ctx.session.orderForm.clientPhone = msg.text;
    }
    // 4. Якщо прийшов невідповідний тип повідомлення
    else {
      await ctx.reply(
        'Будь ласка, натисніть кнопку або введіть номер телефону вручну.',
      );
      return;
    }

    const state = ctx.session.orderForm;

    // Виводимо резюме замовлення перед фінальним збереженням за ТЗ
    const summary =
      `📝 <b>ПЕРЕВІРКА ЗАЯВКИ</b>\n\n` +
      `📦 <b>Послуга:</b> ${state.serviceName ?? ''}\n` +
      `📍 <b>Тип локації:</b> ${state.locationType ?? ''}\n` +
      `📍 <b>Дані місця:</b> ${state.locationData ?? ''}\n` +
      `💬 <b>Коментар:</b> ${state.customComment ?? 'Немає'}\n` +
      `👤 <b>Клієнт:</b> ${state.clientName ?? ''}\n` +
      `📱 <b>Телефон/Контакти:</b> ${state.clientPhone ?? ''}\n\n` +
      `Все правильно?`;

    await ctx.reply(summary, {
      parse_mode: 'HTML',
      reply_markup: Markup.inlineKeyboard([
        [
          Markup.button.callback(
            '✅ Підтверджую і Створюю',
            'confirm_order_save',
          ),
        ],
        [Markup.button.callback('❌ Скасувати', 'cancel_order_wizard')],
      ]).reply_markup,
    });

    ctx.wizard.next();
  }

  /**
   * ФІНАЛ: Збереження в Back4app
   */
  @WizardStep(8)
  async stepSaveOrder(@Ctx() ctx: OrderWizardContext) {
    // 1. Використовуємо Type Guard, щоб TypeScript знав, що це клік по інлайн-кнопці
    if (ctx.has('callback_query') && 'data' in ctx.callbackQuery) {
      const callbackData = ctx.callbackQuery.data;

      // 🔥 ФІКС 1: Викликаємо суворо типізований answerCbQuery через ctx.telegram
      await ctx.telegram.answerCbQuery(ctx.callbackQuery.id);

      if (callbackData === 'confirm_order_save') {
        await ctx.reply('⏳ Зберігаю вашу заявку у хмарі...');

        const state = ctx.session.orderForm;
        const telegramId = ctx.from.id.toString();

        try {
          const newOrder = await this.ordersService.create({
            clientName: state?.clientName ?? 'Клієнт',
            clientPhone: state?.clientPhone ?? '',
            telegramId: telegramId,
            serviceId: state?.serviceId ?? '',
            customComment: state?.customComment,
            locationType: state?.locationType ?? 'address_text',
            locationData: state?.locationData ?? '',
            photos: state?.clientPhotos ?? [],
            burialId: state?.burialId,
          });

          await ctx.reply(
            `🎉 <b>Заявку №${newOrder.id} успішно створено!</b>\n\n` +
            `Адміністратор вже взяв її на перевірку. Ви отримаєте сповіщення про зміну статусу тут.`,
            {
              parse_mode: 'HTML',
              reply_markup: Markup.removeKeyboard().reply_markup,
            },
          );

          if (state) {
            await this.sendOrderToAdmin(newOrder.id, state, telegramId);
          }

          // 🔥 ОБОВ'ЯЗКОВО: Після успішного збереження повністю видаляємо чернетку з сесії
          delete ctx.session.orderForm;
        } catch (error) {
          console.log(error);
          await ctx.reply(
            'Помилка сервера під час створення заявки. Спробуйте пізніше.',
          );
        }
      } else {
        await ctx.reply(
          'Скасовано. Ви можете розпочати заново за допомогою головного меню.',
          Markup.removeKeyboard(),
        );
      }
    } else {
      // Якщо користувач замість кліку по кнопці просто надіслав текст на етапі підтвердження
      await ctx.reply('Будь ласка, оберіть дію на інлайн-кнопках вище.');
      return;
    }

    await this.showMainMenu(ctx);
    return ctx.scene.leave();
  }

  private async sendOrderToAdmin(orderId: string, state: OrderForm, telegramId: string) {
    const ADMIN_BOT_CHAT_ID = process.env.TELEGRAM_ADMIN_CHAT_ID || '';

    const adminSummary =
      `🔔 <b>НОВА ЗАЯВКА №${orderId}</b>\n\n` +
      `📦 <b>Послуга:</b> ${state.serviceName ?? ''}\n` +
      `📍 <b>Місце:</b> (${state.locationType ?? ''}) ${state.locationData ?? ''}\n` +
      `👤 <b>Клієнт:</b> ${state.clientName ?? ''}\n` +
      `📱 <b>Телефон:</b> ${state.clientPhone ?? ''}\n` +
      `💬 <b>Коментар:</b> ${state.customComment ?? 'Немає'}`;

    const adminButtons = Markup.inlineKeyboard([
      [
        Markup.button.callback('✅ Підтвердити', `admin_confirm_${orderId}_${telegramId}`),
        Markup.button.callback('❌ Відхилити', `admin_reject_${orderId}_${telegramId}`),
      ],
      [
        Markup.button.callback('🔍 Уточнити', `admin_clarify_${orderId}_${telegramId}`)
      ]
    ]).reply_markup;

    try {
      // 3. Надсилаємо адміну (з фото, якщо воно є, або просто текстом)
      if (state.clientPhotos && state.clientPhotos.length > 0) {
        // Беремо перше фото з масиву для головної картки з кнопками
        const mainPhoto = state.clientPhotos[0];

        await this.adminBot.telegram.sendPhoto(ADMIN_BOT_CHAT_ID, mainPhoto, {
          caption: adminSummary,
          parse_mode: 'HTML',
          reply_markup: adminButtons,
        });
      } else {
        await this.adminBot.telegram.sendMessage(ADMIN_BOT_CHAT_ID, adminSummary, {
          parse_mode: 'HTML',
          reply_markup: adminButtons,
        });
      }
      console.log('🚀 Картку успішно відправлено адмін-ботом!');
    } catch (error) {
      console.error('❌ Помилка відправки через адмін-бота:', error);
    }
  }

  private async showMainMenu(ctx: Context, ) {
    const mainMenu = Markup.keyboard([
      ['✨ Створити замовлення'],
      ['🗂 Мої замовлення', 'ℹ️ Допомога'],
    ]).resize().reply_markup;

    // 🔥 ГОЛОВНИЙ ФІКС 2: Повертаємо головне меню при скасуванні
    await ctx.reply(
      'Головне меню:',
      { reply_markup: mainMenu },
    );
  }

}
