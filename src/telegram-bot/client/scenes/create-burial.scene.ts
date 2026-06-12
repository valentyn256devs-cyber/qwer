import { Wizard, WizardStep, Ctx } from 'nestjs-telegraf';
import { Markup } from 'telegraf';
import { BurialsService } from '../../../burials/burials.service';
import {type OrderWizardContext, OrderWizardSession} from "../interfaces/order-wizard-context.interface";
import {mainMenuButtons, OrderStepUa, Scene, Step} from "../../telegram-constants";

@Wizard(Scene.CREATE_BURIAL_WIZARD)
export class CreateBurialScene {
  constructor(private readonly burialsService: BurialsService) {}

  /**
   * КРОК 1: Довільна назва для розпізнавання
   */
  @WizardStep(1)
  async step1(@Ctx() ctx: OrderWizardContext) {
    await ctx.reply(Step.Step2, { parse_mode: 'HTML' });

    await ctx.reply(
      OrderStepUa.HintBurialLocation,
      { parse_mode: 'HTML', reply_markup: Markup.removeKeyboard().reply_markup }
    );
    ctx.wizard.next();
  }

  /**
   * КРОК 2: Прізвище померлого
   */
  @WizardStep(2)
  async step2(@Ctx() ctx: OrderWizardContext) {
    if (ctx.message && 'text' in ctx.message) {
      ctx.wizard.state.burialTemp = { name: ctx.message.text };
      await ctx.reply(OrderStepUa.HintBurialLastName, { parse_mode: 'HTML' });
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
        ctx.wizard.state.burialTemp.deathDate = text; //this.parseDate(text);
      } else {
        ctx.wizard.state.burialTemp.deathDate = ''; //this.parseDate(text);
        // await ctx.reply(OrderStepUa.HintBurialDateMMYYYY, { parse_mode: 'HTML' });
        // return;
      }

      await ctx.reply(OrderStepUa.SaveBurial, {
        parse_mode: 'HTML',
        reply_markup: Markup.removeKeyboard().reply_markup,
      });
      // ctx.wizard.next();
      ctx.wizard.selectStep(7);
      return this.step8(ctx);
    }
  }

  /**
   * КРОК 8: Фінал — збереження в Back4App
   */
  @WizardStep(8)
  async step8(@Ctx() ctx: OrderWizardContext) {
    if (ctx.message && 'text' in ctx.message) {
      if (!ctx.wizard.state.burialTemp) {
        ctx.wizard.state.burialTemp = {};
      }

      ctx.wizard.state.burialTemp.cemetery = '';
      // ctx.wizard.state.burialTemp.cemetery = ctx.message.text;
      // await ctx.reply(OrderStepUa.SaveBurial);

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
          coordinates: '', // Можна буде додати згодом або взяти з кроків замовлення
          notes: 'Створено під час оформлення заявки',
        });

        await ctx.reply(`✅ Анкета про поховання "${newBurial.name}" успішно створено! Повертаємось до оформлення заявки...`);

        // 🔥 Записуємо ID поховання у батьківську сесію замовлення
        const orderSession = ctx.session.__scenes?.state as OrderWizardSession;
        if (orderSession) {
          ctx.session.pendingBurial = {
            id: newBurial.id,
            displayName: temp.name ?? '', //`${temp.burialLastName} ${temp.burialName}`,
          }
        }

        // Повертаємо користувача назад в сцену замовлення
        await ctx.scene.enter(Scene.CREATE_ORDER_WIZARD);
      } catch (error) {
        console.error(error);
        await ctx.reply(OrderStepUa.ErrorSaveOrder);
        await ctx.reply(OrderStepUa.ReturnToMainMenu, { reply_markup: mainMenuButtons });
        return ctx.scene.leave();
      }
    }
  }

  /*private parseDate(dateStr: string): string | undefined {
    const parts = dateStr.split('.');

    // Варіант А: Прийшло лише ММ.РРРР або ДД.РРРР (2 частини, наприклад "06.2026")
    if (parts.length === 2) {
      const monthOrDay = parts[0].padStart(2, '0');
      const year = parts[1];

      // Примусово робимо перший день цього місяця/року: YYYY-MM-01
      return `${year}-${monthOrDay}-01`;
    }

    // Варіант Б: Прийшла повна дата ДД.ММ.РРРР (3 частини, наприклад "11.06.2026")
    else if (parts.length === 3) {
      const day = parts[0].padStart(2, '0');
      const month = parts[1].padStart(2, '0');
      const year = parts[2];

      return `${year}-${month}-${day}`;
    }

    // Варіант В: Якщо користувач ввів взагалі лише рік "2026" (1 частина)
    else if (parts.length === 1 && parts[0].length === 4 && !isNaN(Number(parts[0]))) {
      return `${parts[0]}-01-01`; // Робимо 1 січня поточного року
    }

    return undefined;
  }*/
}