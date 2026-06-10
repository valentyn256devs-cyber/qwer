import { Wizard, WizardStep, Ctx } from 'nestjs-telegraf';
import { Markup } from 'telegraf';
import { BurialsService } from '../../../burials/burials.service';
import {type OrderWizardContext, OrderWizardSession} from "../interfaces/order-wizard-context.interface";
import {OrderStepUa} from "../../telegram-constants";

@Wizard('CREATE_BURIAL_WIZARD')
export class CreateBurialScene {
  constructor(private readonly burialsService: BurialsService) {}

  /**
   * КРОК 1: Довільна назва для розпізнавання
   */
  @WizardStep(1)
  async step1(@Ctx() ctx: OrderWizardContext) {
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
      await ctx.reply('Будь ласка, введіть текст.');
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
      await ctx.reply(OrderStepUa.HintBurialName, { parse_mode: 'HTML' });
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
      await ctx.reply(OrderStepUa.HintBurialFatherName, { parse_mode: 'HTML' });
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

      ctx.wizard.state.burialTemp.burialFatherName = ctx.message.text;

      await ctx.reply(
        OrderStepUa.HintBurialDateBirthday,
        {
          parse_mode: 'HTML',
          reply_markup: Markup.keyboard([['Пропустити ➡️']]).resize().oneTime().reply_markup,
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
      const text = ctx.message.text;
      if (text !== 'Пропустити ➡️') {
        if (!ctx.wizard.state.burialTemp) {
          ctx.wizard.state.burialTemp = {};
        }

        ctx.wizard.state.burialTemp.birthDate = this.parseDate(text);
      }

      await ctx.reply(
        OrderStepUa.HintBurialDateDied,
        {
          parse_mode: 'HTML',
          reply_markup: Markup.keyboard([['Пропустити ➡️']]).resize().oneTime().reply_markup,
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
      const text = ctx.message.text;
      if (text !== 'Пропустити ➡️') {
        if (!ctx.wizard.state.burialTemp) {
          ctx.wizard.state.burialTemp = {};
        }
        ctx.wizard.state.burialTemp.deathDate = this.parseDate(text);
      }

      await ctx.reply(OrderStepUa.HintBurialPlaceLocation, {
        parse_mode: 'HTML',
        reply_markup: Markup.removeKeyboard().reply_markup,
      });
      ctx.wizard.next();
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

      ctx.wizard.state.burialTemp.cemetery = ctx.message.text;

      await ctx.reply('⏳ Зберігаю дані про поховання у базі...');

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
          telegramId: ctx.from?.id.toString(),
          coordinates: '', // Можна буде додати згодом або взяти з кроків замовлення
          notes: 'Створено під час оформлення заявки',
        });

        await ctx.reply(`✅ Анкета про поховання "${newBurial.name}" успішно створено! Повертаємось до оформлення заявки...`);

        // 🔥 Записуємо ID поховання у батьківську сесію замовлення
        const orderSession = ctx.session.__scenes?.state as OrderWizardSession;
        if (orderSession) {
          ctx.session.pendingBurial = {
            id: newBurial.id,
            displayName: `${temp.burialLastName} ${temp.burialName}`,
          }
        }

        // Повертаємо користувача назад в сцену замовлення
        await ctx.scene.enter('CREATE_ORDER_WIZARD');
      } catch (error) {
        console.error(error);
        await ctx.reply('Сталася помилка при збереженні поховання. Спробуйте заново.');
        return ctx.scene.leave();
      }
    }
  }

  private parseDate(dateStr: string): string | undefined {
    const parts = dateStr.split('.');
    if (parts.length === 3) {
      // Перетворюємо ДД.ММ.РРРР в ISO формат YYYY-MM-DD для DTO
      return `${parts[2]}-${parts[1]}-${parts[0]}`;
    }
    return undefined;
  }
}