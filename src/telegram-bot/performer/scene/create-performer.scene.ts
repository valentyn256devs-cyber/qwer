import { Ctx, Wizard, WizardStep } from 'nestjs-telegraf';
import { Markup } from 'telegraf';
import { Scene, executorMainMenuButtons } from '../../telegram-constants';
import { PerformersService } from '../../../performers/performers.service';
import { PerformerConst } from '../../../performers/performer-const';
import { ExecutorConst } from '../../executor/model/executor-const';
import type { ExecutorWizardContext } from '../../executor/interfaces/executor-wizard-context.interface';

/**
 * Коротка анкета виконавця (перший запуск).
 *
 * Крок 1 — підтвердження / введення телефону.
 * Крок 2 — підтвердження локації (геолокація) + збереження в базу.
 *
 * УВАГА: не можна повертати результат `ctx.wizard.next()` / `ctx.scene.enter()`,
 * бо nestjs-telegraf робить `ctx.reply(String(result))` для будь-якого truthy
 * значення, а `wizard.next()` повертає екземпляр WizardContextWizard →
 * Telegram отримував би «[object Object]».
 */
@Wizard(Scene.CREATE_PERFORMER_WIZARD)
export class CreatePerformerScene {
  constructor(private readonly performersService: PerformersService) {}

  // ==================== Крок 1: телефон ====================

  @WizardStep(1)
  async stepPhone(@Ctx() ctx: ExecutorWizardContext) {
    // Якщо користувач надіслав контакт — зберігаємо телефон
    const contact = (ctx.message as any)?.contact;
    if (contact?.phone_number) {
      ctx.session = ctx.session || {};
      ctx.session.performerPhone = contact.phone_number;
      await this.askLocation(ctx);
      ctx.wizard.next();
      return;
    }

    // Якщо користувач надіслав текст — використовуємо як телефон
    const text = (ctx.message as any)?.text?.trim();
    if (text && !text.startsWith('/')) {
      ctx.session = ctx.session || {};
      ctx.session.performerPhone = text;
      await this.askLocation(ctx);
      ctx.wizard.next();
      return;
    }

    // Інші типи повідомлень — повторюємо запит
    await ctx.reply(PerformerConst.PhonePrompt, {
      parse_mode: 'HTML',
      reply_markup: Markup.keyboard([
        [Markup.button.contactRequest(PerformerConst.PhoneShareButton)],
      ])
        .resize()
        .reply_markup,
    });
  }

  // ==================== Крок 2: локація + збереження ====================

  @WizardStep(2)
  async stepLocationAndSave(@Ctx() ctx: ExecutorWizardContext) {
    const location = (ctx.message as any)?.location;
    if (location?.latitude == null || location?.longitude == null) {
      // Якщо локацію не надіслано — повторюємо запит
      await this.askLocation(ctx);
      return;
    }

    ctx.session = ctx.session || {};
    ctx.session.performerLatitude = location.latitude;
    ctx.session.performerLongitude = location.longitude;

    await this.savePerformer(ctx);
  }

  // ==================== Збереження ====================

  private async savePerformer(ctx: ExecutorWizardContext): Promise<void> {
    const telegramId = ctx.from?.id?.toString() ?? '';
    const username = ctx.from?.username;
    const phone = ctx.session?.performerPhone;
    const latitude = ctx.session?.performerLatitude;
    const longitude = ctx.session?.performerLongitude;

    if (!telegramId || !phone || latitude == null || longitude == null) {
      await ctx.reply(PerformerConst.SaveError);
      await ctx.scene.leave();
      return;
    }

    try {
      await this.performersService.create({
        telegramId,
        username,
        phoneNumber: phone,
        latitude,
        longitude,
      });
    } catch (error) {
      console.error('Помилка створення виконавця:', error);
      await ctx.reply(PerformerConst.SaveErrorDb);
      await ctx.scene.leave();
      return;
    }

    await ctx.reply(
      `${PerformerConst.SaveSuccessTitle}\n\n` +
        `${PerformerConst.SaveSuccessPhoneLabel} <code>${phone}</code>\n` +
        `${PerformerConst.SaveSuccessLocationLabel} <code>${latitude}, ${longitude}</code>\n\n` +
        `${PerformerConst.SaveSuccessFooter}`,
      {
        parse_mode: 'HTML',
        reply_markup: executorMainMenuButtons,
      },
    );

    await ctx.reply(ExecutorConst.Welcome, {
      reply_markup: executorMainMenuButtons,
    });

    await ctx.scene.leave();
  }

  // ==================== Допоміжні методи ====================

  /** Надсилає запит геолокації з клавіатурою. */
  private async askLocation(ctx: ExecutorWizardContext): Promise<void> {
    await ctx.reply(PerformerConst.LocationPrompt, {
      parse_mode: 'HTML',
      reply_markup: Markup.keyboard([
        [Markup.button.locationRequest(PerformerConst.LocationShareButton)],
      ])
        .resize()
        .reply_markup,
    });
  }
}
