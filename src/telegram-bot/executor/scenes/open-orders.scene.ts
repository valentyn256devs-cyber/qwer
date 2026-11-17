import { Ctx, Wizard, WizardStep } from 'nestjs-telegraf';
import { Markup } from 'telegraf';
import { OrdersService } from '../../../orders/orders.service';
import { Scene as SceneConst } from '../../telegram-constants';
import { ExecutorConst } from '../model/executor-const';
import type { ExecutorWizardContext } from '../interfaces/executor-wizard-context.interface';

@Wizard(SceneConst.OPEN_ORDERS_SCENE)
export class OpenOrdersScene {
  constructor(private readonly ordersService: OrdersService) {}

  @WizardStep(1)
  async stepOpenOrders(@Ctx() ctx: ExecutorWizardContext) {
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
          `${ExecutorConst.OpenOrdersCardTitle(order.id)}${overdueMark}\n` +
          `#\u200B${order.id}\n` +
          `${ExecutorConst.OpenOrdersCardServiceLabel} <b>${order.service?.name ?? ExecutorConst.OpenOrdersCardDash}</b>\n` +
          `${ExecutorConst.OpenOrdersCardAddressLabel} ${order.details?.burialId ? ExecutorConst.OpenOrdersCardAddressHint : ExecutorConst.OpenOrdersCardDash}\n` +
          `${ExecutorConst.OpenOrdersCardDateLabel} ${order.deadlines?.serviceDateFrom ? new Date(order.deadlines.serviceDateFrom).toLocaleDateString('uk-UA') : ExecutorConst.OpenOrdersCardDash}\n` +
          `${ExecutorConst.OpenOrdersCardDeadlineLabel} ${(order as any).deadlineDisplay?.executionDeadline ?? ExecutorConst.OpenOrdersCardDash}\n` +
          `${ExecutorConst.OpenOrdersCardRemainingLabel} ${(order as any).deadlineDisplay?.remaining ?? ExecutorConst.OpenOrdersCardDash}\n` +
          `${ExecutorConst.OpenOrdersCardCommentLabel} ${order.report?.adminComment ?? ExecutorConst.OpenOrdersCardDash}`;

        await ctx.reply(msg, {
          parse_mode: 'HTML',
          reply_markup: Markup.inlineKeyboard([
            [
              Markup.button.callback(ExecutorConst.ViewButton, `executor_view_order_${order.id}`),
              Markup.button.callback(ExecutorConst.TakeButton, `executor_accept_order_${order.id}`),
            ],
          ]).reply_markup,
        });
      }

      await ctx.reply(ExecutorConst.OpenOrdersFooter, {
        reply_markup: Markup.inlineKeyboard([
          [Markup.button.callback(ExecutorConst.BackToMenu, 'executor_back_to_menu')],
        ]).reply_markup,
      });
    } catch (error) {
      console.error('Помилка завантаження відкритих замовлень:', error);
      await ctx.reply(ExecutorConst.OpenOrdersError);
      await ctx.scene.leave();
    }
  }
}
