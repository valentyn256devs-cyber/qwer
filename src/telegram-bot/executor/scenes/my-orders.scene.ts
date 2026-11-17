import { Action, Ctx, Hears, Wizard, WizardStep } from 'nestjs-telegraf';
import { Markup } from 'telegraf';
import { OrdersService } from '../../../orders/orders.service';
import { BurialsService } from '../../../burials/burials.service';
import { OrderStatus } from '../../../orders/models/order-status';
import {
  ExecutorMenu,
  Scene as SceneConst,
} from '../../telegram-constants';
import { ExecutorConst } from '../executor-const';
import {
  ACTIVE_ORDER_STATUSES,
  ExecutorOrder,
  buildOrderListKeyboard,
  formatOrderDetails,
  resolveContinueAction,
} from '../executor-order-view';
import type { ExecutorWizardContext } from '../interfaces/executor-wizard-context.interface';

/** Спільна частина callback_data для цієї сцени */
const CB_PREFIX = 'executor_myorders_';

/**
 * «Мої замовлення» — активні замовлення виконавця.
 *
 * Список → деталі → продовження роботи залежно від статусу:
 *  • assigned                    → старт виконання + етап пошуку
 *  • in_progress                 → наступний незавершений етап
 *  • revision_required           → сцена доробки
 *  • awaiting_completion_review  → тільки перегляд (очікує перевірки)
 */
@Wizard(SceneConst.MY_ORDERS_SCENE)
export class MyOrdersScene {
  constructor(
    private readonly ordersService: OrdersService,
    private readonly burialsService: BurialsService,
  ) {}

  // ==================== Крок 1: список активних замовлень ====================

  @WizardStep(1)
  async stepShowMyOrders(@Ctx() ctx: ExecutorWizardContext) {
    await this.showOrdersList(ctx);
  }

  // ==================== Навігація всередині сцени ====================

  @Action(`${CB_PREFIX}refresh`)
  async onRefresh(@Ctx() ctx: ExecutorWizardContext) {
    await ctx.answerCbQuery?.();
    await this.showOrdersList(ctx);
  }

  @Action(new RegExp(`^${CB_PREFIX}open_(.+)$`))
  async onOpenOrder(@Ctx() ctx: ExecutorWizardContext) {
    const orderId = ((ctx as any).match as RegExpExecArray | null)?.[1] ?? '';
    await ctx.answerCbQuery?.();
    if (!orderId) return;
    await this.showOrderDetails(ctx, orderId);
  }

  @Action(new RegExp(`^${CB_PREFIX}continue_(.+)$`))
  async onContinueOrder(@Ctx() ctx: ExecutorWizardContext) {
    const orderId = ((ctx as any).match as RegExpExecArray | null)?.[1] ?? '';
    await ctx.answerCbQuery?.();
    if (!orderId) return;
    await this.continueOrder(ctx, orderId);
  }

  @Action(`${CB_PREFIX}back`)
  async onBackToOrders(@Ctx() ctx: ExecutorWizardContext) {
    await ctx.answerCbQuery?.();
    await this.showOrdersList(ctx);
  }

  @Action(`${CB_PREFIX}menu`)
  async onBackToMenu(@Ctx() ctx: ExecutorWizardContext) {
    await ctx.answerCbQuery?.();
    await ctx.reply(ExecutorConst.BackToMenuMessage);
    return ctx.scene.leave();
  }

  // ==================== Кнопки головного меню (щоб не «застрягти» в сцені) ====================

  @Hears(ExecutorMenu.MyOrders)
  async onMyOrdersMenu(@Ctx() ctx: ExecutorWizardContext) {
    await this.showOrdersList(ctx);
  }

  @Hears(ExecutorMenu.OpenOrders)
  async onOpenOrdersMenu(@Ctx() ctx: ExecutorWizardContext) {
    return ctx.scene.enter(SceneConst.OPEN_ORDERS_SCENE);
  }

  @Hears(ExecutorMenu.DoneOrders)
  async onDoneOrdersMenu(@Ctx() ctx: ExecutorWizardContext) {
    return ctx.scene.enter(SceneConst.DONE_ORDERS_SCENE);
  }

  @Hears(ExecutorMenu.Help)
  async onHelpMenu(@Ctx() ctx: ExecutorWizardContext) {
    await ctx.scene.leave();
    await ctx.reply(ExecutorConst.HelpPrompt, {
      reply_markup: Markup.inlineKeyboard([
        [
          Markup.button.callback(
            ExecutorConst.ProblemButton,
            'executor_report_problem_pick',
          ),
        ],
        [
          Markup.button.callback(
            ExecutorConst.CannotCompleteHelpButton,
            'executor_cannot_complete_pick',
          ),
        ],
        [Markup.button.callback(ExecutorConst.BackToMenu, 'executor_back_to_menu')],
      ]).reply_markup,
    });
  }

  // ==================== Логіка ====================

  private async loadOrders(ctx: ExecutorWizardContext): Promise<ExecutorOrder[]> {
    const executorId = ctx.from?.id?.toString() ?? '';
    const orders = (await this.ordersService.findByExecutorId(executorId)) as ExecutorOrder[];
    return orders ?? [];
  }

  private async showOrdersList(ctx: ExecutorWizardContext) {
    await ctx.reply(ExecutorConst.MyOrdersLoading, { parse_mode: 'HTML' });

    let active: ExecutorOrder[];
    try {
      const all = await this.loadOrders(ctx);
      active = all.filter((order) => ACTIVE_ORDER_STATUSES.includes(order.status));
    } catch (error) {
      console.error('Не вдалося завантажити «Мої замовлення»:', error);
      await ctx.reply(ExecutorConst.MyOrdersError, {
        reply_markup: Markup.inlineKeyboard([
          [Markup.button.callback(ExecutorConst.MyOrdersRefreshButton, `${CB_PREFIX}refresh`)],
          [Markup.button.callback(ExecutorConst.BackToMenu, `${CB_PREFIX}menu`)],
        ]).reply_markup,
      });
      return;
    }

    if (active.length === 0) {
      await ctx.reply(ExecutorConst.MyOrdersEmpty, {
        parse_mode: 'HTML',
        reply_markup: Markup.inlineKeyboard([
          [Markup.button.callback(ExecutorConst.MyOrdersRefreshButton, `${CB_PREFIX}refresh`)],
          [Markup.button.callback(ExecutorConst.BackToMenu, `${CB_PREFIX}menu`)],
        ]).reply_markup,
      });
      return;
    }

    await ctx.reply(ExecutorConst.MyOrdersTitle(active.length), {
      parse_mode: 'HTML',
      reply_markup: buildOrderListKeyboard(active, CB_PREFIX).reply_markup,
    });
  }

  private async showOrderDetails(ctx: ExecutorWizardContext, orderId: string) {
    const order = (await this.loadOrders(ctx)).find((o) => o.id === orderId);

    if (!order) {
      await ctx.reply(ExecutorConst.OrderNotFoundAssigned);
      return;
    }

    // Зберігаємо orderId для наступних сцен (вони читають ctx.session.orderId)
    ctx.session = ctx.session || {};
    ctx.session.orderId = order.id;

    const burial = order.details?.burialId
      ? await this.burialsService.findBurialById(order.details.burialId).catch(() => undefined)
      : undefined;

    await ctx.reply(formatOrderDetails(order, burial), { parse_mode: 'HTML' });

    const continueAction = resolveContinueAction(order.status);

    if (continueAction.hint) {
      await ctx.reply(continueAction.hint, { parse_mode: 'HTML' });
    }

    const buttons: ReturnType<typeof Markup.button.callback>[][] = [];

    if (continueAction.action !== 'none') {
      buttons.push([
        Markup.button.callback(
          continueAction.label,
          `${CB_PREFIX}continue_${order.id}`,
        ),
      ]);
    }

    buttons.push([
      Markup.button.callback(ExecutorConst.MyOrdersBackButton, `${CB_PREFIX}back`),
    ]);
    buttons.push([
      Markup.button.callback(ExecutorConst.BackToMenu, `${CB_PREFIX}menu`),
    ]);

    await ctx.reply(ExecutorConst.ChooseAction, {
      reply_markup: Markup.inlineKeyboard(buttons).reply_markup,
    });
  }

  /** Продовження роботи — вибір наступного кроку залежно від статусу */
  private async continueOrder(ctx: ExecutorWizardContext, orderId: string) {
    const executorId = ctx.from?.id?.toString() ?? '';
    const order = (await this.loadOrders(ctx)).find((o) => o.id === orderId);

    if (!order) {
      await ctx.reply(ExecutorConst.OrderNotFoundAssigned);
      return;
    }

    ctx.session = ctx.session || {};
    ctx.session.orderId = order.id;

    switch (order.status) {
      case OrderStatus.Assigned: {
        try {
          await this.ordersService.startExecution(order.id, executorId);
        } catch (error) {
          await ctx.reply(`❌ ${(error as Error).message}`);
          return;
        }
        await ctx.reply(ExecutorConst.MyOrdersStarted, { parse_mode: 'HTML' });
        return ctx.scene.enter(SceneConst.SEARCH_VERIFY_SCENE);
      }

      case OrderStatus.InProgress: {
        // Визначаємо перший незавершений етап
        const hasBeforePhotos = (order.report?.photosBefore?.length ?? 0) > 0;
        const hasAfterPhotos = (order.report?.photosAfter?.length ?? 0) > 0;

        if (!hasBeforePhotos) {
          return ctx.scene.enter(SceneConst.BEFORE_PHOTOS_SCENE);
        }
        if (!hasAfterPhotos) {
          return ctx.scene.enter(SceneConst.AFTER_PHOTOS_SCENE);
        }
        return ctx.scene.enter(SceneConst.SUBMIT_SCENE);
      }

      case OrderStatus.RevisionRequired:
        return ctx.scene.enter(SceneConst.REVISION_SCENE);

      default: {
        const action = resolveContinueAction(order.status);
        await ctx.reply(action.hint ?? ExecutorConst.MyOrdersCannotContinue, {
          parse_mode: 'HTML',
        });
        return;
      }
    }
  }
}