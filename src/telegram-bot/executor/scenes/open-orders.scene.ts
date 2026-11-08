import { Ctx, Wizard, WizardStep } from 'nestjs-telegraf';
import { Markup } from 'telegraf';
import { OrdersService } from '../../../orders/orders.service';
import { Scene as SceneConst } from '../../telegram-constants';
import { ExecutorConst } from '../executor-const';
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
        const overdueMark = (order as any).isOverdue ? ' 🔴 <b>ПРОСТРОЧЕНО</b>' : '';
        const msg =
          `📌 <b>Замовлення №${order.id}</b>${overdueMark}\n` +
          `#\u200B${order.id}\n` +
          `🏷 Послуга: <b>${order.service?.name ?? '—'}</b>\n` +
          `📍 Адреса / кладовище: ${order.details?.burialId ? 'див. картку' : '—'}\n` +
          `📅 Бажана дата: ${order.deadlines?.serviceDateFrom ? new Date(order.deadlines.serviceDateFrom).toLocaleDateString('uk-UA') : '—'}\n` +
          `⏰ Виконати до: ${(order as any).deadlineDisplay?.executionDeadline ?? '—'}\n` +
          `⏱ Залишилось: ${(order as any).deadlineDisplay?.remaining ?? '—'}\n` +
          `📝 Коментар: ${order.report?.adminComment ?? '—'}`;

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
