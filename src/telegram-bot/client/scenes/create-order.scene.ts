import {Context as Ctx, InjectBot, Wizard, WizardStep} from 'nestjs-telegraf';
import {Context, Markup, Telegraf} from 'telegraf';
import {ServicesService} from '../../../services/services.service';
import {OrdersService} from '../../../orders/orders.service';
import {OrderForm, type OrderWizardContext} from '../interfaces/order-wizard-context.interface';
import {OrderStepUa, Scene, showMainMenu, Step, TelegramBot} from "../../telegram-constants";
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
      ctx.session.orderForm.burialLastName = ctx.session.pendingBurial?.burialLastName;
      ctx.session.orderForm.burialName = ctx.session.pendingBurial?.burialName;
      ctx.session.orderForm.burialFatherName = ctx.session.pendingBurial?.burialFatherName;
      ctx.session.orderForm.burialBirthDate = ctx.session.pendingBurial?.birthDate;
      ctx.session.orderForm.burialDeathDate = ctx.session.pendingBurial?.deathDate;

      delete ctx.session.pendingBurial;

      ctx.wizard.selectStep(4);
      // 2. Викликаємо метод Кроку 2 напряму, щоб юзер не чекав наступного повідомлення
      return this.stepContacts(ctx);
    }

    // Якщо МІСЦЕ вже обрано (прийшли з картки місця або після створення), одразу шлемо каталог послуг
    if (ctx.session.orderForm.burialId) {
      ctx.wizard.selectStep(2); // Перестрибуємо крок вибору місця, йдемо до послуг
      return this.stepShowServicesCatalog(ctx); // Метод, який рендерить картки послуг
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
        await showMainMenu(ctx);
        await ctx.scene.leave();
        return;
      }

      // Створюємо інлайн-кнопки з послугами з бази Back4app
      const buttons = services.map((s, index) => {
        const mainButtonText = `${index + 1}. ${s.name}`;

        let finalMainText = mainButtonText.length > 45 ? `${mainButtonText.substring(0, 42)}...` : mainButtonText;
        finalMainText = finalMainText.padEnd(45, '\u00A0');
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
      await showMainMenu(ctx);
      return ctx.scene.leave();
    }
  }

  /**
   * КРОК 2: Обробка вибору / створення місця пам'яті
   */
  @WizardStep(2)
  async stepHandleBurialSelection(@Ctx() ctx: OrderWizardContext) {
    const callbackQuery = ctx.callbackQuery;
    if (!callbackQuery || !('data' in callbackQuery)) return;

    const callbackData = callbackQuery.data;

    // Сценарій А: Реєстрація нового місця
    if (callbackData === 'order_create_new_burial') {
      await ctx.telegram.answerCbQuery(callbackQuery.id).catch(() => null);
      await ctx.reply(OrderStepUa.FillCard);
      ctx.wizard.selectStep(0); // Повертаємо покажчик на 0, щоб коли візард повернеться, він обробив pendingBurial
      return ctx.scene.enter(Scene.CREATE_BURIAL_WIZARD);
    }

    // Сценарій Б: Показ списку існуючих місць
    if (callbackData === 'order_choose_existing') {
      await ctx.telegram.answerCbQuery(callbackQuery.id).catch(() => null);
      await ctx.deleteMessage().catch(() => null);

      const telegramId = ctx.from?.id.toString() ?? '';
      const myBurials = await this.burialsService.findByTelegramId(telegramId);

      const burialButtons = myBurials.map(b => [
        Markup.button.callback(`🪦 ${b.name}`, `select_burial_for_order_${b.id}`)
      ]);
      burialButtons.push([Markup.button.callback('🔙 Назад', 'order_back_to_start')]);

      await ctx.reply('👇 Оберіть об\'єкт зі списку:', {
        reply_markup: {inline_keyboard: burialButtons}
      });
      return; // Залишаємось на Кроці 2, чекаємо вибору конкретного ID місця
    }

    if (!ctx.session.orderForm) {
      ctx.session.orderForm = {};
    }

    // Сценарій В: Клік по конкретному об'єкту зі списку
    if (callbackData.startsWith('select_burial_for_order_')) {
      const burialId = callbackData.split('_')[4];
      await ctx.telegram.answerCbQuery(callbackQuery.id).catch(() => null);
      await ctx.deleteMessage().catch(() => null);

      ctx.session.orderForm.burialId = burialId;
      try {
        const b = await this.burialsService.findBurialById(burialId);
        ctx.session.orderForm.burialDisplayName = b?.name;
      } catch (e) {
        console.log(e)
      }

      ctx.wizard.next(); // Переходимо на Крок 3 (індекс 2)
      return this.stepShowServicesCatalog(ctx);
    } else // Повернення на початок вибору об'єкта ----------------------------------------------------
    if (callbackData === 'order_back_to_start') {
      await ctx.telegram.answerCbQuery(callbackQuery.id).catch(() => null);
      await ctx.deleteMessage().catch(() => null);
      ctx.wizard.selectStep(0);
      return this.stepStart(ctx);
    } // Кнопка скасування (назад до головного меню) --------------------------------------------------
    if (callbackData === 'client_back_to_menu') {
      await ctx.telegram.answerCbQuery(callbackQuery.id).catch(() => null);
      await ctx.deleteMessage().catch(() => null);
      await showMainMenu(ctx);
      delete ctx.session.orderForm;
      return ctx.scene.leave();
    } else // користувач обрав послугу --------------------------------------------------------------
    if (callbackData.startsWith('service_')) {
      ctx.wizard.selectStep(11);
      return this.stepAddBurial(ctx);
    } else // Info -----------------------------------------------------------------------------------
    if (callbackData.startsWith('client_service_desc_')) {
      await this.showServiceDescription(ctx, callbackData);
    } else if (callbackData === 'client_refresh_services_list') {
      await ctx.telegram.answerCbQuery(callbackQuery.id).catch(() => null);
      await ctx.deleteMessage().catch(() => null);
      ctx.wizard.selectStep(0);
      return this.stepStart(ctx);
    }
  }

  /**
   * КРОК 3 (Допоміжний метод): Генерація та надсилання карток послуг
   */
  async stepShowServicesCatalog(@Ctx() ctx: OrderWizardContext) {
    const loadingMsg = await ctx.reply(OrderStepUa.LoadingServices).catch(() => null);
    const chatId = ctx.chat?.id ?? '';
    if (!ctx.session.orderForm) {
      ctx.session.orderForm = {};
    }

    try {
      const services = await this.servicesService.findAll();

      if (services.length === 0) {
        if (loadingMsg) await ctx.telegram.deleteMessage(chatId, loadingMsg.message_id).catch(() => null);
        await ctx.reply(OrderStepUa.NoServices);
        await showMainMenu(ctx);
        delete ctx.session.orderForm;
        return ctx.scene.leave();
      }

      if (loadingMsg) await ctx.telegram.deleteMessage(chatId, loadingMsg.message_id).catch(() => null);

      await ctx.reply(`📚 <b>${OrderStepUa.ServicesCatalog}</b>\nОберіть потрібну послугу для об'єкта <b>${ctx.session.orderForm.burialDisplayName}</b>:`, {
        parse_mode: 'HTML',
      });

      // Рендеримо окремі картки
      for (const [index, s] of services.entries()) {
        const shortDesc = s.description ? s.description.replace(/<\/?[^>]+(>|$)/g, "") : 'Опис відсутній';
        const invisibleSpacer = '<code>👉' + '‌️‌️' + ' '.repeat(26) + '</code>';

        const cardMessageText =
          `<b>🪦 Послуга №${index + 1}: ${s.name}</b>\n` +
          `💰 <b>Вартість:</b> <code>${s.price} грн</code>\n` +
          `📝 <b>Коротко:</b> <i>${shortDesc.substring(0, 100)}${shortDesc.length > 100 ? '...' : ''}</i>\n` +
          `${invisibleSpacer}`;

        await ctx.reply(cardMessageText, {
          parse_mode: 'HTML',
          reply_markup: {
            inline_keyboard: [
              [
                Markup.button.callback('🛍 Замовити', `service_${s.id}`),
                Markup.button.callback('ℹ️ Детальніше', `client_service_desc_${s.id}`),
              ]
            ]
          }
        });
        await new Promise((resolve) => setTimeout(resolve, 150));
      }

      // Нижня кнопка скасування замовлення
      await ctx.reply('⬇️ Або ви можете скасувати оформлення:', {
        reply_markup: {
          inline_keyboard: [[Markup.button.callback(OrderStepUa.GoBack, 'client_back_to_menu')]]
        }
      });

    } catch (error) {
      console.error(error);
      await ctx.reply(OrderStepUa.ErrorLoadServices);
      await showMainMenu(ctx);
      delete ctx.session.orderForm;
      return ctx.scene.leave();
    }
  }

  /**
   * КРОК 3 (Слухач): Обробка вибору послуг, описів та навігації всередині каталогу
   */
  @WizardStep(3)
  async stepHandleServiceSelection(@Ctx() ctx: OrderWizardContext) {
    const callbackQuery = ctx.callbackQuery;
    if (!callbackQuery || !('data' in callbackQuery)) return;

    if (!ctx.session.orderForm) {
      ctx.session.orderForm = {};
    }

    const callbackData = callbackQuery.data;

    // Сценарій 1: Юзер обрав послугу
    if (callbackData.startsWith('service_')) {
      const serviceId = callbackData.split('_')[1];

      try {
        const service = await this.servicesService.findOne(serviceId);
        ctx.session.orderForm.serviceId = serviceId;
        ctx.session.orderForm.serviceName = service.name;
        ctx.session.orderForm.price = service.price;
      } catch (e) {
        ctx.session.orderForm.serviceId = serviceId;
        ctx.session.orderForm.serviceName = OrderStepUa.Service;
      }

      await ctx.telegram.answerCbQuery(callbackQuery.id).catch(() => null);

      // 🔥 ПЕРЕХІД ДАЛІ: Послугу й місце обрано, переходимо до наступних кроків форми (наприклад, дата, коментар, фото об'єкта)
      await ctx.reply(`✅ Ви обрали: <b>${ctx.session.orderForm.serviceName}</b>. Переходимо до наступного кроку...`, {parse_mode: 'HTML'});
      ctx.wizard.selectStep(4);
      return this.stepContacts(ctx);
    }

    // Сценарій 2: Клік по кнопці "ℹ️ Детальніше" (Розгортання на повний екран)
    if (callbackData.startsWith('client_service_desc_')) {
      /*const id = callbackData.replace('client_service_desc_', '');

      try {
        const service = await this.servicesService.findOne(id);
        if (service && service.description) {
          await ctx.telegram.answerCbQuery(callbackQuery.id).catch(() => null);

          const cleanDesc = service.description.replace(/<\/?[^>]+(>|$)/g, "");
          const descriptionText =
            `<b>🪦 Детальний опис послуги: ${service.name}</b>\n\n` +
            `💰 <b>Вартість:</b> <code>${service.price} грн</code>\n\n` +
            `📝 <b>Про послугу:</b>\n<i>${cleanDesc}</i>`;

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
          await ctx.answerCbQuery(OrderStepUa.NotFoundDescription, {show_alert: true});
        }
      } catch (error) {
        console.error(error);
        await ctx.answerCbQuery(OrderStepUa.ErrorLoadDescription, {show_alert: true}).catch(() => null);
      }*/

      await this.showServiceDescription(ctx, callbackData);
      return; // Залишаємось на Кроці 3
    }

    // Сценарій 3: Клік по кнопці «🔙 Назад до списку» всередині опису
    if (callbackData === 'client_refresh_services_list') {
      await ctx.telegram.answerCbQuery(callbackQuery.id).catch(() => null);
      await ctx.deleteMessage().catch(() => null);

      // Просто перерендерюємо каталог на цьому ж кроці
      return this.stepShowServicesCatalog(ctx);
    }

    // Скасування та вихід в меню
    if (callbackData === 'client_back_to_menu') {
      await ctx.telegram.answerCbQuery(callbackQuery.id).catch(() => null);
      await ctx.deleteMessage().catch(() => null);
      await showMainMenu(ctx);
      delete ctx.session.orderForm;
      return ctx.scene.leave();
    }
  }

  @WizardStep(4)
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
        await ctx.reply(OrderStepUa.FillCard);
        return ctx.scene.enter(Scene.CREATE_BURIAL_WIZARD);
      }
      // 🔥 СЦЕНАРІЙ 2: Користувач натиснув на кнопку "ℹ️ Опис"
      else if (callbackData.startsWith('client_service_desc_')) {
        // Тут префікс "client_service_desc_", тому ID послуги — це все, що після 3-го підкреслення
        /*const serviceId = callbackData.replace('client_service_desc_', '');

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
            await ctx.answerCbQuery(OrderStepUa.NotFoundDescription, {show_alert: true});
          }

        } catch (error) {
          console.error(error);
          await ctx.answerCbQuery(OrderStepUa.ErrorLoadDescription, {show_alert: true}).catch(() => null);
        }*/

        await this.showServiceDescription(ctx, callbackData);

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
        await showMainMenu(ctx);
        delete ctx.session.orderForm;
        return ctx.scene.leave();
      }
    }

    if (!ctx.session.orderForm?.serviceId) {
      await ctx.reply(OrderStepUa.ChooseService);
      return;
    }
  }

  /**
   * Контактні дані (Ім'я, телефон)
   */
  @WizardStep(5)
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
  @WizardStep(6)
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
    // ctx.wizard.next();
    ctx.wizard.selectStep(6);
    return this.stepPrepareOrder(ctx);
  }

  @WizardStep(7)
  async stepPrepareOrder(@Ctx() ctx: OrderWizardContext) {
    if (!ctx.session.orderForm) {
      ctx.session.orderForm = {};
    }

    const state = ctx.session.orderForm;
    const lastName = state.burialLastName?.trim() ? state.burialLastName : 'Не вказано';
    const name = state.burialName?.trim() ? state.burialName : 'Не вказано';
    const father = state.burialFatherName?.trim() ? state.burialFatherName : 'Не вказано';

    // Перевіряємо та форматуємо значення дат (якщо приходить пустий рядок)
    const birth = state.burialBirthDate?.trim() ? state.burialBirthDate : 'Не вказано';
    const death = state.burialDeathDate?.trim() ? state.burialDeathDate : 'Не вказано';

    // Виводимо резюме замовлення перед фінальним збереженням за ТЗ
    const summary =
      `📝 <b>ПЕРЕВІРКА ЗАЯВКИ</b>\n\n` +
      `🏷 <b>Назва:</b> ${state.burialDisplayName ?? ''}\n` +
      `📦 <b>Послуга:</b> ${state.serviceName ?? ''}\n` +
      `👤 <b>Прізвище:</b> ${lastName}\n` +
      `👤 <b>Ім'я:</b> ${name}\n` +
      `👤 <b>По батькові:</b> ${father}\n` +
      `📅 <b>Дата народження:</b> ${birth}\n` +
      `🕯 <b>Дата смерті:</b> ${death}\n\n` +
      `📍 <b>Локація/Дані місця:</b> ${state.locationData ?? ''}\n` +
      `👁 <b>Орієнтир:</b> ${state.cemeteryDetails ?? 'Немає'}\n` +
      `💬 <b>Коментар:</b> ${state.customComment ?? 'Немає'}\n\n` +
      `👤 <b>Клієнт:</b> ${state.clientName ?? ''}\n` +
      `📱 <b>Телефон/Контакти:</b> ${state.clientPhone ?? ''}\n\n`;

    try {
      await ctx.reply(summary, {
        parse_mode: 'HTML',
        reply_markup: Markup.inlineKeyboard([
          [Markup.button.callback(OrderStepUa.ApproveAndCreate, 'confirm_order_save')],
          [Markup.button.callback(OrderStepUa.Edit, 'order_edit_fields')],
          [Markup.button.callback(OrderStepUa.Cancel, 'cancel_order_wizard')],
        ]).reply_markup,
      });

      ctx.wizard.next();
    } catch (e) {
      console.log(e);
      await ctx.reply(OrderStepUa.ErrorPrepareOrder);
      await showMainMenu(ctx);
    }
  }

  /**
   * ФІНАЛ: Збереження в Back4app
   */
  @WizardStep(8)
  async stepSaveOrder(@Ctx() ctx: OrderWizardContext) {
    const msg = ctx.message;

    // --- СЦЕНАРІЙ А: Користувач ввів нове значення текстовим повідомленням (Процес редагування) ---
    if (msg && 'text' in msg && ctx.wizard.state.editFieldTarget) {
      const newValue = msg.text.trim();
      const target = ctx.wizard.state.editFieldTarget;

      if (!ctx.session.orderForm) ctx.session.orderForm = {};

      // Записуємо нове значення у відповідне поле сесії
      if (target === 'edit_burial_displayName') ctx.session.orderForm.burialDisplayName = newValue;
      else if (target === 'edit_lastName') ctx.session.orderForm.burialLastName = newValue;
      else if (target === 'edit_name') ctx.session.orderForm.burialName = newValue;
      else if (target === 'edit_father') ctx.session.orderForm.burialFatherName = newValue;
      else if (target === 'edit_birth') ctx.session.orderForm.burialBirthDate = newValue;
      else if (target === 'edit_death') ctx.session.orderForm.burialDeathDate = newValue;
      else if (target === 'edit_location') {
        ctx.session.orderForm.locationType = 'address_text'
        ctx.session.orderForm.locationData = newValue;
      } else if (target === 'edit_cemeteryDetails') ctx.session.orderForm.cemeteryDetails = newValue;
      else if (target === 'edit_comment') ctx.session.orderForm.customComment = newValue;
      else if (target === 'edit_phone') ctx.session.orderForm.clientPhone = newValue;

      await ctx.reply('✅ Дані оновлено.');
      // Очищуємо маркер редагування
      delete ctx.wizard.state.editFieldTarget;

      // 🔥 ХАК: Повертаємо покажчик візарда назад на Крок 6 і викликаємо його вручну,
      // щоб показати оновлене резюме замовлення з новими кнопками!
      ctx.wizard.selectStep(6);
      return this.stepPrepareOrder(ctx);
    }

    // --- СЦЕНАРІЙ Б: Кліки по інлайн-кнопках ---
    // 1. Використовуємо Type Guard, щоб TypeScript знав, що це клік по інлайн-кнопці
    if (ctx.has('callback_query') && 'data' in ctx.callbackQuery) {
      const callbackData = ctx.callbackQuery.data;

      // 🔥 ФІКС 1: Викликаємо суворо типізований answerCbQuery через ctx.telegram
      await ctx.telegram.answerCbQuery(ctx.callbackQuery.id);

      // 1. Клік на головну кнопку "Редагувати дані"
      if (callbackData === 'order_edit_fields') {
        await ctx.editMessageReplyMarkup({inline_keyboard: []}).catch(() => null);

        const editMenu = [
          [Markup.button.callback('🏷️ Назва', 'edit_burial_displayName')],
          [Markup.button.callback('👤 Прізвище', 'edit_lastName'), Markup.button.callback('👤 Ім\'я', 'edit_name')],
          [Markup.button.callback('👤 По батькові', 'edit_father')],
          [Markup.button.callback('📅 Дата народження', 'edit_birth'), Markup.button.callback('🕯 Дата смерті', 'edit_death')],
          [Markup.button.callback('📍 Локація/Дані місця', 'edit_location'), Markup.button.callback('👁 Орієнтир', 'edit_cemeteryDetails')],
          [Markup.button.callback('💬 Коментар', 'edit_comment'), Markup.button.callback('📱 Телефон', 'edit_phone')],
          [Markup.button.callback('↩️ Назад до перевірки', 'edit_back_to_summary')]
        ];

        await ctx.reply('Оберіть, яке саме поле ви бажаєте виправити:', {
          reply_markup: Markup.inlineKeyboard(editMenu).reply_markup
        });
        return; // Залишаємось на 7 кроці, чекаємо вибору поля
      }

      // 2. Повернення з підменю назад без змін
      if (callbackData === 'edit_back_to_summary') {
        await ctx.editMessageReplyMarkup({inline_keyboard: []}).catch(() => null);
        ctx.wizard.selectStep(6);
        return (this as any).stepPrepareOrder(ctx);
      }

      // 3. Обробка вибору конкретного поля для зміни
      if (callbackData.startsWith('edit_')) {
        await ctx.editMessageReplyMarkup({inline_keyboard: []}).catch(() => null);

        // Фіксуємо у стані візарду, що саме редагуємо
        ctx.wizard.state.editFieldTarget = callbackData;

        let promptText = '✍️ Введіть нове значення:';

        if (callbackData === 'edit_burial_displayName') promptText = '✍️ Введіть нову <b>Назву</b> для картки поховання (наприклад: <i>"Могила дідуся"</i>):';
        else if (callbackData === 'edit_lastName') promptText = '✍️ Введіть нове <b>Прізвище</b> померлого:';
        else if (callbackData === 'edit_name') promptText = '✍️ Введіть нове <b>Ім\'я</b> померлого:';
        else if (callbackData === 'edit_father') promptText = '✍️ Введіть нове <b>По батькові</b> померлого:';
        else if (callbackData === 'edit_birth') promptText = '✍️ Введіть <b>Дату народження</b> (строкою):';
        else if (callbackData === 'edit_death') promptText = '✍️ Введіть <b>Дату смерті</b> (строкою):';
        else if (callbackData === 'edit_location') promptText = '✍️ Введіть нову <b>Локацію/Адресу місця</b> або надішліть посилання на карту:';
        else if (callbackData === 'edit_cemeteryDetails') promptText = '✍️ Введіть новий <b>Орієнтир місця</b> (наприклад: <i>"біля центральної алеї, сектор 4"</i>):';
        else if (callbackData === 'edit_comment') promptText = '✍️ Введіть новий <b>коментар</b> до замовлення:';
        else if (callbackData === 'edit_phone') promptText = '✍️ Введіть ваш новий <b>номер телефону</b>:';

        await ctx.reply(promptText, {parse_mode: 'HTML'});
        return; // Залишаємось на 7 кроці, чекаємо текст від користувача
      }

      if (callbackData === 'confirm_order_save') {
        // Передаємо порожній inlineKeyboard, щоб кнопки миттєво зникли
        await ctx.editMessageReplyMarkup({inline_keyboard: []}).catch(() => null);

        await ctx.reply(OrderStepUa.SavingOrder);

        const state = ctx.session.orderForm;
        const telegramId = ctx.from.id.toString();

        try {
          if (state?.burialId) {
            await this.burialsService.updateBurial(state.burialId, {
              name: state.burialDisplayName,
              burialLastName: state.burialLastName,
              burialName: state.burialName,
              burialFatherName: state.burialFatherName,
              cemetery: state.locationType === 'address_text' ? state.locationData : undefined,
              coordinates: state.locationType === 'coordinates' ? state.locationData : undefined,
              birthDate: state.burialBirthDate,
              deathDate: state.burialDeathDate,
              notes: state.cemeteryDetails,
            }).catch(err => console.log('Помилка оновлення картки поховання:', err));
          }

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
        await ctx.editMessageReplyMarkup({inline_keyboard: []}).catch(() => null);
        await ctx.reply(OrderStepUa.OrderCanceled, Markup.removeKeyboard(),);
      }
    } else {
      // Якщо користувач замість кліку по кнопці просто надіслав текст на етапі підтвердження
      await ctx.reply(OrderStepUa.HintChooseMenu);
      return;
    }

    await showMainMenu(ctx);
    return ctx.scene.leave();
  }

  private async sendOrderToAdmin(orderId: string, state: OrderForm, telegramId: string) {
    const ADMIN_BOT_CHAT_ID = process.env.TELEGRAM_ADMIN_CHAT_ID || '';
    const burialData = await this.burialsService.findBurialById(state.burialId);

    // Форматер для відображення дат анкети
    // const dateFormatter = new Intl.DateTimeFormat('uk-UA', {
    //   day: '2-digit',
    //   month: '2-digit',
    //   year: 'numeric',
    // });

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

      // const birthStr = burialData.birthDate ? dateFormatter.format(new Date(burialData.birthDate)) : 'Невідомо';
      // const deathStr = burialData.deathDate ? dateFormatter.format(new Date(burialData.deathDate)) : 'Невідомо';
      const birthStr = burialData.birthDate ?? 'Невідомо';
      const deathStr = burialData.deathDate ?? 'Невідомо';

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

  private async showServiceDescription(
    ctx: OrderWizardContext,
    callbackData: string,
  ) {
    const callbackQuery = ctx.callbackQuery;
    const serviceId = callbackData.replace('client_service_desc_', '');
    if (!callbackQuery) {
      return
    }
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
        await ctx.answerCbQuery(OrderStepUa.NotFoundDescription, {show_alert: true});
      }

    } catch (error) {
      console.error(error);
      await ctx.answerCbQuery(OrderStepUa.ErrorLoadDescription, {show_alert: true}).catch(() => null);
    }
  }

}
