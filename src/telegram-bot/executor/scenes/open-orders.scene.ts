import { Action, Ctx, Wizard, WizardStep } from 'nestjs-telegraf';
import { Logger } from '@nestjs/common';
import { Markup } from 'telegraf';
import { OrdersService } from '../../../orders/orders.service';
import { Scene as SceneConst } from '../../telegram-constants';
import { ExecutorConst } from '../model/executor-const';
import type { ExecutorWizardContext } from '../interfaces/executor-wizard-context.interface';

@Wizard(SceneConst.OPEN_ORDERS_SCENE)
export class OpenOrdersScene {
  private readonly logger = new Logger(OpenOrdersScene.name);
  constructor(private readonly ordersService: OrdersService) {}

  @WizardStep(1)
  async stepOpenOrders(@Ctx() ctx: ExecutorWizardContext) {
    this.logger.log(`[OpenOrdersScene] stepOpenOrders`, { userId: ctx.from?.id });
    await ctx.reply(ExecutorConst.OpenOrdersLoading);

    try {
      const orders = await this.ordersService.findAvailable();

      if (!orders || orders.length === 0) {
        await ctx.reply(ExecutorConst.OpenOrdersEmpty);
        return ctx.scene.leave();
      }

      for (const order of orders) {
        const overdueMark = (order as any).isOverdue
          ? ` ${ExecutorConst.OrderDetailsOverdue}`
          : '';
        const msg =
          `${ExecutorConst.OpenOrdersCardTitle(order.id)}${overdueMark}\n\n` +
          //
          `${ExecutorConst.OpenOrdersCardServiceLabel} <b>${order.service?.name ?? ExecutorConst.OpenOrdersCardDash}</b>\n` +
          `${ExecutorConst.OpenOrdersCardAddressLabel} ${order.details?.burialId ? ExecutorConst.OpenOrdersCardAddressHint : ExecutorConst.OpenOrdersCardDash}\n\n` +
          //
          `${ExecutorConst.OpenOrdersCardDateLabel} ${order.deadlines?.serviceDateFrom ? new Date(order.deadlines.serviceDateFrom).toLocaleDateString('uk-UA') : ExecutorConst.OpenOrdersCardDash}\n` +
          `${ExecutorConst.OpenOrdersCardDeadlineLabel} ${(order as any).deadlineDisplay?.executionDeadline ?? ExecutorConst.OpenOrdersCardDash}\n` +
          `${ExecutorConst.OpenOrdersCardRemainingLabel} ${(order as any).deadlineDisplay?.remaining ?? ExecutorConst.OpenOrdersCardDash}\n` +
          `${ExecutorConst.OpenOrdersCardCommentLabel} ${order.report?.adminComment || ExecutorConst.OpenOrdersCardNoComment}`;

        const finalText = msg + '\n\n' +  ExecutorConst.OpenOrdersFooter;

        await ctx.reply(finalText, {
          parse_mode: 'HTML',
          reply_markup: Markup.inlineKeyboard([
            [
              Markup.button.callback(ExecutorConst.ViewButton, `executor_view_order_${order.id}`),
              Markup.button.callback(ExecutorConst.TakeButton, `executor_accept_order_${order.id}`),
            ],
            [
              Markup.button.callback(ExecutorConst.BackToMenu, 'executor_back_to_menu'),
            ],
          ]).reply_markup,
        });
      }

      /*await ctx.reply(ExecutorConst.OpenOrdersFooter, {
        reply_markup: Markup.inlineKeyboard([
          [Markup.button.callback(ExecutorConst.BackToMenu, 'executor_back_to_menu')],
        ]).reply_markup,
      });*/
    } catch (error) {
      this.logger.error(`[OpenOrdersScene] stepOpenOrders`, { error: (error as Error).message });
      await ctx.reply(ExecutorConst.OpenOrdersError);
      await ctx.scene.leave();
    }
  }

  /** Перегляд замовлення → картка деталей. */
  @Action(/^executor_view_order_(.+)$/)
  async onViewOrder(@Ctx() ctx: ExecutorWizardContext) {
    this.logger.log(`[OpenOrdersScene] onViewOrder`, { userId: ctx.from?.id, orderId: ((ctx as any).match as RegExpExecArray | null)?.[1] ?? '' });
    const orderId = ((ctx as any).match as RegExpExecArray | null)?.[1] ?? '';
    await ctx.answerCbQuery?.();
    if (!orderId) return;

    ctx.session = ctx.session || {};
    ctx.session.orderId = orderId;
    return ctx.scene.enter(SceneConst.ORDER_DETAILS_SCENE);
  }

  /** Взяти замовлення → сцена прийняття. */
  @Action(/^executor_accept_order_(.+)$/)
  async onAcceptOrder(@Ctx() ctx: ExecutorWizardContext) {
    this.logger.log(`[OpenOrdersScene] onAcceptOrder`, { userId: ctx.from?.id, orderId: ((ctx as any).match as RegExpExecArray | null)?.[1] ?? '' });
    const orderId = ((ctx as any).match as RegExpExecArray | null)?.[1] ?? '';
    await ctx.answerCbQuery?.();
    if (!orderId) return;

    ctx.session = ctx.session || {};
    ctx.session.orderId = orderId;
    return ctx.scene.enter(SceneConst.ACCEPT_ORDER_SCENE);
  }

  /** Назад до меню. */
  @Action('executor_back_to_menu')
  async onBackToMenu(@Ctx() ctx: ExecutorWizardContext) {
    this.logger.log(`[OpenOrdersScene] onBackToMenu`, { userId: ctx.from?.id });
    await ctx.answerCbQuery?.();
    await ctx.reply(ExecutorConst.BackToMenuMessage, { parse_mode: 'HTML' });
    return ctx.scene.leave();
  }
}
