import { Action, Ctx, Wizard, WizardStep } from 'nestjs-telegraf';
import { Logger } from '@nestjs/common';
import { Markup } from 'telegraf';
import { OrdersService } from '../../../orders/orders.service';
import { BurialsService } from '../../../burials/burials.service';
import { OrderStatus } from '../../../orders/models/order-status';
import { Scene as SceneConst } from '../../telegram-constants';
import { ExecutorConst } from '../model/executor-const';
import { requireOrderById } from '../model/executor-scene-helpers';
import type { ExecutorWizardContext } from '../interfaces/executor-wizard-context.interface';

@Wizard(SceneConst.ORDER_DETAILS_SCENE)
export class OrderDetailsScene {
  private readonly logger = new Logger(OrderDetailsScene.name);

  constructor(
    private readonly ordersService: OrdersService,
    private readonly burialsService: BurialsService,
  ) {
  }

  @WizardStep(1)
  async stepDetails(@Ctx() ctx: ExecutorWizardContext) {
    this.logger.log(`[OrderDetailsScene] stepDetails`, { userId: ctx.from?.id, orderId: ctx.session?.orderId });
    const order = await requireOrderById(ctx, this.ordersService);
    if (!order) return;

    ctx.session = ctx.session || {};
    ctx.session.orderDetailsMessageIds = [];

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

    const detailsMsg = await ctx.reply(msg, { parse_mode: 'HTML' });
    if (detailsMsg?.message_id) {
      ctx.session.orderDetailsMessageIds.push(detailsMsg.message_id);
    }

    const actions = buildActions(order as any, order.id);
    if (actions.length > 0) {
      const actionsMsg = await ctx.reply(ExecutorConst.ChooseAction, {
        reply_markup: Markup.inlineKeyboard(actions).reply_markup,
      });
      if (actionsMsg?.message_id) {
        ctx.session.orderDetailsMessageIds.push(actionsMsg.message_id);
      }
    } else {
      const backMsg = await ctx.reply(ExecutorConst.BackToDetails, {
        reply_markup: Markup.inlineKeyboard([
          [Markup.button.callback(ExecutorConst.BackToOrders, 'executor_back_to_orders')],
        ]).reply_markup,
      });
      if (backMsg?.message_id) {
        ctx.session.orderDetailsMessageIds.push(backMsg.message_id);
      }
    }
  }

  /** Назад до списку «Мої замовлення». */
  @Action('executor_back_to_orders')
  async onBackToOrders(@Ctx() ctx: ExecutorWizardContext) {
    this.logger.log(`[OrderDetailsScene] onBackToOrders`, { userId: ctx.from?.id });
    await ctx.answerCbQuery?.();
    await this.clearOrderDetailsMessages(ctx);
    return ctx.scene.enter(SceneConst.OPEN_ORDERS_SCENE);
  }

  /** Почати виконання замовлення. */
  @Action(/^executor_start_(.+)$/)
  async onStartExecution(@Ctx() ctx: ExecutorWizardContext) {
    this.logger.log(`[OrderDetailsScene] onStartExecution`, {
      userId: ctx.from?.id,
      orderId: ((ctx as any).match as RegExpExecArray | null)?.[1] ?? ''
    });
    const orderId = ((ctx as any).match as RegExpExecArray | null)?.[1] ?? '';
    await ctx.answerCbQuery?.();
    if (!orderId) return;

    await this.clearOrderDetailsMessages(ctx);

    const executorId = ctx.from?.id.toString() ?? '';
    try {
      await this.ordersService.startExecution(orderId, executorId);
      await ctx.reply(ExecutorConst.MyOrdersStarted, { parse_mode: 'HTML' });
      return ctx.scene.enter(SceneConst.SEARCH_VERIFY_SCENE);
    } catch (error) {
      await ctx.reply(ExecutorConst.MyOrdersStartError((error as Error).message));
      return;
    }
  }

  /** Взяти замовлення → сцена прийняття. */
  @Action(/^executor_accept_preview_order_(.+)$/)
  async onAcceptOrder(@Ctx() ctx: ExecutorWizardContext) {
    this.logger.log(`[OrderDetailsScene] onAcceptPreviewOrder`, {
      userId: ctx.from?.id,
      orderId: ((ctx as any).match as RegExpExecArray | null)?.[1] ?? ''
    });
    const orderId = ((ctx as any).match as RegExpExecArray | null)?.[1] ?? '';
    await ctx.answerCbQuery?.();
    if (!orderId) return;

    await this.clearOrderDetailsMessages(ctx);

    ctx.session = ctx.session || {};
    ctx.session.orderId = orderId;
    return ctx.scene.enter(SceneConst.ACCEPT_ORDER_SCENE);
  }

  /** Прибирає всі повідомлення деталей замовлення з чату. */
  private async clearOrderDetailsMessages(ctx: ExecutorWizardContext): Promise<void> {
    const messageIds = ctx.session?.orderDetailsMessageIds ?? [];
    const chatId = ctx.chat?.id ?? ctx.from?.id;
    if (chatId && messageIds.length > 0) {
      for (const messageId of messageIds) {
        await ctx.telegram.deleteMessage(chatId, messageId).catch(() => null);
      }
      ctx.session.orderDetailsMessageIds = [];
    }
  }

}

function buildActions(order: any, orderId: string): any[][] {
  const status = order.status;
  const beforePhotosResponse = order.BeforePhotosConfirmationResponse;

  switch (status) {
    case OrderStatus.AvailableForExecutor:
      return [
        [Markup.button.callback(ExecutorConst.TakeButton, `executor_accept_preview_order_${orderId}`)],
        [Markup.button.callback(ExecutorConst.BackToOrders, 'executor_back_to_orders')],
      ];
    case OrderStatus.Assigned:
      // If admin requested clarification on before photos, executor must respond first
      if (beforePhotosResponse === 'clarification') {
        return [
          [Markup.button.callback(ExecutorConst.RespondClarificationButton, `executor_respond_clarification_${orderId}`)],
          [Markup.button.callback(ExecutorConst.ProposeUpdateButton, `executor_propose_update_${orderId}`)],
          [Markup.button.callback(ExecutorConst.ReportProblemButton, `executor_report_problem_${orderId}`)],
          [Markup.button.callback(ExecutorConst.CannotCompleteButton, `executor_cannot_complete_${orderId}`)],
        ];
      }
      // Executor can start search/verify regardless of before-photo admin confirmation.
      // Admin confirms before photos AFTER executor uploads them (Етап 11), not at start (Етап 10).
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
