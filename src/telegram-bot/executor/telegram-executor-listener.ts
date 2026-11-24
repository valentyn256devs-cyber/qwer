import { Action, Command, Ctx, Hears, On, Start, Update } from 'nestjs-telegraf';
import { Logger } from '@nestjs/common';
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
  private readonly logger = new Logger(TelegramExecutorListener.name);
  constructor(
    private readonly ordersService: OrdersService,
    private readonly performersService: PerformersService,
  ) {
  }

  @Start()
  async onStart(@Ctx() ctx: any) {
    this.logger.log(`[TelegramExecutorListener] onStart`, { userId: ctx.from?.id, username: ctx.from?.username });
    const telegramId = ctx.from?.id?.toString() ?? '';

    // Якщо виконавця ще немає в базі — запускаємо коротку анкету
    try {
      const exists = await this.performersService.exists(telegramId);
      if (!exists) {
        await ctx.reply(
          `${PerformerConst.OnboardingWelcomeTitle}\n\n${PerformerConst.OnboardingWelcomeDescription}`,
          { parse_mode: 'HTML' },
        );
        // ctx.scene is provided by telegraf's Scenes.Stage middleware. It is
        // registered by ListenersExplorerService.onModuleInit(), which runs
        // after bot.launch() in nestjs-telegraf's createBotFactory. If a /start
        // update arrives during that initialization window, ctx.scene may be
        // undefined — guard against it to avoid crashing the handler.
        if (ctx.scene) {
          return ctx.scene.enter(Scene.CREATE_PERFORMER_WIZARD);
        }
        this.logger.warn('ctx.scene is not available yet, skipping performer onboarding scene entry');
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
    this.logger.log(`[TelegramExecutorListener] onOpenOrders`, { userId: ctx.from?.id });
    await ctx.scene.enter(Scene.OPEN_ORDERS_SCENE);
  }

  @Hears(ExecutorMenu.MyOrders)
  @Command('my_orders')
  async onMyOrders(@Ctx() ctx: SceneContext) {
    this.logger.log(`[TelegramExecutorListener] onMyOrders`, { userId: ctx.from?.id });
    await ctx.scene.enter(Scene.MY_ORDERS_SCENE);
  }

  @Hears(ExecutorMenu.DoneOrders)
  @Command('done_orders')
  async onDoneOrders(@Ctx() ctx: SceneContext) {
    this.logger.log(`[TelegramExecutorListener] onDoneOrders`, { userId: ctx.from?.id });
    await ctx.scene.enter(Scene.DONE_ORDERS_SCENE);
  }

  // ==================== Підтвердження / відмова від нового замовлення ====================

  @Action(/^executor_confirm_order_(.+)$/)
  async onConfirmOrder(@Ctx() ctx: any) {
    this.logger.log(`[TelegramExecutorListener] onConfirmOrder`, { userId: ctx.from?.id, orderId: ctx.match?.[1] });
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
    this.logger.log(`[TelegramExecutorListener] onDeclineOrder`, { userId: ctx.from?.id, orderId: ctx.match?.[1] });
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
    this.logger.log(`[TelegramExecutorListener] onHelp`, { userId: ctx.from?.id });
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
    this.logger.log(`[TelegramExecutorListener] onCannotComplete`, { userId: ctx.from?.id, orderId: ctx.match?.[1] });
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
    this.logger.log(`[TelegramExecutorListener] onCannotCompletePick`, { userId: ctx.from?.id });
    await ctx.answerCbQuery?.();
    await ctx.reply(ExecutorConst.CannotCompletePickHint);
  }

  @Action(/^executor_inability_(.+?)_(.+)$/)
  async onInabilityReason(@Ctx() ctx: any) {
    this.logger.log(`[TelegramExecutorListener] onInabilityReason`, { userId: ctx.from?.id, orderId: ctx.match?.[1], reason: ctx.match?.[2] });
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

  @On('photo')
  async onPhotoForProblem(@Ctx() ctx: any) {
    this.logger.log(`[TelegramExecutorListener] onPhotoForProblem`, { userId: ctx.from?.id, scene: ctx.scene?.current?.id });
    if (ctx.scene?.current) return;
    const photos = ctx.message?.photo;
    const fileId = photos?.[photos.length - 1]?.file_id;
    if (!fileId) return;

    // Photo for problem report
    const prob = ctx.session?.executorProblem;
    if (prob?.orderId && prob?.step === 'photos') {
      const ids = [...(prob.photoFileIds || []), fileId];
      ctx.session.executorProblem = { ...prob, photoFileIds: ids };
      await ctx.reply(ExecutorConst.ProblemPhotoAdded(ids.length), {
        reply_markup: Markup.inlineKeyboard([
          [Markup.button.callback(ExecutorConst.SendButton, 'executor_problem_send')],
          [Markup.button.callback(ExecutorConst.CancelButton, 'executor_back_to_menu')],
        ]).reply_markup,
      });
      return;
    }

    // Photo for clarification response
    const clar = ctx.session?.executorClarification;
    if (clar?.orderId) {
      clar.photoFileIds = [...(clar.photoFileIds || []), fileId];
      await ctx.reply(`📸 Фото додано (${clar.photoFileIds.length} шт.). Надішліть ще фото або напишіть коментар, а потім надішліть відповідь через меню або повторно оберіть замовлення у «Моїх замовленнях».`);
      return;
    }
  }

  @Action('executor_back_to_menu')
  async onBackToMenu(@Ctx() ctx: any) {
    this.logger.log(`[TelegramExecutorListener] onBackToMenu`, { userId: ctx.from?.id });
    await ctx.answerCbQuery?.();
    ctx.session = ctx.session || {};
    ctx.session.executorInability = null;
    ctx.session.executorProblem = null;
    await ctx.reply(ExecutorConst.Welcome, { reply_markup: executorMainMenuButtons });
  }

  @Action('executor_report_problem_pick')
  async onReportProblemPick(@Ctx() ctx: any) {
    this.logger.log(`[TelegramExecutorListener] onReportProblemPick`, { userId: ctx.from?.id });
    await ctx.answerCbQuery?.();
    await ctx.reply(ExecutorConst.ReportProblemPickHint);
  }

  // ==================== Req 48: Help / Problem flow (no status change) ====================

  @Action(/^executor_report_problem_(.+)$/)
  async onReportProblem(@Ctx() ctx: any) {
    this.logger.log(`[TelegramExecutorListener] onReportProblem`, { userId: ctx.from?.id, orderId: ctx.match?.[1] });
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
    this.logger.log(`[TelegramExecutorListener] onProblemReason`, { userId: ctx.from?.id, orderId: ctx.match?.[1], reason: PROBLEM_REASONS[parseInt(ctx.match?.[2] ?? '0', 10)] ?? 'Інше' });
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
    this.logger.log(`[TelegramExecutorListener] onProblemSend`, { userId: ctx.from?.id, orderId: ctx.session?.executorProblem?.orderId });
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
    this.logger.log(`[TelegramExecutorListener] onProblemSkipPhotos`, { userId: ctx.from?.id, orderId: ctx.session?.executorProblem?.orderId });
    await ctx.answerCbQuery?.();
    const p = ctx.session?.executorProblem;
    if (!p?.orderId || !p?.reason) return;
    await this.submitProblem(ctx, p);
  }

  @Action(/^executor_clarify/)
  @Action(/^executor_propose_update/)
  async onPlaceholderActions(@Ctx() ctx: any) {
    this.logger.log(`[TelegramExecutorListener] onPlaceholderActions`, { userId: ctx.from?.id, callbackData: ctx.callbackQuery?.data });
    await ctx.answerCbQuery?.(ExecutorConst.PlaceholderActionHint);
  }

  // ==================== Executor responds to admin clarification ====================

  @Action(/^executor_respond_clarification_(.+)$/)
  async onRespondClarification(@Ctx() ctx: any) {
    this.logger.log(`[TelegramExecutorListener] onRespondClarification`, { userId: ctx.from?.id, orderId: ctx.match?.[1] });
    const orderId = ctx.match?.[1] ?? '';
    const executorId = ctx.from?.id?.toString() ?? '';
    await ctx.answerCbQuery?.();
    if (!orderId || !executorId) return;

    ctx.session = ctx.session || {};
    ctx.session.executorClarification = { orderId, photoFileIds: [] };

    await ctx.reply(
      `❓ <b>Відповідь на уточнення адміністратора (замовлення №${orderId})</b>\n\n` +
      `Надішліть коментар та/або фото як відповідь на уточнення.`,
      { parse_mode: 'HTML' },
    );
  }

  @Action(/^executor_go_checklist_(.+)$/)
  async onGoChecklist(@Ctx() ctx: any) {
    this.logger.log(`[TelegramExecutorListener] onGoChecklist`, { userId: ctx.from?.id, orderId: ctx.match?.[1] });
    const orderId = ctx.match?.[1] ?? '';
    await ctx.answerCbQuery?.();
    if (!orderId) return;
    ctx.session = ctx.session || {};
    ctx.session.orderId = orderId;
    return ctx.scene.enter(Scene.SERVICE_CHECKLIST_SCENE);
  }

  @On('text')
  async onTextForFlows(@Ctx() ctx: any) {
    this.logger.log(`[TelegramExecutorListener] onTextForFlows`, { userId: ctx.from?.id, text: ctx.message?.text?.trim() });
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

    // Executor clarification response (text)
    const clar = ctx.session?.executorClarification;
    if (clar?.orderId) {
      const executorId = ctx.from?.id?.toString() ?? '';
      clar.comment = text;
      try {
        await this.ordersService.respondToAdminClarification(
          clar.orderId,
          executorId,
          clar.comment,
          clar.photoFileIds,
        );
        ctx.session.executorClarification = null;
        await ctx.reply(
          `✅ Вашу відповідь на уточнення надіслано адміністратору (замовлення №${clar.orderId}).`,
          { reply_markup: executorMainMenuButtons },
        );
      } catch (e: any) {
        await ctx.reply(`❌ ${e?.message ?? 'Помилка надсилання відповіді.'}`, {
          reply_markup: executorMainMenuButtons,
        });
      }
      return;
    }
  }

  private async submitProblem(ctx: any, p: any) {
    this.logger.log(`[TelegramExecutorListener] submitProblem`, { userId: ctx.from?.id, orderId: p?.orderId, reason: p?.reason });
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
    this.logger.log(`[TelegramExecutorListener] submitInability`, { userId: ctx.from?.id, orderId, reason, comment });
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
