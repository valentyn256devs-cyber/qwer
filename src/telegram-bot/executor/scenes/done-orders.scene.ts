import { Action, Ctx, Hears, Wizard, WizardStep } from 'nestjs-telegraf';
import { Markup } from 'telegraf';
import { OrdersService } from '../../../orders/orders.service';
import { BurialsService } from '../../../burials/burials.service';
import {
  ExecutorMenu,
  Scene as SceneConst,
  executorMainMenuButtons,
} from '../../telegram-constants';
import { ExecutorConst } from '../model/executor-const';
import {
  DONE_ORDER_STATUSES,
  ExecutorOrder,
  buildPaginatedOrderKeyboard,
  clearInlineKeyboard,
  formatOrderDetails,
  paginate,
} from '../model/executor-order-view';
import type { ExecutorWizardContext } from '../interfaces/executor-wizard-context.interface';

/** Спільна частина callback_data для цієї сцени */
const CB_PREFIX = 'executor_doneorders_';

/** Скільки замовлень показувати на одній сторінці */
const PAGE_SIZE = 5;

/**
 * «Виконані замовлення» — завершені замовлення виконавця.
 *
 * Список з пагінацією → деталі (тільки перегляд) → назад до списку.
 * Є кнопка «Скасувати перегляд» для виходу до головного меню.
 */
@Wizard(SceneConst.DONE_ORDERS_SCENE)
export class DoneOrdersScene {
  constructor(
    private readonly ordersService: OrdersService,
    private readonly burialsService: BurialsService,
  ) {}

  // ==================== Крок 1: перша сторінка списку ====================

  @WizardStep(1)
  async stepShowDoneOrders(@Ctx() ctx: ExecutorWizardContext) {
    ctx.session = ctx.session || {};
    ctx.session.doneOrdersPage = 0;
    await this.showDoneOrdersPage(ctx, 0);
  }

  // ==================== Пагінація ====================

  @Action(`${CB_PREFIX}next`)
  async onNextPage(@Ctx() ctx: ExecutorWizardContext) {
    await ctx.answerCbQuery?.();
    await clearInlineKeyboard(ctx);
    const current = ctx.session?.doneOrdersPage ?? 0;
    await this.showDoneOrdersPage(ctx, current + 1);
  }

  @Action(`${CB_PREFIX}prev`)
  async onPrevPage(@Ctx() ctx: ExecutorWizardContext) {
    await ctx.answerCbQuery?.();
    await clearInlineKeyboard(ctx);
    const current = ctx.session?.doneOrdersPage ?? 0;
    await this.showDoneOrdersPage(ctx, current - 1);
  }

  /** Індикатор сторінки — нічого не робимо */
  @Action(`${CB_PREFIX}noop`)
  async onNoop(@Ctx() ctx: ExecutorWizardContext) {
    await ctx.answerCbQuery?.();
    await clearInlineKeyboard(ctx);
  }

  // ==================== Перегляд деталей ====================

  @Action(new RegExp(`^${CB_PREFIX}open_(.+)$`))
  async onOpenOrder(@Ctx() ctx: ExecutorWizardContext) {
    const orderId = ((ctx as any).match as RegExpExecArray | null)?.[1] ?? '';
    await ctx.answerCbQuery?.();
    await clearInlineKeyboard(ctx);
    if (!orderId) return;
    await this.showOrderDetails(ctx, orderId);
  }

  /** Назад до списку з деталей */
  @Action(`${CB_PREFIX}back`)
  async onBackToList(@Ctx() ctx: ExecutorWizardContext) {
    await ctx.answerCbQuery?.();
    await clearInlineKeyboard(ctx);
    const current = ctx.session?.doneOrdersPage ?? 0;
    await this.showDoneOrdersPage(ctx, current);
  }

  // ==================== Скасування перегляду / меню ====================

  @Action(`${CB_PREFIX}cancel`)
  async onCancel(@Ctx() ctx: ExecutorWizardContext) {
    await ctx.answerCbQuery?.();
    await clearInlineKeyboard(ctx);
    await ctx.reply(ExecutorConst.BackToMenuMessage, {
      reply_markup: executorMainMenuButtons,
    });
    return ctx.scene.leave();
  }

  @Action(`${CB_PREFIX}menu`)
  async onBackToMenu(@Ctx() ctx: ExecutorWizardContext) {
    await ctx.answerCbQuery?.();
    await clearInlineKeyboard(ctx);
    await ctx.reply(ExecutorConst.BackToMenuMessage, {
      reply_markup: executorMainMenuButtons,
    });
    return ctx.scene.leave();
  }

  // ==================== Кнопки головного меню (щоб не «застрягти» в сцені) ====================

  @Hears(ExecutorMenu.MyOrders)
  async onMyOrdersMenu(@Ctx() ctx: ExecutorWizardContext) {
    return ctx.scene.enter(SceneConst.MY_ORDERS_SCENE);
  }

  @Hears(ExecutorMenu.OpenOrders)
  async onOpenOrdersMenu(@Ctx() ctx: ExecutorWizardContext) {
    return ctx.scene.enter(SceneConst.OPEN_ORDERS_SCENE);
  }

  @Hears(ExecutorMenu.DoneOrders)
  async onDoneOrdersMenu(@Ctx() ctx: ExecutorWizardContext) {
    ctx.session = ctx.session || {};
    ctx.session.doneOrdersPage = 0;
    await this.showDoneOrdersPage(ctx, 0);
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

  private async loadDoneOrders(ctx: ExecutorWizardContext): Promise<ExecutorOrder[]> {
    const executorId = ctx.from?.id?.toString() ?? '';
    const orders = (await this.ordersService.findByExecutorId(executorId)) as ExecutorOrder[];
    return (orders ?? []).filter((order) => DONE_ORDER_STATUSES.includes(order.status));
  }

  private async showDoneOrdersPage(ctx: ExecutorWizardContext, page: number) {
    await ctx.reply(ExecutorConst.DoneOrdersLoading, { parse_mode: 'HTML' });

    let done: ExecutorOrder[];
    try {
      done = await this.loadDoneOrders(ctx);
    } catch (error) {
      console.error('Не вдалося завантажити «Виконані замовлення»:', error);
      await ctx.reply(ExecutorConst.DoneOrdersError, {
        reply_markup: Markup.inlineKeyboard([
          [Markup.button.callback(ExecutorConst.BackToMenu, `${CB_PREFIX}menu`)],
        ]).reply_markup,
      });
      return;
    }

    if (done.length === 0) {
      await ctx.reply(ExecutorConst.DoneOrdersEmpty, {
        parse_mode: 'HTML',
        reply_markup: Markup.inlineKeyboard([
          [Markup.button.callback(ExecutorConst.BackToMenu, `${CB_PREFIX}menu`)],
        ]).reply_markup,
      });
      return;
    }

    const result = paginate(done, page, PAGE_SIZE);

    // Зберігаємо обмежену сторінку (на випадок, якщо передали неіснуючу)
    ctx.session = ctx.session || {};
    ctx.session.doneOrdersPage = result.page;

    const keyboard = buildPaginatedOrderKeyboard(
      result.items,
      result.page,
      result.totalPages,
      CB_PREFIX,
    );

    await ctx.reply(ExecutorConst.DoneOrdersTitle(done.length), {
      parse_mode: 'HTML',
      reply_markup: keyboard.reply_markup,
    });
  }

  private async showOrderDetails(ctx: ExecutorWizardContext, orderId: string) {
    const order = (await this.loadDoneOrders(ctx)).find((o) => o.id === orderId);

    if (!order) {
      await ctx.reply(ExecutorConst.OrderNotFoundSimple);
      return;
    }

    const burial = order.details?.burialId
      ? await this.burialsService.findBurialById(order.details.burialId).catch(() => undefined)
      : undefined;

    await ctx.reply(formatOrderDetails(order, burial), { parse_mode: 'HTML' });

    await ctx.reply(ExecutorConst.ChooseAction, {
      reply_markup: Markup.inlineKeyboard([
        [Markup.button.callback(ExecutorConst.MyOrdersBackButton, `${CB_PREFIX}back`)],
        [Markup.button.callback(ExecutorConst.BackToMenu, `${CB_PREFIX}menu`)],
      ]).reply_markup,
    });
  }
}