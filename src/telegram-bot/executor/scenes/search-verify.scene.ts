import { Action, Ctx, Wizard, WizardStep } from 'nestjs-telegraf';
import { Logger } from '@nestjs/common';
import { Markup } from 'telegraf';
import { OrdersService } from '../../../orders/orders.service';
import { BurialsService } from '../../../burials/burials.service';
import { Scene as SceneConst } from '../../telegram-constants';
import { ExecutorConst } from '../model/executor-const';
import { requireExecutorOrder } from '../model/executor-scene-helpers';
import type { ExecutorWizardContext } from '../interfaces/executor-wizard-context.interface';

interface VerificationItem {
  label: string;
  checked: boolean;
}

@Wizard(SceneConst.SEARCH_VERIFY_SCENE)
export class SearchVerifyScene {
  private readonly logger = new Logger(SearchVerifyScene.name);
  constructor(
    private readonly ordersService: OrdersService,
    private readonly burialsService: BurialsService,
  ) {
  }

  @WizardStep(1)
  async stepSearchVerify(@Ctx() ctx: ExecutorWizardContext) {
    this.logger.log(`[SearchVerifyScene] stepSearchVerify`, { userId: ctx.from?.id, orderId: ctx.session?.orderId });
    const order = await requireExecutorOrder(ctx, this.ordersService);
    if (!order) return;

    const burial = order.details?.burialId
      ? await this.burialsService.findBurialById(order.details.burialId).catch(() => undefined)
      : undefined;

    const memoryPlaceInfo =
      `🪦 <b>Memory Place — інформація для пошуку:</b>\n` +
      `  • ПІБ: ${burial ? `${burial.burialLastName ?? ''} ${burial.burialName ?? ''} ${burial.burialFatherName ?? ''}`.trim() : '—'}\n` +
      `  • Кладовище: ${burial?.cemetery ?? '—'}\n` +
      `  • Сектор/ряд/номер: ${burial?.notes ?? '—'}\n` +
      `  • GPS: ${burial?.coordinates ?? '—'}\n` +
      `  • Опис: ${burial?.notes ?? '—'}\n` +
      `  • Орієнтири: ${burial?.notes ?? '—'}\n` +
      `  • Фото: ${burial?.photos?.length ? 'є' : 'немає'}`;

    // Initialize wizard state for sub-steps
    ctx.wizard.state = ctx.wizard.state || {};
    (ctx.wizard.state as any).searchStep = 1;

    await ctx.reply(
      `🔍 <b>Етап пошуку поховання</b>\n\n` +
      `📌 <b>Step 1 — Прибути на місце</b>\n\n` +
      `${memoryPlaceInfo}\n\n` +
      `Підтвердіть, що ви прибули на місце виконання замовлення.`,
      {
        parse_mode: 'HTML',
        reply_markup: Markup.inlineKeyboard([
          [Markup.button.callback(ExecutorConst.ArrivedButton, 'executor_arrived')],
        ]).reply_markup,
      },
    );
  }

  /** Step 1: Підтвердження прибуття → перехід до Step 2 (Знайдено). */
  @Action('executor_arrived')
  async onArrived(@Ctx() ctx: ExecutorWizardContext) {
    this.logger.log(`[SearchVerifyScene] onArrived`, { userId: ctx.from?.id, orderId: ctx.session?.orderId });
    await ctx.answerCbQuery?.();
    ctx.wizard.state = ctx.wizard.state || {};
    (ctx.wizard.state as any).searchStep = 2;
    await this.renderSearchStep(ctx, 2);
  }

  /** Step 2: Поховання знайдено → перехід до Step 3 (Перевірка правильності). */
  @Action('executor_found')
  async onFound(@Ctx() ctx: ExecutorWizardContext) {
    this.logger.log(`[SearchVerifyScene] onFound`, { userId: ctx.from?.id, orderId: ctx.session?.orderId });
    await ctx.answerCbQuery?.();
    ctx.wizard.state = ctx.wizard.state || {};
    (ctx.wizard.state as any).searchStep = 3;
    await this.renderSearchStep(ctx, 3);
  }

  /** Step 3: Підтвердження правильності поховання → перехід до фото «до». */
  @Action('executor_verify_correct')
  async onVerifyCorrect(@Ctx() ctx: ExecutorWizardContext) {
    this.logger.log(`[SearchVerifyScene] onVerifyCorrect`, { userId: ctx.from?.id, orderId: ctx.session?.orderId });
    await ctx.answerCbQuery?.();
    return ctx.scene.enter(SceneConst.BEFORE_PHOTOS_SCENE);
  }

  /** Step 3: Інформація потребує оновлення → пропонуємо запропонувати оновлення Memory Place. */
  @Action('executor_verify_update')
  async onVerifyUpdate(@Ctx() ctx: ExecutorWizardContext) {
    this.logger.log(`[SearchVerifyScene] onVerifyUpdate`, { userId: ctx.from?.id, orderId: ctx.session?.orderId });
    await ctx.answerCbQuery?.();
    await ctx.reply(
      `🔄 <b>Інформація потребує оновлення</b>\n\n` +
      `Ви можете запропонувати оновлення даних про місце поховання. Адміністратор розгляне ваше пропозицію.`,
      {
        parse_mode: 'HTML',
        reply_markup: Markup.inlineKeyboard([
          [Markup.button.callback(ExecutorConst.ProposeUpdateButton, 'executor_propose_update')],
          [Markup.button.callback(ExecutorConst.BackToDetails, 'executor_back_to_details')],
        ]).reply_markup,
      },
    );
  }

  // ==================== Рендеринг кроків пошуку ====================

  private async renderSearchStep(ctx: ExecutorWizardContext, step: number): Promise<void> {
    const order = await requireExecutorOrder(ctx, this.ordersService);
    if (!order) return;

    const burial = order.details?.burialId
      ? await this.burialsService.findBurialById(order.details.burialId).catch(() => undefined)
      : undefined;

    const memoryPlaceInfo =
      `🪦 <b>Memory Place — інформація для пошуку:</b>\n` +
      `  • ПІБ: ${burial ? `${burial.burialLastName ?? ''} ${burial.burialName ?? ''} ${burial.burialFatherName ?? ''}`.trim() : '—'}\n` +
      `  • Кладовище: ${burial?.cemetery ?? '—'}\n` +
      `  • Сектор/ряд/номер: ${burial?.notes ?? '—'}\n` +
      `  • GPS: ${burial?.coordinates ?? '—'}\n` +
      `  • Опис: ${burial?.notes ?? '—'}\n` +
      `  • Орієнтири: ${burial?.notes ?? '—'}\n` +
      `  • Фото: ${burial?.photos?.length ? 'є' : 'немає'}`;

    if (step === 2) {
      await ctx.reply(
        `🔍 <b>Етап пошуку поховання</b>\n\n` +
        `📌 <b>Step 2 — Знайти поховання</b>\n\n` +
        `${memoryPlaceInfo}\n\n` +
        `Ви знайшли поховання, яке відповідає даних замовлення?`,
        {
          parse_mode: 'HTML',
          reply_markup: Markup.inlineKeyboard([
            [Markup.button.callback('Знайдено', 'executor_found')],
            [Markup.button.callback('Не знайдено', 'executor_not_found')],
            [Markup.button.callback(ExecutorConst.BackToDetails, 'executor_back_to_details')],
          ]).reply_markup,
        },
      );
    } else if (step === 3) {
      const verificationItems: VerificationItem[] = [
        { label: 'ПІБ співпадає', checked: false },
        { label: 'Пам\'ятник / фотографія співпадає', checked: false },
        { label: 'Місцезнаходження відповідає даним', checked: false },
        { label: 'Додаткові орієнтири відповідають', checked: false },
      ];

      const checklistText = verificationItems
        .map((item, i) => `${i + 1}. ${item.label}`)
        .join('\n');

      await ctx.reply(
        `🔍 <b>Етап пошуку поховання</b>\n\n` +
        `📌 <b>Step 3 — Перевірити правильність</b>\n\n` +
        `${memoryPlaceInfo}\n\n` +
        `Приклад чекліста:\n` +
        `${checklistText}\n\n` +
        `Переконайтеся, що всі пункти виконані.`,
        {
          parse_mode: 'HTML',
          reply_markup: Markup.inlineKeyboard([
            [Markup.button.callback('Підтверджую правильність поховання', 'executor_verify_correct')],
            [Markup.button.callback('Інформація потребує оновлення', 'executor_verify_update')],
            [Markup.button.callback(ExecutorConst.BackToDetails, 'executor_back_to_details')],
          ]).reply_markup,
        },
      );
    }
  }
}
