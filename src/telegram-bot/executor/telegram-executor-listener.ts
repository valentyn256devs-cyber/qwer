import { Action, Command, Ctx, Hears, On, Start, Update } from 'nestjs-telegraf';
import { Markup } from 'telegraf';
import type { SceneContext } from 'telegraf/scenes';
import { OrdersService } from '../../orders/orders.service';
import { PerformersService } from '../../performers/performers.service';
import { PerformerConst } from '../../performers/performer-const';
import {
  ExecutorInabilityReason,
  ExecutorInabilityReasonLabels,
  ExecutorInabilityReasonsRequiringComment,
} from '../../orders/models/order-status';
import { executorMainMenuButtons, ExecutorMenu, Scene } from '../telegram-constants';
import { ExecutorConst } from './model/executor-const';

/** Req 48: Help / Report problem reasons (no status change) */
const PROBLEM_REASONS = [
  'Не можу знайти поховання',
  'Немає доступу',
  'Невірна інформація',
  'Пошкодження памʼятника',
  'Погодні умови',
  'Питання по виконанню',
  'Інше',
] as const;

@Update()
export class TelegramExecutorListener {
  constructor(
    private readonly ordersService: OrdersService,
    private readonly performersService: PerformersService,
  ) {
  }

  @Start()
  async onStart(@Ctx() ctx: any) {
    const telegramId = ctx.from?.id?.toString() ?? '';

    // Якщо виконавця ще немає в базі — запускаємо коротку анкету
    try {
      const exists = await this.performersService.exists(telegramId);
      if (!exists) {
        await ctx.reply(
          `${PerformerConst.OnboardingWelcomeTitle}\n\n${PerformerConst.OnboardingWelcomeDescription}`,
          { parse_mode: 'HTML' },
        );
        return ctx.scene.enter(Scene.CREATE_PERFORMER_WIZARD);
      }
    } catch (error) {
      // Якщо перевірка не вдалася — не блокуємо користувача
      console.error('Помилка перевірки виконавця:', error);
    }

    await ctx.reply(ExecutorConst.Welcome, {
      reply_markup: executorMainMenuButtons,
    });
  }

  @Hears(ExecutorMenu.OpenOrders)
  @Command('open_orders')
  async onOpenOrders(@Ctx() ctx: SceneContext) {
    await ctx.scene.enter(Scene.OPEN_ORDERS_SCENE);
  }

  @Hears(ExecutorMenu.MyOrders)
  @Command('my_orders')
  async onMyOrders(@Ctx() ctx: SceneContext) {
    await ctx.scene.enter(Scene.MY_ORDERS_SCENE);
  }

  @Hears(ExecutorMenu.DoneOrders)
  @Command('done_orders')
  async onDoneOrders(@Ctx() ctx: SceneContext) {
    await ctx.scene.enter(Scene.DONE_ORDERS_SCENE);
  }

  // ==================== Підтвердження / відмова від нового замовлення ====================

  @Action(/^executor_confirm_order_(.+)$/)
  async onConfirmOrder(@Ctx() ctx: any) {
    const orderId = ctx.match?.[1] ?? '';
    const executorId = ctx.from?.id?.toString() ?? '';
    await ctx.answerCbQuery?.();
    if (!orderId || !executorId) return;

    // Перевіряємо, чи замовлення вже має виконавця — якщо так, показуємо конфлікт
    try {
      const existing = await this.ordersService.findById(orderId);
      const currentExecutor = existing?.assignment?.executorId ?? null;
      if (currentExecutor && currentExecutor !== executorId) {
        await ctx
          .editMessageText(ExecutorConst.NewOrderTakenByOther(orderId), {
            parse_mode: 'HTML',
          })
          .catch(() => null);
      } else if (currentExecutor === executorId) { // Якщо цей самий виконавець уже підтвердив — просто оновлюємо повідомлення
        await ctx
          .editMessageText(ExecutorConst.NewOrderConfirmedByMe(orderId), {
            parse_mode: 'HTML',
          })
          .catch(() => null);
        return;
      }
    } catch {
      // Якщо перевірка не вдалася — не блокуємо, assignExecutor сам перевірить
    }

    try {
      await this.ordersService.assignExecutor(orderId, executorId, 'executor_bot');
      // Сповіщаємо адміністратора, що виконавець підтвердив замовлення
      await this.ordersService.notifyAdminAboutExecutorConfirm(orderId, executorId);
      await ctx.editMessageText(ExecutorConst.NewOrderConfirmedByMe(orderId), {
        parse_mode: 'HTML',
      }).catch(() => null);
    } catch {
      // Перед перевірка вже обробила конфлікт — тут просто показуємо загальну помилку
      await ctx.reply(ExecutorConst.NewOrderConfirmError).catch(() => null);
    }
  }

  @Action(/^executor_decline_order_(.+)$/)
  async onDeclineOrder(@Ctx() ctx: any) {
    const orderId = ctx.match?.[1] ?? '';
    await ctx.answerCbQuery?.();
    if (!orderId) return;
    await ctx
      .editMessageText(ExecutorConst.NewOrderDeclinedByMe(orderId), {
        parse_mode: 'HTML',
      })
      .catch(() => null);
  }

  @Hears(ExecutorMenu.Help)
  @Command('help')
  async onHelp(@Ctx() ctx: SceneContext) {
    await ctx.reply(ExecutorConst.HelpPrompt, {
      reply_markup: Markup.inlineKeyboard([
        [Markup.button.callback(ExecutorConst.ProblemButton, 'executor_report_problem_pick')],
        [Markup.button.callback(ExecutorConst.CannotCompleteHelpButton, 'executor_cannot_complete_pick')],
        [Markup.button.callback(ExecutorConst.BackToMenu, 'executor_back_to_menu')],
      ]).reply_markup,
    });
  }

  // ==================== Req 43: Executor cannot complete ====================

  @Action(/^executor_cannot_complete_(.+)$/)
  async onCannotComplete(@Ctx() ctx: any) {
    const orderId = ctx.match[1];
    await ctx.answerCbQuery?.();
    const buttons = (Object.values(ExecutorInabilityReason) as ExecutorInabilityReason[]).map((r) => [
      Markup.button.callback(ExecutorInabilityReasonLabels[r], `executor_inability_${orderId}_${r}`),
    ]);
    buttons.push([Markup.button.callback(ExecutorConst.CancelButton, 'executor_back_to_menu')]);
    await ctx.reply(ExecutorConst.CannotCompleteTitle, {
      parse_mode: 'HTML',
      reply_markup: Markup.inlineKeyboard(buttons).reply_markup,
    });
  }

  @Action('executor_cannot_complete_pick')
  async onCannotCompletePick(@Ctx() ctx: any) {
    await ctx.answerCbQuery?.();
    await ctx.reply(ExecutorConst.CannotCompletePickHint);
  }

  @Action(/^executor_inability_(.+?)_(.+)$/)
  async onInabilityReason(@Ctx() ctx: any) {
    const orderId = ctx.match[1];
    const reason = ctx.match[2] as ExecutorInabilityReason;
    await ctx.answerCbQuery?.();
    const needsComment = ExecutorInabilityReasonsRequiringComment.includes(reason);
    ctx.session = ctx.session || {};
    ctx.session.executorInability = { orderId, reason };
    if (needsComment) {
      await ctx.reply(ExecutorConst.InabilityCommentPrompt);
      return;
    }
    await this.submitInability(ctx, orderId, reason, undefined);
  }

  @On('text')
  async onTextForFlows(@Ctx() ctx: any) {
    if (ctx.scene?.current) return;
    const text = ctx.message?.text?.trim();
    if (!text) return;

    // Req 43: inability comment
    const pending = ctx.session?.executorInability;
    if (pending?.orderId && pending?.reason) {
      const { orderId, reason } = pending;
      ctx.session.executorInability = null;
      await this.submitInability(ctx, orderId, reason, text);
      return;
    }

    // Req 48: problem comment -> move to photo collection
    const prob = ctx.session?.executorProblem;
    if (prob?.orderId && prob?.step === 'comment') {
      ctx.session.executorProblem = { ...prob, comment: text, step: 'photos' };
      await ctx.reply(ExecutorConst.ProblemPhotosPrompt, {
        reply_markup: Markup.inlineKeyboard([
          [Markup.button.callback(ExecutorConst.SendButton, 'executor_problem_send')],
          [Markup.button.callback(ExecutorConst.SkipPhotosButton, 'executor_problem_skip_photos')],
          [Markup.button.callback(ExecutorConst.CancelButton, 'executor_back_to_menu')],
        ]).reply_markup,
      });
      return;
    }
  }

  @On('photo')
  async onPhotoForProblem(@Ctx() ctx: any) {
    if (ctx.scene?.current) return;
    const prob = ctx.session?.executorProblem;
    if (!prob?.orderId || prob?.step !== 'photos') return;
    const photos = ctx.message?.photo;
    const fileId = photos?.[photos.length - 1]?.file_id;
    if (!fileId) return;
    const ids = [...(prob.photoFileIds || []), fileId];
    ctx.session.executorProblem = { ...prob, photoFileIds: ids };
    await ctx.reply(ExecutorConst.ProblemPhotoAdded(ids.length), {
      reply_markup: Markup.inlineKeyboard([
        [Markup.button.callback(ExecutorConst.SendButton, 'executor_problem_send')],
        [Markup.button.callback(ExecutorConst.CancelButton, 'executor_back_to_menu')],
      ]).reply_markup,
    });
  }

  @Action('executor_back_to_menu')
  async onBackToMenu(@Ctx() ctx: any) {
    await ctx.answerCbQuery?.();
    ctx.session = ctx.session || {};
    ctx.session.executorInability = null;
    ctx.session.executorProblem = null;
    await ctx.reply(ExecutorConst.Welcome, { reply_markup: executorMainMenuButtons });
  }

  @Action('executor_report_problem_pick')
  async onReportProblemPick(@Ctx() ctx: any) {
    await ctx.answerCbQuery?.();
    await ctx.reply(ExecutorConst.ReportProblemPickHint);
  }

  // ==================== Req 48: Help / Problem flow (no status change) ====================

  @Action(/^executor_report_problem_(.+)$/)
  async onReportProblem(@Ctx() ctx: any) {
    const orderId = ctx.match[1];
    await ctx.answerCbQuery?.();
    ctx.session = ctx.session || {};
    ctx.session.executorProblem = { orderId, step: 'reason', photoFileIds: [] };
    const buttons = PROBLEM_REASONS.map((r, i) => [
      Markup.button.callback(r, `executor_problem_reason_${orderId}_${i}`),
    ]);
    buttons.push([Markup.button.callback(ExecutorConst.CancelButton, 'executor_back_to_menu')]);
    await ctx.reply(ExecutorConst.ReportProblemTitle, {
      parse_mode: 'HTML',
      reply_markup: Markup.inlineKeyboard(buttons).reply_markup,
    });
  }

  @Action(/^executor_problem_reason_(.+?)_(\d+)$/)
  async onProblemReason(@Ctx() ctx: any) {
    const orderId = ctx.match[1];
    const idx = parseInt(ctx.match[2], 10);
    const reason = PROBLEM_REASONS[idx] ?? 'Інше';
    await ctx.answerCbQuery?.();
    ctx.session = ctx.session || {};
    ctx.session.executorProblem = {
      ...(ctx.session.executorProblem || {}),
      orderId,
      reason,
      step: 'comment',
      photoFileIds: []
    };
    await ctx.reply(ExecutorConst.ProblemCommentPrompt, {
      reply_markup: Markup.inlineKeyboard([[Markup.button.callback(ExecutorConst.CancelButton, 'executor_back_to_menu')]]).reply_markup,
    });
  }

  @Action('executor_problem_send')
  async onProblemSend(@Ctx() ctx: any) {
    await ctx.answerCbQuery?.();
    const p = ctx.session?.executorProblem;
    if (!p?.orderId || !p?.reason) {
      await ctx.reply(ExecutorConst.NoActiveProblemReport);
      return;
    }
    await this.submitProblem(ctx, p);
  }

  @Action('executor_problem_skip_photos')
  async onProblemSkipPhotos(@Ctx() ctx: any) {
    await ctx.answerCbQuery?.();
    const p = ctx.session?.executorProblem;
    if (!p?.orderId || !p?.reason) return;
    await this.submitProblem(ctx, p);
  }

  @Action(/^executor_clarify/)
  @Action(/^executor_propose_update/)
  async onPlaceholderActions(@Ctx() ctx: any) {
    await ctx.answerCbQuery?.(ExecutorConst.PlaceholderActionHint);
  }

  private async submitProblem(ctx: any, p: any) {
    const executorId = ctx.from?.id?.toString?.() ?? '';
    try {
      await this.ordersService.reportExecutorProblem({
        orderId: p.orderId,
        executorId,
        reason: p.reason,
        comment: p.comment,
        photoFileIds: p.photoFileIds || [],
      });
      ctx.session.executorProblem = null;
      await ctx.reply(ExecutorConst.ProblemSentSuccess, {
        reply_markup: executorMainMenuButtons,
      });
    } catch (e: any) {
      await ctx.reply(`❌ ${e?.message ?? ExecutorConst.SendErrorMessage}`, {
        reply_markup: executorMainMenuButtons,
      });
    }
  }

  private async submitInability(ctx: any, orderId: string, reason: ExecutorInabilityReason, comment?: string) {
    const executorId = ctx.from?.id?.toString?.() ?? '';
    try {
      await this.ordersService.reportExecutorInability(orderId, executorId, reason, comment);
      await ctx.reply(ExecutorConst.InabilitySentSuccess, {
        parse_mode: 'HTML',
        reply_markup: executorMainMenuButtons,
      });
    } catch (e: any) {
      await ctx.reply(`❌ ${e?.message ?? ExecutorConst.SendErrorMessage}`, {
        reply_markup: executorMainMenuButtons,
      });
    }
  }

}
