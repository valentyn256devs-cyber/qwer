import { Action, Ctx, Hears, Wizard, WizardStep } from 'nestjs-telegraf';
import { Logger } from '@nestjs/common';
import { Markup } from 'telegraf';
import { OrdersService } from '../../../orders/orders.service';
import { Scene as SceneConst, executorMainMenuButtons } from '../../telegram-constants';
import { ExecutorConst } from '../model/executor-const';
import {
  getOrderId,
  requireExecutorOrder,
} from '../model/executor-scene-helpers';
import type { ExecutorWizardContext } from '../interfaces/executor-wizard-context.interface';

@Wizard(SceneConst.SUBMIT_SCENE)
export class SubmitScene {
  private readonly logger = new Logger(SubmitScene.name);
  constructor(private readonly ordersService: OrdersService) {}

  @WizardStep(1)
  async stepSubmit(@Ctx() ctx: ExecutorWizardContext) {
    this.logger.log(`[SubmitScene] stepSubmit`, { userId: ctx.from?.id, orderId: ctx.session?.orderId });
    const order = await requireExecutorOrder(ctx, this.ordersService);
    if (!order) return;

    await ctx.reply(ExecutorConst.SubmitPrompt, {
      parse_mode: 'HTML',
      reply_markup: Markup.inlineKeyboard([
        [Markup.button.callback(ExecutorConst.SkipCommentButton, 'executor_skip_comment')],
      ]).reply_markup,
    });
  }

  /** Пропустити коментар → здати роботу на перевірку. */
  @Action('executor_skip_comment')
  async onSkipComment(@Ctx() ctx: ExecutorWizardContext) {
    this.logger.log(`[SubmitScene] onSkipComment`, { userId: ctx.from?.id, orderId: ctx.session?.orderId });
    await ctx.answerCbQuery?.();
    await this.submitWork(ctx);
  }

  /** Текстовий коментар виконавця → здати роботу на перевірку. */
  @Hears(/./)
  async onCommentText(@Ctx() ctx: ExecutorWizardContext) {
    this.logger.log(`[SubmitScene] onCommentText`, { userId: ctx.from?.id, orderId: ctx.session?.orderId, text: (ctx.message as any)?.text?.trim() });
    const text = (ctx.message as any)?.text?.trim();
    if (!text) return;
    await this.submitWork(ctx, text);
  }

  /** Спільна логіка здачі роботи на перевірку. */
  private async submitWork(
    ctx: ExecutorWizardContext,
    comment?: string,
  ): Promise<void> {
    const orderId = getOrderId(ctx);
    if (!orderId) {
      await ctx.reply(ExecutorConst.OrderNotFound);
      return ctx.scene.leave();
    }

    const executorId = ctx.from?.id.toString() ?? '';

    try {
      await this.ordersService.submitForReview(orderId, executorId, comment);
      await ctx.reply(ExecutorConst.MyOrdersStarted, {
        parse_mode: 'HTML',
        reply_markup: executorMainMenuButtons,
      });
    } catch (error) {
      await ctx.reply(
        ExecutorConst.MyOrdersStartError((error as Error).message),
        { reply_markup: executorMainMenuButtons },
      );
    }

    return ctx.scene.leave();
  }
}
