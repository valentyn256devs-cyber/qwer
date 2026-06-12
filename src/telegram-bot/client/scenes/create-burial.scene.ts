import {Ctx, Wizard, WizardStep} from 'nestjs-telegraf';
import {Markup} from 'telegraf';
import {BurialsService} from '../../../burials/burials.service';
import {type OrderWizardContext, OrderWizardSession} from "../interfaces/order-wizard-context.interface";
import {BurialMenu, mainMenuButtons, OrderStepUa, Scene, showMainMenu, Step} from "../../telegram-constants";

@Wizard(Scene.CREATE_BURIAL_WIZARD)
export class CreateBurialScene {
  constructor(private readonly burialsService: BurialsService) {
  }

  /**
   * КРОК 1: Довільна назва для розпізнавання
   */
  @WizardStep(1)
  async step1(@Ctx() ctx: OrderWizardContext) {
    await ctx.reply(Step.Step2, {parse_mode: 'HTML'});

    await ctx.reply(
      OrderStepUa.HintBurialLocation,
      {parse_mode: 'HTML', reply_markup: Markup.removeKeyboard().reply_markup}
    );
    ctx.wizard.next();
  }

  /**
   * КРОК 2: Прізвище померлого
   */
  @WizardStep(2)
  async step2(@Ctx() ctx: OrderWizardContext) {
    if (ctx.message && 'text' in ctx.message) {
      ctx.wizard.state.burialTemp = {name: ctx.message.text};
      await ctx.reply(OrderStepUa.HintBurialLastName, {parse_mode: 'HTML'});
      ctx.wizard.next();
    } else {
      await ctx.reply(OrderStepUa.HintEnterText);
    }
  }

  /**
   * КРОК 3: Ім'я померлого
   */
  @WizardStep(3)
  async step3(@Ctx() ctx: OrderWizardContext) {
    if (ctx.message && 'text' in ctx.message) {
      if (!ctx.wizard.state.burialTemp) {
        ctx.wizard.state.burialTemp = {};
      }

      ctx.wizard.state.burialTemp.burialLastName = ctx.message.text;
      await ctx.reply(OrderStepUa.HintBurialName, {
        parse_mode: 'HTML',
      });
      ctx.wizard.next();
    }
  }

  /**
   * КРОК 4: По батькові
   */
  @WizardStep(4)
  async step4(@Ctx() ctx: OrderWizardContext) {
    if (ctx.message && 'text' in ctx.message) {
      if (!ctx.wizard.state.burialTemp) {
        ctx.wizard.state.burialTemp = {};
      }

      ctx.wizard.state.burialTemp.burialName = ctx.message.text;
      await ctx.reply(OrderStepUa.HintBurialFatherName, {
        parse_mode: 'HTML',
        reply_markup: Markup.keyboard([[OrderStepUa.Skip]]).resize().oneTime().reply_markup,
      });
      ctx.wizard.next();
    }
  }

  /**
   * КРОК 5: Дата народження (з можливістю пропустити)
   */
  @WizardStep(5)
  async step5(@Ctx() ctx: OrderWizardContext) {
    if (ctx.message && 'text' in ctx.message) {
      if (!ctx.wizard.state.burialTemp) {
        ctx.wizard.state.burialTemp = {};
      }

      if (ctx.message.text === OrderStepUa.Skip) {
        ctx.wizard.state.burialTemp.burialFatherName = '';
      } else ctx.wizard.state.burialTemp.burialFatherName = ctx.message.text;

      await ctx.reply(
        OrderStepUa.HintBurialDateBirthday,
        {
          parse_mode: 'HTML',
          reply_markup: Markup.keyboard([[OrderStepUa.Skip]]).resize().oneTime().reply_markup,
        }
      );
      ctx.wizard.next();
    }
  }

  /**
   * КРОК 6: Дата смерті (з можливістю пропустити)
   */
  @WizardStep(6)
  async step6(@Ctx() ctx: OrderWizardContext) {
    if (ctx.message && 'text' in ctx.message) {
      if (!ctx.wizard.state.burialTemp) {
        ctx.wizard.state.burialTemp = {};
      }

      const text = ctx.message.text;
      if (text !== OrderStepUa.Skip) {

        ctx.wizard.state.burialTemp.birthDate = text; //this.parseDate(text);
      } else {
        ctx.wizard.state.burialTemp.birthDate = ''; //this.parseDate(text);
        // await ctx.reply(OrderStepUa.HintBurialDateMMYYYY, { parse_mode: 'HTML' });
        // return;
      }

      await ctx.reply(
        OrderStepUa.HintBurialDateDied,
        {
          parse_mode: 'HTML',
          reply_markup: Markup.keyboard([[OrderStepUa.Skip]]).resize().oneTime().reply_markup,
        }
      );
      ctx.wizard.next();
    }
  }

  /**
   * КРОК 7: Назва кладовища
   */
  @WizardStep(7)
  async step7(@Ctx() ctx: OrderWizardContext) {
    if (ctx.message && 'text' in ctx.message) {
      if (!ctx.wizard.state.burialTemp) {
        ctx.wizard.state.burialTemp = {};
      }
      const text = ctx.message.text;
      if (text !== OrderStepUa.Skip) {
        ctx.wizard.state.burialTemp.deathDate = text;
      } else {
        ctx.wizard.state.burialTemp.deathDate = '';
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

      ctx.wizard.next();
    }
  }

  /**
   * КРОК 3: Очікування вибору варіанту і підказка як ввести дані
   */
  @WizardStep(8)
  async stepGeoLocation(@Ctx() ctx: OrderWizardContext) {
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
        OrderStepUa.SendYourLocation,
        Markup.keyboard([
          [Markup.button.locationRequest(OrderStepUa.SendMyLocation)],
        ]).resize(),
      );
    } else if (text === BurialMenu.GoogleMap) {
      ctx.session.orderForm.locationType = 'google_maps';
      await ctx.reply(
        OrderStepUa.HintGoogleMap,
        {parse_mode: 'HTML', reply_markup: Markup.removeKeyboard().reply_markup}
      );
    } else {
      ctx.session.orderForm.locationType = 'address_text';
      await ctx.reply(
        OrderStepUa.HintFullLocation,
        {parse_mode: 'HTML', reply_markup: Markup.removeKeyboard().reply_markup}
      );
    }
    ctx.wizard.next();
  }

  /**
   * КРОК 4: Запис локації та перехід до Опису завдання / Коментаря
   */
  @WizardStep(9)
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
  @WizardStep(10)
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
        reply_markup: Markup.keyboard([[OrderStepUa.Skip]]).resize().oneTime().reply_markup,
      },
    );

    ctx.wizard.next();
  }

  @WizardStep(11)
  async stepAdditionalInfo(@Ctx() ctx: OrderWizardContext) {
    if (ctx.message && 'text' in ctx.message) {
      if (!ctx.session.orderForm) {
        ctx.session.orderForm = {};
      }
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
  @WizardStep(12)
  async saving(@Ctx() ctx: OrderWizardContext) {
    if (ctx.message && 'text' in ctx.message) {
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
  }
}