import { Action, Ctx, Wizard, WizardStep } from 'nestjs-telegraf';
import { Markup } from 'telegraf';
import { OrdersService } from '../../../orders/orders.service';
import { BurialsService } from '../../../burials/burials.service';
import { Scene as SceneConst } from '../../telegram-constants';
import { ExecutorConst } from '../model/executor-const';
import { requireExecutorOrder } from '../model/executor-scene-helpers';
import type { ExecutorWizardContext } from '../interfaces/executor-wizard-context.interface';

@Wizard(SceneConst.SEARCH_VERIFY_SCENE)
export class SearchVerifyScene {
  constructor(
    private readonly ordersService: OrdersService,
    private readonly burialsService: BurialsService,
  ) {}

  @WizardStep(1)
  async stepSearchVerify(@Ctx() ctx: ExecutorWizardContext) {
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

  /** Підтвердження прибуття → перехід до фото «до». */
  @Action('executor_arrived')
  async onArrived(@Ctx() ctx: ExecutorWizardContext) {
    await ctx.answerCbQuery?.();
    return ctx.scene.enter(SceneConst.BEFORE_PHOTOS_SCENE);
  }
}
