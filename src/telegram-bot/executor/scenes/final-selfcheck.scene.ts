import { Action, Ctx, Wizard, WizardStep } from 'nestjs-telegraf';
import { Logger } from '@nestjs/common';
import { Markup } from 'telegraf';
import { OrdersService } from '../../../orders/orders.service';
import { Scene as SceneConst } from '../../telegram-constants';
import { ExecutorConst } from '../model/executor-const';
import { requireExecutorOrder } from '../model/executor-scene-helpers';
import type { ExecutorWizardContext } from '../interfaces/executor-wizard-context.interface';

export interface ChecklistStep {
  id: string;
  title: string;
  description?: string;
  type: string;
  required: boolean;
  order: number;
  validation?: any;
  guide?: string;
  minPhotos?: number;
  maxPhotos?: number;
}

interface ChecklistAnswer {
  answer: string;
  answeredAt: Date;
  answeredBy: string;
}

@Wizard(SceneConst.FINAL_SELFCHECK_SCENE)
export class FinalSelfcheckScene {
  private readonly logger = new Logger(FinalSelfcheckScene.name);
  constructor(private readonly ordersService: OrdersService) {}

  @WizardStep(1)
  async stepSelfcheck(@Ctx() ctx: ExecutorWizardContext) {
    this.logger.log(`[FinalSelfcheckScene] stepSelfcheck`, { userId: ctx.from?.id, orderId: ctx.session?.orderId });
    const order = await requireExecutorOrder(ctx, this.ordersService);
    if (!order) return;

    const steps: ChecklistStep[] = ((order as any).checklist as any)?.steps ?? [];
    const requiredSteps = steps.filter(s => s.required);

    // Отримуємо збережені відповіді та фото з замовлення
    const answers: Record<string, ChecklistAnswer> = ((order as any).checklistAnswers as any) ?? {};
    const photos: Record<string, string[]> = ((order as any).checklistPhotos as any) ?? {};

    // Перевіряємо, чи всі required кроки мають відповіді
    const incompleteSteps = requiredSteps.filter((s) => {
      const answer = answers[s.id];
      const stepPhotos = photos[s.id] ?? [];
      const hasAnswer = !!answer && (answer.answer === 'confirmed' || answer.answer === 'yes' || answer.answer === 'photo' || answer.answer?.startsWith('text:'));
      const hasPhotos = stepPhotos.length > 0;
      return !hasAnswer && !hasPhotos;
    });

    const summaryLines = requiredSteps.map((s, i) => {
      const answer = answers[s.id];
      const stepPhotos = photos[s.id] ?? [];
      const photoCount = stepPhotos.length;

      let statusIcon = '⬜';
      let statusText = 'Не виконано';

      if (answer) {
        const answerType = answer.answer;
        if (answerType === 'confirmed' || answerType === 'yes' || answerType === 'photo') {
          statusIcon = '✅';
          statusText = 'Виконано';
        } else if (answerType === 'no') {
          statusIcon = '❌';
          statusText = 'Відхилено';
        } else {
          statusIcon = '✏️';
          statusText = `Відповідь: ${answerType}`;
        }
      }

      const photoInfo = photoCount > 0 ? ` 📸 ${photoCount} фото` : '';

      return `${i + 1}. ${statusIcon} <b>${s.title}</b> — ${statusText}${photoInfo}`;
    });

    const allRequiredCompleted = incompleteSteps.length === 0;

    const summary =
      `🔍 <b>Фінальна self-check перевірка</b>\n\n` +
      `Ось статус виконання required кроків чекліста:\n\n` +
      summaryLines.join('\n') +
      (incompleteSteps.length > 0
        ? `\n\n⚠️ Не всі обовʼязкові кроки виконані: ${incompleteSteps.map(s => s.title).join(', ')}`
        : '\n\n✅ Всі обовʼязкові кроки виконано.') +
      `\n\nПереконайтеся, що всі роботи виконані.`;

    const buttons: any[][] = [];

    if (allRequiredCompleted) {
      buttons.push([
        Markup.button.callback(ExecutorConst.ConfirmSelfcheckButton, 'executor_confirm_selfcheck'),
      ]);
    } else {
      buttons.push([
        Markup.button.callback(
          '⚠️ Не всі кроки виконані',
          'executor_selfcheck_blocked',
        ),
      ]);
    }

    buttons.push([
      Markup.button.callback(ExecutorConst.BackToChecklist, 'executor_back_to_checklist'),
    ]);

    await ctx.reply(summary, {
      parse_mode: 'HTML',
      reply_markup: Markup.inlineKeyboard(buttons).reply_markup,
    });
  }

  /** Підтвердження self-check → перехід до фото «після». */
  @Action('executor_confirm_selfcheck')
  async onConfirmSelfcheck(@Ctx() ctx: ExecutorWizardContext) {
    this.logger.log(`[FinalSelfcheckScene] onConfirmSelfcheck`, { userId: ctx.from?.id, orderId: ctx.session?.orderId });
    await ctx.answerCbQuery?.();

    // Повторна перевірка перед переходом
    const order = await requireExecutorOrder(ctx, this.ordersService);
    if (!order) return;

    const steps: ChecklistStep[] = ((order as any).checklist as any)?.steps ?? [];
    const requiredSteps = steps.filter(s => s.required);
    const answers: Record<string, ChecklistAnswer> = ((order as any).checklistAnswers as any) ?? {};
    const photos: Record<string, string[]> = ((order as any).checklistPhotos as any) ?? {};

    const incomplete = requiredSteps.filter((s) => {
      const answer = answers[s.id];
      const stepPhotos = photos[s.id] ?? [];
      const hasAnswer = !!answer && (answer.answer === 'confirmed' || answer.answer === 'yes' || answer.answer === 'photo' || answer.answer?.startsWith('text:'));
      const hasPhotos = stepPhotos.length > 0;
      return !hasAnswer && !hasPhotos;
    });

    if (incomplete.length > 0) {
      await ctx.reply(
        `⚠️ Не можна перейти до фото «після», поки не виконано всі обовʼязкові кроки: ${incomplete.map(s => s.title).join(', ')}`,
        { parse_mode: 'HTML' },
      );
      return;
    }

    return ctx.scene.enter(SceneConst.AFTER_PHOTOS_SCENE);
  }

  /** Блокована спроба підтвердження — не всі кроки виконані. */
  @Action('executor_selfcheck_blocked')
  async onSelfcheckBlocked(@Ctx() ctx: ExecutorWizardContext) {
    this.logger.log(`[FinalSelfcheckScene] onSelfcheckBlocked`, { userId: ctx.from?.id, orderId: ctx.session?.orderId });
    await ctx.answerCbQuery?.();
    await ctx.reply(
      `⚠️ Спочатку виконайте всі обовʼязкові кроки чек-листа, перш ніж підтверджувати self-check.`,
      { parse_mode: 'HTML' },
    );
  }

  /** Назад до чекліста. */
  @Action('executor_back_to_checklist')
  async onBackToChecklist(@Ctx() ctx: ExecutorWizardContext) {
    this.logger.log(`[FinalSelfcheckScene] onBackToChecklist`, { userId: ctx.from?.id });
    await ctx.answerCbQuery?.();
    return ctx.scene.enter(SceneConst.SERVICE_CHECKLIST_SCENE);
  }
}
