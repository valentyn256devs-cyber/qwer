import {Ctx, Wizard, WizardStep} from 'nestjs-telegraf';
import {Markup} from 'telegraf';
import {BurialsService} from '../../../burials/burials.service';
import {type OrderWizardContext, OrderWizardSession} from "../interfaces/order-wizard-context.interface";
import {BurialMenu, mainMenuButtons, OrderStepUa, Scene, showMainMenu, Step} from "../../telegram-constants";

enum CreateBurialStep {
  Start = 1,
  ActionChoose = 2,
  ConfirmExistingBurial = 3,
  CreateBurial = 4,
  EnterLastName = 5,
  EnterName = 6,
  EnterFatherName = 7,
  EnterBirthDay = 8,
  EnterDiedDay = 9,
  ActionChooseLocation = 10,
  EnterCoordinates = 11,
  EnterLocation = 12,
  AdditionalInfo = 13,
  Saving = 14
}

@Wizard(Scene.CREATE_BURIAL_WIZARD)
export class CreateBurialScene {
  constructor(private readonly burialsService: BurialsService) {
  }

  @WizardStep(CreateBurialStep.Start)
  async step1(@Ctx() ctx: OrderWizardContext) {
    if (!ctx.session.orderForm) {
      ctx.session.orderForm = {};
    }

    await ctx.reply('✨ <b>Оберіть дію для продовження:</b>', {
      parse_mode: 'HTML',
      reply_markup: Markup.inlineKeyboard([
        [Markup.button.callback('➕ Додати нове місце', 'burial_action_create')],
        [Markup.button.callback('🔍 Обрати існуюче місце', 'burial_action_select_existing')],
      ]).reply_markup,
    });

    ctx.wizard.next(); // Переходимо на Крок 2, який буде слухати кліки цих кнопок
  }

  /**
   * КРОК 2: Обробка вибору користувача (Хаб розгалуження)
   */
  @WizardStep(CreateBurialStep.ActionChoose)
  async stepHandleActionChoice(@Ctx() ctx: OrderWizardContext) {
    if (!ctx.has('callback_query') || !('data' in ctx.callbackQuery)) {
      await ctx.reply('Будь ласка, оберіть один з варіантів на кнопках 👆');
      return;
    }

    const callbackData = ctx.callbackQuery.data;
    await ctx.telegram.answerCbQuery(ctx.callbackQuery.id).catch(() => null);
    await ctx.deleteMessage().catch(() => null);

    // СЦЕНАРІЙ А: Користувач хоче створити нове місце
    if (callbackData === 'burial_action_create') {
      await this.onCreateBurial.call(this, ctx).catch(() => null);
      return;
    }

    // СЦЕНАРІЙ Б: Користувач хоче обрати існуюче місце
    if (callbackData === 'burial_action_select_existing') {
      const telegramId = ctx.from.id.toString();

      try {
        // Викликаємо твій метод (за замовчуванням includeDeleted = false)
        const burials = await this.burialsService.findByTelegramId(telegramId);

        if (!burials || burials.length === 0) {
          await ctx.reply('📭 У вас ще немає збережених місць пам\'яті. Давайте створимо нове!');
          return await this.onCreateBurial.call(this, ctx).catch(() => null);
        }

        // Формуємо список кнопок для існуючих місць
        const buttons = burials.map((b) => {
          const name = b.name || `${b.burialLastName} ${b.burialName}`.trim() || 'Без назви';
          return [Markup.button.callback(`🪦 ${name}`, `select_burial_id_${b.id}`)];
        });

        // Додаємо кнопку повернення на початок, якщо передумав
        buttons.push([Markup.button.callback('↩️ Назад до вибору', 'burial_back_to_hub')]);

        await ctx.reply('📋 <b>Ваші збережені місця пам\'яті:</b>\nОберіть потрібне зі списку нижче:', {
          parse_mode: 'HTML',
          reply_markup: Markup.inlineKeyboard(buttons).reply_markup,
        });

        // Переводимо візард на Крок 3, де будемо ловити ID обраного місця
        ctx.wizard.selectStep(2); // Індекс 2 — це Крок 3
        return;
      } catch (error) {
        console.error(error);
        await ctx.reply('❌ Помилка при завантаженні ваших місць пам\'яті.');
        ctx.wizard.selectStep(0);
        return await this.step1.call(this, ctx).catch(() => null);
      }
    }
  }

  /**
   * КРОК 3: Обробка вибору конкретного існуючого місця
   */
  @WizardStep(CreateBurialStep.ConfirmExistingBurial)
  async stepConfirmExistingBurial(@Ctx() ctx: OrderWizardContext) {
    if (!ctx.has('callback_query') || !('data' in ctx.callbackQuery)) {
      await ctx.reply('Будь ласка, оберіть місце зі списку вище 👆');
      return;
    }

    const callbackData = ctx.callbackQuery.data;
    await ctx.telegram.answerCbQuery(ctx.callbackQuery.id).catch(() => null);
    await ctx.deleteMessage().catch(() => null);

    // Якщо користувач натиснув кнопку "Назад до вибору" всередині списку
    if (callbackData === 'burial_back_to_hub') {
      ctx.wizard.selectStep(0); // Повертаємо на самий початок
      return await this.step1.call(this, ctx).catch(() => null);
    }

    // Якщо прийшов ID обраного місця
    if (callbackData.startsWith('select_burial_id_')) {
      const chosenBurialId = callbackData.replace('select_burial_id_', '');

      if (!ctx.session.orderForm) {
        ctx.session.orderForm = {};
      }

      // Зберігаємо обраний burialId у форму сесії!
      ctx.session.orderForm.burialId = chosenBurialId;

      // Завантажуємо деталі, щоб підтягнути назву/дані для форми
      try {
        const b = await this.burialsService.findOne(chosenBurialId);
        ctx.session.orderForm.burialDisplayName = b?.name ?? '';
        ctx.session.orderForm.burialLastName = b.burialLastName ?? undefined;
        ctx.session.orderForm.burialName = b?.burialName ?? undefined;
        ctx.session.orderForm.burialFatherName = b?.burialFatherName ?? undefined;
        ctx.session.orderForm.burialBirthDate = b?.birthDate ?? undefined;
        ctx.session.orderForm.burialDeathDate = b?.deathDate ?? undefined;

        ctx.session.orderForm.locationData = b.coordinates;
        ctx.session.orderForm.cemeteryDetails = b.cemetery;
        ctx.session.orderForm.customComment = b.notes;

        // при поверненні - відразу обираємо телефон та створюємо заявку
        const orderSession = ctx.session.__scenes?.state as OrderWizardSession;
        if (orderSession) {
          ctx.session.pendingBurial = {
            id: b.id,
            displayName: b.name ?? '',
            burialLastName: b.burialLastName ?? undefined,
            burialName: b.burialName ?? undefined,
            burialFatherName: b.burialFatherName ?? undefined,
            birthDate: b.birthDate ?? undefined,
            deathDate: b.deathDate ?? undefined,
          }
        }

        await ctx.reply(`✅ <b>Місце успішно обрано:</b> "${b.name || 'Без назви'}"`, {parse_mode: 'HTML'});

        // Повертаємо користувача назад в сцену замовлення
        await ctx.scene.enter(Scene.CREATE_ORDER_WIZARD);
      } catch (e) {
        await ctx.reply('❌ Не вдалося завантажити дані цього місця.');
        ctx.wizard.selectStep(0);
        return await this.step1.call(this, ctx).catch(() => null);
      }
    }
  }

  /**
   * КРОК 1: Довільна назва для розпізнавання
   */
  async onCreateBurial(ctx: OrderWizardContext) {
    await ctx.reply(Step.Step2, {parse_mode: 'HTML'});

    await ctx.reply(
      OrderStepUa.HintBurialLocation,
      {
        parse_mode: 'HTML',
        reply_markup: Markup.inlineKeyboard([
          [Markup.button.callback(OrderStepUa.GoBack, 'back_to_previous_step')],
        ]).reply_markup,
      }
    );
    // ctx.wizard.next();
    ctx.wizard.selectStep(3);
  }

  /**
   * КРОК 2: Прізвище померлого
   */
  @WizardStep(CreateBurialStep.CreateBurial)
  async stepCreateBurial(@Ctx() ctx: OrderWizardContext) {
    if (await this.handleBackAction(ctx, 0, ctx.scene.leave)) {
      delete ctx.session.orderForm;
      await showMainMenu(ctx);
      return ctx.scene.leave();
    }

    if (ctx.message && 'text' in ctx.message) {
      ctx.wizard.state.burialTemp = {name: ctx.message.text};
      await ctx.reply(OrderStepUa.HintBurialLastName, {
        parse_mode: 'HTML',
        reply_markup: Markup.inlineKeyboard([
          [Markup.button.callback(OrderStepUa.GoBack, 'back_to_previous_step')],
        ]).reply_markup,
      });
      ctx.wizard.next();
    } else {
      await ctx.reply(OrderStepUa.HintEnterText);
    }
  }

  /**
   * КРОК 3: Ім'я померлого
   */
  @WizardStep(CreateBurialStep.EnterLastName)
  async stepLastName(@Ctx() ctx: OrderWizardContext) {
    if (await this.handleBackAction(ctx, CreateBurialStep.Start - 1, this.step1)) { // переходимо на ввод даних місця поховання
      return;
    }

    if (ctx.message && 'text' in ctx.message) {
      if (!ctx.wizard.state.burialTemp) {
        ctx.wizard.state.burialTemp = {};
      }

      ctx.wizard.state.burialTemp.burialLastName = ctx.message.text;
      await ctx.reply(OrderStepUa.HintBurialName, {
        parse_mode: 'HTML',
        reply_markup: Markup.inlineKeyboard([
          [Markup.button.callback(OrderStepUa.GoBack, 'back_to_previous_step')],
        ]).reply_markup,
      });
      ctx.wizard.next();
    }
  }

  /**
   * КРОК 4: По батькові
   */
  @WizardStep(CreateBurialStep.EnterName)
  async stepName(@Ctx() ctx: OrderWizardContext) {
    if (await this.handleBackAction(
      ctx,
      CreateBurialStep.EnterLastName - 1,
      this.stepLastName,
      async () => {
        await ctx.reply(OrderStepUa.HintBurialLastName, {
          parse_mode: 'HTML',
          reply_markup: Markup.inlineKeyboard([
            [Markup.button.callback(OrderStepUa.GoBack, 'back_to_previous_step')],
          ]).reply_markup,
        });
      },
    )) { // переходимо на ввод даних фамілії
      return;
    }

    if (ctx.message && 'text' in ctx.message) {
      if (!ctx.wizard.state.burialTemp) {
        ctx.wizard.state.burialTemp = {};
      }

      ctx.wizard.state.burialTemp.burialName = ctx.message.text;
      await ctx.reply(OrderStepUa.HintBurialFatherName, {
        parse_mode: 'HTML',
        // reply_markup: Markup.keyboard([[OrderStepUa.Skip]]).resize().oneTime().reply_markup,
        reply_markup: Markup.inlineKeyboard([
          [Markup.button.callback(OrderStepUa.Skip, 'skip_father_name')],
          [Markup.button.callback(OrderStepUa.GoBack, 'back_to_previous_step')],
        ]).reply_markup,
      });
      ctx.wizard.next();
    }
  }

  /**
   * КРОК 5: Дата народження (з можливістю пропустити)
   */
  @WizardStep(CreateBurialStep.EnterFatherName)
  async stepFatherName(@Ctx() ctx: OrderWizardContext) {
    if (await this.handleBackAction(
      ctx,
      CreateBurialStep.EnterName - 1,
      this.stepName,
      async () => {
        await ctx.reply(OrderStepUa.HintBurialName, {
          parse_mode: 'HTML',
          reply_markup: Markup.inlineKeyboard([
            [Markup.button.callback(OrderStepUa.GoBack, 'back_to_previous_step')],
          ]).reply_markup,
        });
      }
    )) {
      return;
    }

    if (!ctx.wizard.state.burialTemp) {
      ctx.wizard.state.burialTemp = {};
    }

    // 🔥 Видаляємо кнопку «Пропустити» у попередньому повідомленні, щоб юзер не тицьнув двічі
    await ctx.editMessageReplyMarkup({inline_keyboard: []}).catch(() => null);

    if (ctx.has('callback_query') &&
      'data' in ctx.callbackQuery &&
      ctx.callbackQuery.data === 'skip_father_name') {
      await ctx.telegram.answerCbQuery(ctx.callbackQuery.id);
      ctx.wizard.state.burialTemp.burialFatherName = '';

      await ctx.reply(
        OrderStepUa.HintBurialDateBirthday,
        {
          parse_mode: 'HTML',
          // reply_markup: Markup.keyboard([[OrderStepUa.Skip]]).resize().oneTime().reply_markup,
          reply_markup: Markup.inlineKeyboard([
            [Markup.button.callback(OrderStepUa.Skip, 'skip_birth_date')],
            [Markup.button.callback(OrderStepUa.GoBack, 'back_to_previous_step')],
          ]).reply_markup,
        }
      );
      ctx.wizard.next();
    } else if (ctx.message && 'text' in ctx.message) {
      if (ctx.message.text === OrderStepUa.Skip) {
        ctx.wizard.state.burialTemp.burialFatherName = '';
      } else ctx.wizard.state.burialTemp.burialFatherName = ctx.message.text;

      await ctx.reply(
        OrderStepUa.HintBurialDateBirthday,
        {
          parse_mode: 'HTML',
          // reply_markup: Markup.keyboard([[OrderStepUa.Skip]]).resize().oneTime().reply_markup,
          reply_markup: Markup.inlineKeyboard([
            [Markup.button.callback(OrderStepUa.Skip, 'skip_birth_date')],
            [Markup.button.callback(OrderStepUa.GoBack, 'back_to_previous_step')],
          ]).reply_markup,
        }
      );
      ctx.wizard.next();
    }
  }

  /**
   * КРОК 6: Дата смерті (з можливістю пропустити)
   */
  @WizardStep(CreateBurialStep.EnterBirthDay)
  async stepBirthDay(@Ctx() ctx: OrderWizardContext) {
    if (await this.handleBackAction(
      ctx,
      CreateBurialStep.EnterFatherName - 1,
      this.stepFatherName,
      async () => {
        await ctx.reply(OrderStepUa.HintBurialFatherName, {
          parse_mode: 'HTML',
          reply_markup: Markup.inlineKeyboard([
            [Markup.button.callback(OrderStepUa.Skip, 'skip_father_name')],
            [Markup.button.callback(OrderStepUa.GoBack, 'back_to_previous_step')],
          ]).reply_markup,
        });
      },
    )) {
      return;
    }

    if (!ctx.wizard.state.burialTemp) {
      ctx.wizard.state.burialTemp = {};
    }

    // 🔥 Видаляємо кнопку «Пропустити» у попередньому повідомленні, щоб юзер не тицьнув двічі
    await ctx.editMessageReplyMarkup({inline_keyboard: []}).catch(() => null);

    if (ctx.has('callback_query') &&
      'data' in ctx.callbackQuery &&
      ctx.callbackQuery.data === 'skip_birth_date') {
      await ctx.telegram.answerCbQuery(ctx.callbackQuery.id);
      ctx.wizard.state.burialTemp.birthDate = '';

      await ctx.reply(
        OrderStepUa.HintBurialDateDied,
        {
          parse_mode: 'HTML',
          // reply_markup: Markup.keyboard([[OrderStepUa.Skip]]).resize().oneTime().reply_markup,
          reply_markup: Markup.inlineKeyboard([
            [Markup.button.callback(OrderStepUa.Skip, 'skip_death_date')],
            [Markup.button.callback(OrderStepUa.GoBack, 'back_to_previous_step')],
          ]).reply_markup,
        }
      );
      ctx.wizard.next();
    } else if (ctx.message && 'text' in ctx.message) {
      const text = ctx.message.text;
      if (text !== OrderStepUa.Skip) {
        ctx.wizard.state.burialTemp.birthDate = text;
      } else {
        ctx.wizard.state.burialTemp.birthDate = '';
      }

      await ctx.reply(
        OrderStepUa.HintBurialDateDied,
        {
          parse_mode: 'HTML',
          // reply_markup: Markup.keyboard([[OrderStepUa.Skip]]).resize().oneTime().reply_markup,
          reply_markup: Markup.inlineKeyboard([
            [Markup.button.callback(OrderStepUa.Skip, 'skip_death_date')],
            [Markup.button.callback(OrderStepUa.GoBack, 'back_to_previous_step')],
          ]).reply_markup,
        }
      );
      ctx.wizard.next();
    }
  }

  /**
   * КРОК 7: Назва кладовища
   */
  @WizardStep(CreateBurialStep.EnterDiedDay)
  async stepDiedDate(@Ctx() ctx: OrderWizardContext) {
    if (await this.handleBackAction(
      ctx,
      CreateBurialStep.EnterBirthDay - 1,
      this.stepBirthDay,
      async () => {
        await ctx.reply(
          OrderStepUa.HintBurialDateBirthday,
          {
            parse_mode: 'HTML',
            reply_markup: Markup.inlineKeyboard([
              [Markup.button.callback(OrderStepUa.Skip, 'skip_birth_date')],
              [Markup.button.callback(OrderStepUa.GoBack, 'back_to_previous_step')],
            ]).reply_markup,
          }
        );
      }
    )) {
      return;
    }

    if (!ctx.wizard.state.burialTemp) {
      ctx.wizard.state.burialTemp = {};
    }

    // 🔥 Видаляємо кнопку «Пропустити» у попередньому повідомленні, щоб юзер не тицьнув двічі
    await ctx.editMessageReplyMarkup({inline_keyboard: []}).catch(() => null);

    if (ctx.has('callback_query') &&
      'data' in ctx.callbackQuery &&
      ctx.callbackQuery.data === 'skip_death_date') {
      await ctx.telegram.answerCbQuery(ctx.callbackQuery.id);
      ctx.wizard.state.burialTemp.deathDate = '';
    } else if (ctx.message && 'text' in ctx.message) {
      if (!ctx.wizard.state.burialTemp) {
        ctx.wizard.state.burialTemp = {};
      }
      const text = ctx.message.text;
      if (text !== OrderStepUa.Skip) {
        ctx.wizard.state.burialTemp.deathDate = text;
      } else {
        ctx.wizard.state.burialTemp.deathDate = '';
      }
    }

    // 4. Виводимо клавіатуру вибору локації за ТЗ
    await ctx.reply(Step.Step3, {
      parse_mode: 'HTML',
      reply_markup: Markup.keyboard([
        [BurialMenu.Geo, BurialMenu.GoogleMap],
        [BurialMenu.Text, BurialMenu.City],

        [Markup.button.callback(OrderStepUa.GoBack, 'back_to_previous_step')],
      ])
        .oneTime()
        .resize().reply_markup,
    });

    ctx.wizard.next();
  }

  /**
   * КРОК 3: Очікування вибору варіанту і підказка як ввести дані
   */
  @WizardStep(CreateBurialStep.ActionChooseLocation)
  async stepGeoLocation(@Ctx() ctx: OrderWizardContext) {
    if (await this.handleBackAction(ctx, CreateBurialStep.EnterDiedDay - 1, this.stepDiedDate)) {
      return;
    }

    // eslint-disable-next-line @typescript-eslint/ban-ts-comment
    // @ts-ignore
    const text = ctx.message && 'text' in ctx.message ? ctx.message.text : undefined;

    // Якщо користувач прислав не текст, або текст не з кнопок меню
    const validButtons: string[] = [
      BurialMenu.Geo, BurialMenu.GoogleMap,
      BurialMenu.Text, BurialMenu.City
    ];

    if (!text || !validButtons.includes(text)) {
      await ctx.reply(OrderStepUa.ChooseMenu);
      return; // 🛑 ЗУПИНЯЄМО ФЛОУ. Користувач залишається на цьому кроці, поки не натисне кнопку.
    }

    if (!ctx.session.orderForm) {
      ctx.session.orderForm = {};
    }

    if (text === BurialMenu.Geo) {
      ctx.session.orderForm.locationType = 'coordinates';

      await ctx.reply(
        OrderStepUa.SendYourLocation, {
          reply_markup: Markup.keyboard([
            [Markup.button.locationRequest(OrderStepUa.SendMyLocation)],
            [Markup.button.text(OrderStepUa.GoBack)], // 🌟 Звичайна текстова кнопка замість callback
          ]).resize().reply_markup,
        }
      );
    } else if (text === BurialMenu.GoogleMap) {
      ctx.session.orderForm.locationType = 'google_maps';
      await ctx.reply(
        OrderStepUa.HintGoogleMap,
        {
          parse_mode: 'HTML',
          reply_markup:
          Markup.inlineKeyboard([
            [Markup.button.callback(OrderStepUa.GoBack, 'back_to_previous_step')],
          ]).reply_markup,
          // Markup.removeKeyboard().reply_markup
        }
      );
    } else {
      ctx.session.orderForm.locationType = 'address_text';
      await ctx.reply(
        OrderStepUa.HintFullLocation,
        {
          parse_mode: 'HTML',
          reply_markup: Markup.inlineKeyboard([
            [Markup.button.callback(OrderStepUa.GoBack, 'back_to_previous_step')],
          ]).reply_markup,
          // Markup.removeKeyboard().reply_markup
        }
      );
    }
    ctx.wizard.next();
  }

  /**
   * КРОК 4: Запис локації та перехід до Опису завдання / Коментаря
   */
  @WizardStep(CreateBurialStep.EnterCoordinates)
  async stepCoordinates(@Ctx() ctx: OrderWizardContext) {
    if (await this.handleBackAction(ctx, CreateBurialStep.EnterDiedDay - 1, this.stepDiedDate)) {
      return;
    }

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
    if (ctx.session.orderForm.locationType === 'coordinates') {
      if ('location' in msg) {
        ctx.session.orderForm.locationData = `${msg.location.latitude},${msg.location.longitude}`;
      } else {
        // 🔥 ФІКС: Якщо тип «координати», але юзер надіслав текст/стрікер/картинку замість кнопки геопозиції
        await ctx.reply('⚠️ Будь ласка, надішліть саме вашу геолокацію через кнопку «Поділитися локацією».');
        return; // 🛑 Зупиняємо флоу, користувач залишається на цьому кроці
      }
    }
    // 3. Безпечно перевіряємо наявність тексту (Варіанти 1, 3, 4 з ТЗ)
    else if ('text' in msg && msg.text) {
      ctx.session.orderForm.locationData = msg.text;
    } else { // 4. Якщо прийшов не той тип даних (наприклад, користувач замість локації скинув стікер)
      await ctx.reply(OrderStepUa.IncorrectLocationFormat);
      return;
    }

    const cleanUpMsg = await ctx.reply('⏳ Обробка локації...', Markup.removeKeyboard());
    // (Опціонально) Щоб цей технічний рядок не муляв око в чаті, його можна одразу видалити:
    await ctx.telegram.deleteMessage(ctx.chat?.id ?? '', cleanUpMsg.message_id).catch(() => null);

    //
    await ctx.reply(
      OrderStepUa.HintDescriptionBurialPlace,
      {
        parse_mode: 'HTML',
        reply_markup: Markup.inlineKeyboard([
          [Markup.button.callback(OrderStepUa.Skip, 'skip_burial_description')],
          [Markup.button.callback(OrderStepUa.GoBack, 'back_to_previous_step')],
        ]).reply_markup,
      }
    );

    ctx.wizard.next();
  }

  /**
   * Додаткові візуальні орієнтири
   * Цей крок є необов'язковим, його можна пропустити.
   */
  @WizardStep(CreateBurialStep.EnterLocation)
  async stepBurialDescription(@Ctx() ctx: OrderWizardContext) {
    // 1. Обробка першого входу на цей крок
    if (!ctx.session.orderForm) {
      ctx.session.orderForm = {};
    }

    // 🔥 Видаляємо кнопку «Пропустити» у попередньому повідомленні, щоб юзер не тицьнув двічі
    await ctx.editMessageReplyMarkup({inline_keyboard: []}).catch(() => null);

    // Перевіряємо, чи ми щойно зайшли сюди з попереднього кроку (коли користувач ввів локацію)
    // Якщо в повідомленні лежать дані локації або текст кнопки вибору, ми показуємо інструкцію для орієнтирів
    const msg = ctx.message;

    // Сценарій А: Користувач натиснув інлайн-кнопку "Пропустити"
    if (ctx.has('callback_query') &&
      'data' in ctx.callbackQuery &&
      ctx.callbackQuery.data === 'skip_burial_description') {
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
        // reply_markup: Markup.keyboard([[OrderStepUa.Skip]]).resize().oneTime().reply_markup,
        reply_markup: Markup.inlineKeyboard([
          [Markup.button.callback(OrderStepUa.Skip, 'skip_additional_info')],
          [Markup.button.callback(OrderStepUa.GoBack, 'back_to_previous_step')],
        ]).reply_markup,
      },
    );

    ctx.wizard.next();
  }

  @WizardStep(CreateBurialStep.AdditionalInfo)
  async stepAdditionalInfo(@Ctx() ctx: OrderWizardContext) {
    await ctx.editMessageReplyMarkup({inline_keyboard: []}).catch(() => null);
    if (!ctx.session.orderForm) {
      ctx.session.orderForm = {};
    }

    // 🔥 Видаляємо кнопку «Пропустити» у попередньому повідомленні, щоб юзер не тицьнув двічі
    await ctx.editMessageReplyMarkup({inline_keyboard: []}).catch(() => null);

    if (ctx.has('callback_query') &&
      'data' in ctx.callbackQuery &&
      ctx.callbackQuery.data === 'skip_additional_info') {
      await ctx.telegram.answerCbQuery(ctx.callbackQuery.id);
      ctx.session.orderForm.customComment = '';
    } else if (ctx.message && 'text' in ctx.message) {
      const text = ctx.message.text;
      if (text !== OrderStepUa.Skip) {
        ctx.session.orderForm.customComment = ctx.message.text;
      } else ctx.session.orderForm.customComment = '';
    }

    await ctx.reply(OrderStepUa.SaveBurial, {
      parse_mode: 'HTML',
      reply_markup: Markup.removeKeyboard().reply_markup,
    });

    ctx.wizard.next();
    return this.saving(ctx);
  }

  /**
   * КРОК 12: Фінал — збереження в Back4App
   */
  @WizardStep(CreateBurialStep.Saving)
  async saving(@Ctx() ctx: OrderWizardContext) {
    if (!ctx.wizard.state.burialTemp) {
      ctx.wizard.state.burialTemp = {};
    }

    if (!ctx.session.orderForm) {
      ctx.session.orderForm = {};
    }

    ctx.wizard.state.burialTemp.cemetery = ctx.session.orderForm.cemeteryDetails;
    ctx.wizard.state.burialTemp.comment = ctx.session.orderForm.customComment;
    ctx.wizard.state.burialTemp.location = ctx.session.orderForm.locationData;

    try {
      const temp = ctx.wizard.state.burialTemp;

      // Викликаємо BurialsService для реєстрації об'єкта
      const newBurial = await this.burialsService.create({
        name: temp.name ?? '',
        burialName: temp.burialName,
        burialLastName: temp.burialLastName,
        burialFatherName: temp.burialFatherName,
        birthDate: temp.birthDate,
        deathDate: temp.deathDate,
        cemetery: temp.cemetery,
        telegramId: ctx.from?.id.toString() ?? ctx.from?.username,
        coordinates: temp.location,
        notes: temp.comment ?? '',
      });

      if (ctx.session.orderForm.addBurialOnly) {
        await ctx.reply(`✅ Анкета про поховання "${newBurial.name}" успішно створено!`);
      } else {
        await ctx.reply(`✅ Анкета про поховання "${newBurial.name}" успішно створено! Повертаємось до оформлення заявки...`);
      }

      // 🔥 Записуємо ID поховання у батьківську сесію замовлення
      const orderSession = ctx.session.__scenes?.state as OrderWizardSession;
      if (orderSession) {
        ctx.session.pendingBurial = {
          id: newBurial.id,
          displayName: temp.name ?? '',
          burialLastName: temp.burialLastName,
          burialName: temp.burialName,
          burialFatherName: temp.burialFatherName,
          birthDate: temp.birthDate,
          deathDate: temp.deathDate,
        }
      }

      if (ctx.session.orderForm.addBurialOnly) { // якщо додаємо лише карту поховання
        delete ctx.session.orderForm;
        await showMainMenu(ctx);
        await ctx.scene.leave();
      } else {
        // Повертаємо користувача назад в сцену замовлення
        await ctx.scene.enter(Scene.CREATE_ORDER_WIZARD);
      }
    } catch (error) {
      console.error(error);
      await ctx.reply(OrderStepUa.ErrorSaveOrder);
      await ctx.reply(OrderStepUa.ReturnToMainMenu, {reply_markup: mainMenuButtons});
      await showMainMenu(ctx);
      return ctx.scene.leave();
    }
  }

  private async handleBackAction(
    ctx: OrderWizardContext,
    stepIndex: number,
    stepMethod: (ctx: OrderWizardContext) => Promise<any>,
    additionalAction?: (ctx: OrderWizardContext) => Promise<any>
  ): Promise<Boolean> {
    // 🌟 ПЕРЕВІРКА А: Натиснули інлайн-кнопку
    const isInlineBack = ctx.has('callback_query') && 'data' in ctx.callbackQuery && ctx.callbackQuery.data === 'back_to_previous_step';
    // 🌟 ПЕРЕВІРКА Б: Натиснули нижню текстову кнопку
    const isTextBack = ctx.message && 'text' in ctx.message && ctx.message.text === OrderStepUa.GoBack;

    if (isInlineBack || isTextBack) {
      if (isInlineBack) {
        // 1. Відповідаємо на кнопку, щоб вона не "зависала"
        await ctx.telegram.answerCbQuery(ctx.callbackQuery.id).catch(() => null);
        // 2. Видаляємо inline-кнопки
        await ctx.editMessageReplyMarkup({inline_keyboard: []}).catch(() => null);
        // очистить команду
        ctx.callbackQuery.data = '';
      } else if (isTextBack) {
        ctx.message.text = '';
        await ctx.reply('⏳ Повернення...', Markup.removeKeyboard()).catch(() => null);
      }
      // 3. Змінюємо покажчик кроку в самому візарді
      ctx.wizard.selectStep(stepIndex);

      if (additionalAction) {
        await additionalAction.call(this, ctx).catch(() => null);
      }

      // 4. Викликаємо логіку потрібного кроку заново
      await stepMethod.call(this, ctx).catch(() => null);
      return true;
    }
    return false;
  }

}