import { Action, Ctx, Wizard, WizardStep } from 'nestjs-telegraf';
import { Logger } from '@nestjs/common';
import { Markup } from 'telegraf';
import { OrdersService } from '../../../orders/orders.service';
import { Scene as SceneConst } from '../../telegram-constants';
import { ExecutorConst } from '../model/executor-const';
import { requireExecutorOrder } from '../model/executor-scene-helpers';
import type { ExecutorWizardContext } from '../interfaces/executor-wizard-context.interface';

@Wizard(SceneConst.REVISION_SCENE)
export class RevisionScene {
  private readonly logger = new Logger(RevisionScene.name);
  constructor(private readonly ordersService: OrdersService) {}

  @WizardStep(1)
  async stepShowRevision(@Ctx() ctx: ExecutorWizardContext) {
    this.logger.log(`[RevisionScene] stepShowRevision`, { userId: ctx.from?.id, orderId: ctx.session?.orderId });
    const order = await requireExecutorOrder(ctx, this.ordersService);
    if (!order) return;

    const adminComment = order.report?.adminComment ?? 'Немає коментаря';

    await ctx.reply(
      `🔄 <b>Замовлення №${order.id} потребує ревізії</b>\n\n` +
      `💬 <b>Коментар адміністратора:</b> ${adminComment}\n\n` +
      `Продовжіть роботу над замовленням:`,
      {
        parse_mode: 'HTML',
        reply_markup: Markup.inlineKeyboard([
          [Markup.button.callback(ExecutorConst.ContinueWorkButton, 'executor_continue_revision')],
          [Markup.button.callback(ExecutorConst.BackToMenu, 'executor_back_to_menu')],
        ]).reply_markup,
      },
    );
  }

  /** Продовжити роботу → перехід до фото «до». */
  @Action('executor_continue_revision')
  async onContinueRevision(@Ctx() ctx: ExecutorWizardContext) {
    this.logger.log(`[RevisionScene] onContinueRevision`, { userId: ctx.from?.id, orderId: ctx.session?.orderId });
    await ctx.answerCbQuery?.();
    await ctx.reply(ExecutorConst.ContinueWorkMessage, { parse_mode: 'HTML' });
    return ctx.scene.enter(SceneConst.BEFORE_PHOTOS_SCENE);
  }

  /** Назад до меню. */
  @Action('executor_back_to_menu')
  async onBackToMenu(@Ctx() ctx: ExecutorWizardContext) {
    this.logger.log(`[RevisionScene] onBackToMenu`, { userId: ctx.from?.id });
    await ctx.answerCbQuery?.();
    await ctx.reply(ExecutorConst.BackToMenuMessage, { parse_mode: 'HTML' });
    return ctx.scene.leave();
  }
}
