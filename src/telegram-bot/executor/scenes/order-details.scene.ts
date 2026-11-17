import { Ctx, Wizard, WizardStep } from 'nestjs-telegraf';
import { Markup } from 'telegraf';
import { OrdersService } from '../../../orders/orders.service';
import { BurialsService } from '../../../burials/burials.service';
import { OrderStatus } from '../../../orders/models/order-status';
import { Scene as SceneConst } from '../../telegram-constants';
import { ExecutorConst } from '../model/executor-const';
import type { ExecutorWizardContext } from '../interfaces/executor-wizard-context.interface';

@Wizard(SceneConst.ORDER_DETAILS_SCENE)
export class OrderDetailsScene {
  constructor(
    private readonly ordersService: OrdersService,
    private readonly burialsService: BurialsService,
  ) {}

  @WizardStep(1)
  async stepDetails(@Ctx() ctx: ExecutorWizardContext) {
    const orderId = ctx.session?.orderId ?? ctx.wizard?.state?.orderId;
    if (!orderId) {
      await ctx.reply(ExecutorConst.OrderNotFound);
      return ctx.scene.leave();
    }

    const executorId = ctx.from?.id.toString() ?? '';

    const order = (await this.ordersService.findByExecutorId(executorId)).find((o: any) => o.id === orderId);
    if (!order) {
      await ctx.reply(ExecutorConst.OrderNotFoundAssigned);
      return ctx.scene.leave();
    }

    const burial = order.details?.burialId
      ? await this.burialsService.findBurialById(order.details.burialId).catch(() => undefined)
      : undefined;

    const overdueMark = (order as any).isOverdue ? '\n🔴 <b>ПРОСТРОЧЕНО</b>' : '';
    const msg =
      `📄 <b>Замовлення №${order.id}</b>${overdueMark}\n\n` +
      `📌 <b>Послуга:</b> ${order.service?.name ?? '—'}\n` +
      `💰 Ціна: ${order.service?.price ?? '—'}\n` +
      `📅 Дата: ${order.deadlines?.serviceDateFrom ? new Date(order.deadlines.serviceDateFrom).toLocaleDateString('uk-UA') : '—'}\n` +
      `⏰ Виконати до: ${(order as any).deadlineDisplay?.executionDeadline ?? '—'}\n` +
      `⏱ Залишилось: ${(order as any).deadlineDisplay?.remaining ?? '—'}\n` +
      `📊 Статус: <b>${order.status}</b>\n\n` +
      `👤 <b>Клієнт:</b>\n` +
      `  • Ім'я: ${order.client?.name ?? '—'}\n` +
      `  • Телефон: ${order.client?.phone ?? '—'}\n\n` +
      `🪦 <b>Місце пам'яті (Memory Place):</b>\n` +
      `  • ПІБ: ${burial ? `${burial.burialLastName ?? ''} ${burial.burialName ?? ''} ${burial.burialFatherName ?? ''}`.trim() : '—'}\n` +
      `  • Кладовище: ${burial?.cemetery ?? '—'}\n` +
      `  • Сектор/ряд/номер: ${burial?.notes ?? '—'}\n` +
      `  • GPS: ${burial?.coordinates ?? '—'}\n` +
      `  • Опис: ${burial?.notes ?? '—'}\n` +
      `  • Орієнтири: ${burial?.notes ?? '—'}\n` +
      `  • Фото: ${burial?.photos?.length ? 'є' : 'немає'}\n\n` +
      `📝 Коментар клієнта: ${order.report?.adminComment ?? '—'}`;

    await ctx.reply(msg, { parse_mode: 'HTML' });

    const actions = buildActions(order.status, orderId);
    if (actions.length > 0) {
      await ctx.reply(ExecutorConst.ChooseAction, {
        reply_markup: Markup.inlineKeyboard(actions).reply_markup,
      });
    }

    await ctx.reply(ExecutorConst.BackToDetails, {
      reply_markup: Markup.inlineKeyboard([
        [Markup.button.callback(ExecutorConst.BackToOrders, 'executor_back_to_orders')],
      ]).reply_markup,
    });
  }
}

function buildActions(status: string, orderId: string): any[][] {
  switch (status) {
    case OrderStatus.Assigned:
      return [
        [Markup.button.callback(ExecutorConst.StartButton, `executor_start_${orderId}`)],
        [Markup.button.callback(ExecutorConst.ProposeUpdateButton, `executor_propose_update_${orderId}`)],
        [Markup.button.callback(ExecutorConst.ClarifyButton, `executor_clarify_${orderId}`)],
        [Markup.button.callback(ExecutorConst.ReportProblemButton, `executor_report_problem_${orderId}`)],
        [Markup.button.callback(ExecutorConst.CannotCompleteButton, `executor_cannot_complete_${orderId}`)],
      ];
    case OrderStatus.InProgress:
      return [
        [Markup.button.callback(ExecutorConst.ProposeUpdateButton, `executor_propose_update_${orderId}`)],
        [Markup.button.callback(ExecutorConst.ClarifyButton, `executor_clarify_${orderId}`)],
        [Markup.button.callback(ExecutorConst.ReportProblemButton, `executor_report_problem_${orderId}`)],
        [Markup.button.callback(ExecutorConst.CannotCompleteButton, `executor_cannot_complete_${orderId}`)],
      ];
    default:
      return [];
  }
}
