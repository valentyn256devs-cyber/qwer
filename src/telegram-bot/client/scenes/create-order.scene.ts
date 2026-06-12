import {Context as Ctx, InjectBot, Wizard, WizardStep} from 'nestjs-telegraf';
import {Context, Markup, Telegraf} from 'telegraf';
import {ServicesService} from '../../../services/services.service';
import {OrdersService} from '../../../orders/orders.service';
import {OrderForm, type OrderWizardContext} from '../interfaces/order-wizard-context.interface';
import {BurialMenu, mainMenuButtons, OrderStepUa, Scene, Step, TelegramBot} from "../../telegram-constants";
import {BurialsService} from "../../../burials/burials.service";

@Wizard(Scene.CREATE_ORDER_WIZARD)
export class CreateOrderScene {
  constructor(
    private readonly ordersService: OrdersService,
    private readonly servicesService: ServicesService,
    private readonly burialsService: BurialsService,
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
      const buttons = services.map((s, index) => {
        const mainButtonText = `${index + 1}. ${s.name}`;
        // const mainButtonText = `${index + 1}. ${s.name} (${s.price} грн)`;
        // Обрізаємо заголовок, якщо він раптом задовгий для однієї з двох кнопок (до 40 символів)
        const finalMainText = mainButtonText.length > 60 ? `${mainButtonText.substring(0, 57)}...` : mainButtonText;

        return [
          Markup.button.callback(finalMainText, `service_${s.id}`), // Твоя логіка замовлення
          Markup.button.callback('ℹ️', `client_service_desc_${s.id}`),     // Нова кнопка опису
        ];
      });

      // Кнопка повернення назад до головного меню
      buttons.push([
        Markup.button.callback(OrderStepUa.GoBack, 'client_back_to_menu'),
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
      // 🔥 СЦЕНАРІЙ 2: Користувач натиснув на кнопку "ℹ️ Опис"
      else if (callbackData.startsWith('client_service_desc_')) {
        // Тут префікс "client_service_desc_", тому ID послуги — це все, що після 3-го підкреслення
        const serviceId = callbackData.replace('client_service_desc_', '');

        try {
          const service = await this.servicesService.findOne(serviceId);
          if (service && service.description) {
            await ctx.telegram.answerCbQuery(callbackQuery.id).catch(() => null);

            const cleanDesc = service.description.replace(/<\/?[^>]+(>|$)/g, "");

            const descriptionText =
              `<b>🪦 Детальний опис послуги: ${service.name}</b>\n\n` +
              `💰 <b>Вартість:</b> <code>${service.price} грн</code>\n\n` +
              `📝 <b>Про послугу:</b>\n<i>${cleanDesc}</i>`;

            // Замінюємо картку товару на повний опис послуги
            await ctx.editMessageText(descriptionText, {
              parse_mode: 'HTML',
              reply_markup: {
                inline_keyboard: [
                  [
                    Markup.button.callback('🛍 Замовити', `service_${service.id}`),
                    Markup.button.callback('🔙 Назад до списку', 'client_refresh_services_list')
                  ]
                ]
              }
            });
          } else {
            await ctx.answerCbQuery(OrderStepUa.NotFoundDescription, { show_alert: true });
          }

        } catch (error) {
          console.error(error);
          await ctx.answerCbQuery(OrderStepUa.ErrorLoadDescription, { show_alert: true}).catch(() => null);
        }

        // ⚠️ ВАЖЛИВО: Робимо return і НЕ викликаємо жодних переходів.
        // Користувач просто закриває модалку й залишається дивитися на список послуг.
        return;
      }
      // 🔥 СЦЕНАРІЙ 3: Натиснуто «🔙 Назад до списку» всередині опису послуги
      else if (callbackData === 'client_refresh_services_list') {
        await ctx.telegram.answerCbQuery(callbackQuery.id).catch(() => null);

        // Повністю видаляємо повідомлення з описом
        await ctx.deleteMessage().catch(() => null);
        // Повертаємо візард на нульовий (початковий) крок і викликаємо його для перегенерації карток
        ctx.wizard.selectStep(0);
        return this.stepStart(ctx);
      }

      // press back to menu
      else if (callbackData.startsWith('client_back_to_menu')) {
        const id = ctx.callbackQuery?.id ?? '-'
        await ctx.telegram.answerCbQuery(id);
        // Видаляємо інлайн-кнопки або старе повідомлення, щоб не засмічувати чат
        await ctx.deleteMessage().catch(() => null);
        await this.showMainMenu(ctx);
        return ctx.scene.leave();
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
    await ctx.reply(Step.Step3, {
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
      Step.Step4,
      {
        parse_mode: 'HTML',
        reply_markup: Markup.keyboard([[OrderStepUa.Skip]]).resize().oneTime().reply_markup,
      },
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
      const text = ctx.message.text;
      if (text !== OrderStepUa.Skip) {
        ctx.session.orderForm.customComment = ctx.message.text;
      } else ctx.session.orderForm.customComment = '';
    }

    // За замовчуванням беремо ім'я з телеграму
    ctx.session.orderForm.clientName = ctx.from?.first_name ?? 'Клієнт';

    await ctx.reply(Step.Step5, {
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

    await ctx.reply('⏳ Формую резюме заявки...', Markup.removeKeyboard()).catch(() => null);

    const state = ctx.session.orderForm;

    // Виводимо резюме замовлення перед фінальним збереженням за ТЗ
    const summary =
      `📝 <b>ПЕРЕВІРКА ЗАЯВКИ</b>\n\n` +
      `📦 <b>Назва:</b> ${state.burialDisplayName ?? ''}\n` +
      `📦 <b>Послуга:</b> ${state.serviceName ?? ''}\n` +
      // `📍 <b>Тип локації:</b> ${state.locationType ?? ''}\n` +
      `📍 <b>Дані місця:</b> ${state.locationData ?? ''}\n` +
      `💬 <b>Коментар:</b> ${state.customComment ?? 'Немає'}\n` +
      `👤 <b>Клієнт:</b> ${state.clientName ?? ''}\n` +
      `📱 <b>Телефон/Контакти:</b> ${state.clientPhone ?? ''}\n\n` +
      `Все правильно?`;

    await ctx.reply(summary, {
      parse_mode: 'HTML',
      reply_markup: Markup.inlineKeyboard([
        [
          Markup.button.callback(OrderStepUa.ApproveAndCreate, 'confirm_order_save'),
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
        // Передаємо порожній inlineKeyboard, щоб кнопки миттєво зникли
        await ctx.editMessageReplyMarkup({ inline_keyboard: [] }).catch(() => null);

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
        // Передаємо порожній inlineKeyboard, щоб кнопки миттєво зникли
        await ctx.editMessageReplyMarkup({ inline_keyboard: [] }).catch(() => null);
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
    const burialData = await this.burialsService.findBurialById(state.burialId);

    // Форматер для відображення дат анкети
    const dateFormatter = new Intl.DateTimeFormat('uk-UA', {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
    });

    // 2. Формуємо базове резюме замовлення
    let adminSummary = `🔔 <b>НОВА ЗАЯВКА №${orderId}</b>\n\n`;
    adminSummary += `📦 <b>Послуга:</b> ${state.serviceName ?? 'Індивідуальна'}\n`;
    adminSummary += `📍 <b>Місце:</b> ${state.locationData ?? ''}\n`;
    // adminSummary += `📍 <b>Місце:</b> (${state.locationType ?? 'Текст'}) ${state.locationData ?? ''}\n`;
    if (state.cemeteryDetails) {
      adminSummary += `🏛 <b>Деталі цвинтаря:</b> ${state.cemeteryDetails}\n`;
    }
    adminSummary += `💬 <b>Коментар:</b> ${state.customComment ?? 'Немає'}\n\n`;

    // 🪦 ЯКЩО ПРИВ'ЯЗАНО АНКЕТУ ПОХОВАННЯ — РОЗШИРЮЄМО ОПИС
    if (burialData) {
      const bName = burialData.burialName ?? '—';
      const bLastName = burialData.burialLastName ?? '—';
      const bFatherName = burialData.burialFatherName ?? '—';

      const birthStr = burialData.birthDate ? dateFormatter.format(new Date(burialData.birthDate)) : 'Невідомо';
      const deathStr = burialData.deathDate ? dateFormatter.format(new Date(burialData.deathDate)) : 'Невідомо';

      adminSummary += `🪦 <b>ДАНІ МІСЦЯ ПАМ'ЯТІ:</b>\n`;
      adminSummary += `👤 <b>Покійний:</b> ${bLastName} ${bName} ${bFatherName}\n`;
      adminSummary += `📅 <b>Роки життя:</b> ${birthStr} — ${deathStr}\n`;
      // adminSummary += `🏛 <b>Цвинтар:</b> ${burialData.cemetery ?? 'Не вказано'}\n`;
      if (burialData.coordinates) {
        adminSummary += `🌐 <b>Координати:</b> <code>${burialData.coordinates}</code>\n`;
      }
      // if (burialData.notes) {
      //   adminSummary += `📝 <b>Нотатки анкети:</b> <i>${burialData.notes}</i>\n`;
      // }
      adminSummary += `\n`;
    }

    // Додаємо дані клієнта наприкінці
    adminSummary += `👤 <b>КЛІЄНТ:</b>\n`;
    adminSummary += `▪️ <b>Ім'я:</b> ${state.clientName ?? 'Не вказано'}\n`;
    adminSummary += `▪️ <b>Телефон:</b> ${state.clientPhone ?? 'Немає номера'}\n`;
    if (state.clientNickName) adminSummary += `▪️ <b>Username:</b> @${state.clientNickName.replace('@', '')}\n`;
    if (state.clientEmail) adminSummary += `▪️ <b>Email:</b> ${state.clientEmail}\n`;

    const adminButtons = Markup.inlineKeyboard([
      [
        Markup.button.callback(OrderStepUa.Approve, `admin_confirm_${orderId}_${telegramId}`),
        Markup.button.callback(OrderStepUa.Reject, `admin_reject_${orderId}_${telegramId}`),
      ],
      /*[
        Markup.button.callback('🔍 Уточнити', `admin_clarify_${orderId}_${telegramId}`)
      ]*/
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
    // 🔥 ГОЛОВНИЙ ФІКС 2: Повертаємо головне меню при скасуванні
    await ctx.reply(OrderStepUa.MainMenu, { reply_markup: mainMenuButtons },);
  }

}
