import {Context as Ctx, InjectBot, Wizard, WizardStep} from 'nestjs-telegraf';
import {Context, Markup, Telegraf} from 'telegraf';
import {ServicesService} from '../../../services/services.service';
import {OrdersService} from '../../../orders/orders.service';
import {OrderForm, type OrderWizardContext} from '../interfaces/order-wizard-context.interface';
import {BurialMenu, MainMenu, OrderStepUa, Scene, Step, TelegramBot} from "../../telegram-constants";

@Wizard(Scene.CREATE_ORDER_WIZARD)
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

    // 🔥 ГОЛОВНА ПЕРЕВІРКА: Якщо прийшли з каталогу послуг (serviceId вже існує)
    if (ctx.session.orderForm.serviceId) {
      ctx.wizard.selectStep(2);
      await ctx.reply(OrderStepUa.FillCard);
      // І викликаємо наступний метод вручну, щоб користувач не чекав наступного кліку
      return ctx.scene.enter(Scene.CREATE_BURIAL_WIZARD);
    }

    await ctx.reply(OrderStepUa.Loading);
    try {
      const services = await this.servicesService.findAll();
      if (services.length === 0) {
        await ctx.reply(OrderStepUa.NoServices);
        await ctx.scene.leave();
        return;
      }

      // Створюємо інлайн-кнопки з послугами з бази Back4app
      const buttons = services.map((s) => [
        Markup.button.callback(`${s.name} (${s.price} грн)`, `service_${s.id}`),
      ]);

      await ctx.reply(Step.Step1, {
        parse_mode: 'HTML',
        reply_markup: Markup.inlineKeyboard(buttons).reply_markup,
      });

      ctx.wizard.next();
    } catch (error) {
      console.log(error);
      await ctx.reply(OrderStepUa.ErrorLoadServices);
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
          ctx.session.orderForm.serviceName = OrderStepUa.Service;
        }

        await ctx.telegram.answerCbQuery(callbackQuery.id);

        // 🔥 ПЕРЕХІД: Одразу викликаємо інший візард
        await ctx.reply(OrderStepUa.FillCard );
        return ctx.scene.enter(Scene.CREATE_BURIAL_WIZARD);
      }
    }

    if (!ctx.session.orderForm?.serviceId) {
      await ctx.reply(OrderStepUa.ChooseService);
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

    // Якщо користувач щойно прийшов зі створення послуги через callback
    const callbackQuery = ctx.callbackQuery;
    if (callbackQuery && 'data' in callbackQuery) {
      await ctx.telegram.answerCbQuery(callbackQuery.id);
    }

    // 3. Якщо користувач чомусь не обрав послугу, а просто надіслав текст
    if (!ctx.session.orderForm?.serviceId) {
      await ctx.reply(OrderStepUa.ChooseService);
      return; // Залишаємо користувача на цьому ж кроці
    }

    // 4. Виводимо клавіатуру вибору локації за ТЗ
    await ctx.reply(Step.Step2, {
      parse_mode: 'HTML',
      reply_markup: Markup.keyboard([
        [BurialMenu.Geo, BurialMenu.GoogleMap],
        [BurialMenu.Text, BurialMenu.City],
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
    const validButtons : string[] = [
      BurialMenu.Geo, BurialMenu.GoogleMap,
      BurialMenu.Text, BurialMenu.City
    ];

    if (!text || !validButtons.includes(text)) {
      await ctx.reply(OrderStepUa.ChooseMenu );
      return; // 🛑 ЗУПИНЯЄМО ФЛОУ. Користувач залишається на цьому кроці, поки не натисне кнопку.
    }

    if (!ctx.session.orderForm) {
      ctx.session.orderForm = {};
    }

    if (text === BurialMenu.Geo) {
      ctx.session.orderForm.locationType = 'coordinates';
      await ctx.reply(
        OrderStepUa.SendYourLocation,
        Markup.keyboard([
          [Markup.button.locationRequest(OrderStepUa.SendMyLocation)],
        ]).resize(),
      );
    } else if (text === BurialMenu.GoogleMap) {
      ctx.session.orderForm.locationType = 'google_maps';
      await ctx.reply(
        OrderStepUa.HintGoogleMap,
        { parse_mode: 'HTML', reply_markup: Markup.removeKeyboard().reply_markup }
      );
    } else {
      ctx.session.orderForm.locationType = 'address_text';
      await ctx.reply(
        OrderStepUa.HintFullLocation,
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
      await ctx.reply(OrderStepUa.SendCorrectLocation);
      return; // Залишаємо користувача на цьому ж кроці
    }

    // 2. Безпечно перевіряємо наявність геолокації (Варіант 2 з ТЗ)
    if (ctx.session.orderForm.locationType === 'coordinates' && 'location' in msg) {
      ctx.session.orderForm.locationData = `${msg.location.latitude},${msg.location.longitude}`;
    }
    // 3. Безпечно перевіряємо наявність тексту (Варіанти 1, 3, 4 з ТЗ)
    else if ('text' in msg && msg.text) {
      ctx.session.orderForm.locationData = msg.text;
    } else { // 4. Якщо прийшов не той тип даних (наприклад, користувач замість локації скинув стікер)
      await ctx.reply(OrderStepUa.IncorrectLocationFormat);
      return;
    }

    //
    await ctx.reply(
      OrderStepUa.HintDescriptionBurialPlace,
      {
        parse_mode: 'HTML',
        reply_markup: Markup.inlineKeyboard([
          [Markup.button.callback(OrderStepUa.Skip, 'skip_burial_description')],
        ]).reply_markup,
      }
    );

    ctx.wizard.next();
  }

  /**
   * Додаткові візуальні орієнтири
   * Цей крок є необов'язковим, його можна пропустити.
   */
  @WizardStep(6)
  async stepBurialDescription(@Ctx() ctx: OrderWizardContext) {
    // 1. Обробка першого входу на цей крок
    if (!ctx.session.orderForm) {
      ctx.session.orderForm = {};
    }

    // Перевіряємо, чи ми щойно зайшли сюди з попереднього кроку (коли користувач ввів локацію)
    // Якщо в повідомленні лежать дані локації або текст кнопки вибору, ми показуємо інструкцію для орієнтирів
    const msg = ctx.message;

    // 2. ОБРОБКА РЕЗУЛЬТАТУ (Коли користувач уже щось надіслав або натиснув кнопку)

    // Сценарій А: Користувач натиснув інлайн-кнопку "Пропустити"
    if (ctx.has('callback_query') &&
      'data' in ctx.callbackQuery &&
      ctx.callbackQuery.data === 'skip_burial_description')
    {
      await ctx.telegram.answerCbQuery(ctx.callbackQuery.id);
      ctx.session.orderForm.cemeteryDetails = OrderStepUa.NoSet;
    }
    // Сценарій Б: Користувач ввів орієнтири текстом
    else if (msg && 'text' in msg && msg.text) {
      ctx.session.orderForm.cemeteryDetails = msg.text;
    }
    // Сценарій В: Прийшов некоректний тип даних (наприклад, стікер)
    else {
      await ctx.reply(OrderStepUa.HintSetOrientation);
      return; // залишаємо юзера на цьому кроці
    }

    // Рухаємось далі до опису завдання (коментаря)
    await ctx.reply(
      Step.Step3,
      { parse_mode: 'HTML' },
    );

    // Переводимо курсор на Крок 7 (метод stepContacts)
    ctx.wizard.next();
  }

  /**
   * Контактні дані (Ім'я, телефон)
   */
  @WizardStep(7)
  async stepContacts(@Ctx() ctx: OrderWizardContext) {
    if (!ctx.session.orderForm) {
      ctx.session.orderForm = {};
    }

    if (ctx.message && 'text' in ctx.message) {
      ctx.session.orderForm.customComment = ctx.message.text;
    }

    // За замовчуванням беремо ім'я з телеграму
    ctx.session.orderForm.clientName = ctx.from?.first_name ?? 'Клієнт';

    await ctx.reply(Step.Step4, {
      parse_mode: 'HTML',
      reply_markup: Markup.keyboard([
        [Markup.button.contactRequest(OrderStepUa.SendMyPhone)],
      ]).resize().reply_markup,
    });
    ctx.wizard.next();
  }

  /**
   * КРОК 6: Підтвердження заявки
   */
  @WizardStep(8)
  async stepPhone(@Ctx() ctx: OrderWizardContext) {
    const msg = ctx.message;

    if (!ctx.session.orderForm) {
      ctx.session.orderForm = {};
    }

    // 1. Перевіряємо, чи взагалі існує об'єкт повідомлення
    if (!msg) {
      await ctx.reply(OrderStepUa.ErrorSetPhone);
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
      await ctx.reply(OrderStepUa.ErrorSetPhone);
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
        [Markup.button.callback(OrderStepUa.Cancel, 'cancel_order_wizard')],
      ]).reply_markup,
    });

    ctx.wizard.next();
  }

  /**
   * ФІНАЛ: Збереження в Back4app
   */
  @WizardStep(9)
  async stepSaveOrder(@Ctx() ctx: OrderWizardContext) {
    // 1. Використовуємо Type Guard, щоб TypeScript знав, що це клік по інлайн-кнопці
    if (ctx.has('callback_query') && 'data' in ctx.callbackQuery) {
      const callbackData = ctx.callbackQuery.data;

      // 🔥 ФІКС 1: Викликаємо суворо типізований answerCbQuery через ctx.telegram
      await ctx.telegram.answerCbQuery(ctx.callbackQuery.id);

      if (callbackData === 'confirm_order_save') {
        await ctx.reply(OrderStepUa.SavingOrder);

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
          await ctx.reply(OrderStepUa.ErrorSavingOrder);
        }
      } else {
        await ctx.reply(OrderStepUa.OrderCanceled, Markup.removeKeyboard(),);
      }
    } else {
      // Якщо користувач замість кліку по кнопці просто надіслав текст на етапі підтвердження
      await ctx.reply(OrderStepUa.HintChooseMenu);
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
      console.log(OrderStepUa.SuccessSavedOrder);
    } catch (error) {
      console.error(OrderStepUa.ErrorSavedOrder, error);
    }
  }

  private async showMainMenu(ctx: Context, ) {
    const mainMenu = Markup.keyboard([
      [MainMenu.Services],
      [MainMenu.CreateOrder],
      [MainMenu.MyOrders, MainMenu.Help],
    ]).resize().reply_markup;

    // 🔥 ГОЛОВНИЙ ФІКС 2: Повертаємо головне меню при скасуванні
    await ctx.reply(OrderStepUa.MainMenu, { reply_markup: mainMenu },);
  }

}
