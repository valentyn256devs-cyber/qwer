import { Inject } from '@nestjs/common';
import { Action, Ctx, On, Wizard, WizardStep } from 'nestjs-telegraf';
import { Markup } from 'telegraf';
import { OrdersService } from '../../../orders/orders.service';
import { Scene as SceneConst } from '../../telegram-constants';
import { ExecutorConst } from '../model/executor-const';
import { requireExecutorOrder, saveChecklistPhoto } from '../model/executor-scene-helpers';
import { IMAGE_STORAGE_SERVICE } from '../../../images/image-storage.constants';
import type { ImageStorageService } from '../../../images/image-storage.interface';
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
  options?: string[]; // Для типу Select
}

@Wizard(SceneConst.SERVICE_CHECKLIST_SCENE)
export class ServiceChecklistScene {
  constructor(
    private readonly ordersService: OrdersService,
    @Inject(IMAGE_STORAGE_SERVICE)
    private readonly imageStorage: ImageStorageService,
  ) {}

  @WizardStep(1)
  async stepChecklist(@Ctx() ctx: ExecutorWizardContext) {
    console.log('[ServiceChecklistScene] stepChecklist: Чекліст послуг | UserId:', ctx.from?.id, '| OrderId:', ctx.session?.orderId, '| StepIndex:', ctx.wizard?.state?.stepIndex ?? 0);
    await this.renderCurrentStep(ctx, ctx.wizard?.state?.stepIndex ?? 0);
  }

  // ==================== Навігація по кроках ====================

  @Action(/^executor_next_step_(\d+)$/)
  async onNextStep(@Ctx() ctx: ExecutorWizardContext) {
    console.log('[ServiceChecklistScene] onNextStep: Наступний крок | UserId:', ctx.from?.id, '| Step:', ((ctx as any).match as RegExpExecArray | null)?.[1]);
    await ctx.answerCbQuery?.();
    const next = ((ctx as any).match as RegExpExecArray | null)?.[1];
    await this.renderCurrentStep(ctx, next ? parseInt(next, 10) : 0);
  }

  @Action(/^executor_prev_step_(\d+)$/)
  async onPrevStep(@Ctx() ctx: ExecutorWizardContext) {
    console.log('[ServiceChecklistScene] onPrevStep: Попередній крок | UserId:', ctx.from?.id, '| Step:', ((ctx as any).match as RegExpExecArray | null)?.[1]);
    await ctx.answerCbQuery?.();
    const prev = ((ctx as any).match as RegExpExecArray | null)?.[1];
    await this.renderCurrentStep(ctx, prev ? parseInt(prev, 10) : 0);
  }

  @Action(/^executor_done_step_(\d+)$/)
  async onDoneStep(@Ctx() ctx: ExecutorWizardContext) {
    console.log('[ServiceChecklistScene] onDoneStep: Крок виконано | UserId:', ctx.from?.id, '| Step:', ((ctx as any).match as RegExpExecArray | null)?.[1]);
    await ctx.answerCbQuery?.();
    const next = ((ctx as any).match as RegExpExecArray | null)?.[1];
    await this.renderCurrentStep(ctx, next ? parseInt(next, 10) : 0);
  }

  @Action(/^executor_check_step_(.+)$/)
  async onCheckStep(@Ctx() ctx: ExecutorWizardContext) {
    console.log('[ServiceChecklistScene] onCheckStep: Підтвердження кроку | UserId:', ctx.from?.id, '| StepId:', ((ctx as any).match as RegExpExecArray | null)?.[1] ?? '');
    await ctx.answerCbQuery?.();
    const stepId = ((ctx as any).match as RegExpExecArray | null)?.[1] ?? '';
    await this.recordAnswer(ctx, stepId, 'confirmed');
    await this.advanceOne(ctx);
  }

  @Action(/^executor_yes_step_(.+)$/)
  async onYesStep(@Ctx() ctx: ExecutorWizardContext) {
    console.log('[ServiceChecklistScene] onYesStep: Так | UserId:', ctx.from?.id, '| StepId:', ((ctx as any).match as RegExpExecArray | null)?.[1] ?? '');
    await ctx.answerCbQuery?.();
    const stepId = ((ctx as any).match as RegExpExecArray | null)?.[1] ?? '';
    await this.recordAnswer(ctx, stepId, 'yes');
    await this.advanceOne(ctx);
  }

  @Action(/^executor_no_step_(.+)$/)
  async onNoStep(@Ctx() ctx: ExecutorWizardContext) {
    console.log('[ServiceChecklistScene] onNoStep: Ні | UserId:', ctx.from?.id, '| StepId:', ((ctx as any).match as RegExpExecArray | null)?.[1] ?? '');
    await ctx.answerCbQuery?.();
    const stepId = ((ctx as any).match as RegExpExecArray | null)?.[1] ?? '';
    await this.recordAnswer(ctx, stepId, 'no');
    await this.advanceOne(ctx);
  }

  /** Кнопка «📸 Зробити фото» — чекаємо на фото від користувача. */
  @Action(/^executor_photo_step_(.+)$/)
  async onPhotoStep(@Ctx() ctx: ExecutorWizardContext) {
    console.log('[ServiceChecklistScene] onPhotoStep: Очікування фото | UserId:', ctx.from?.id, '| StepId:', ((ctx as any).match as RegExpExecArray | null)?.[1] ?? '');
    await ctx.answerCbQuery?.();
    const stepId = ((ctx as any).match as RegExpExecArray | null)?.[1] ?? '';
    ctx.session = ctx.session || {};
    ctx.session.checklistPhotoStep = stepId;
    await ctx.reply(ExecutorConst.PhotoUploadHint);
  }

  /** Перехід до фінальної self-check перевірки. */
  @Action('executor_go_selfcheck')
  async onGoSelfcheck(@Ctx() ctx: ExecutorWizardContext) {
    console.log('[ServiceChecklistScene] onGoSelfcheck: Перехід до self-check | UserId:', ctx.from?.id, '| OrderId:', ctx.session?.orderId);
    await ctx.answerCbQuery?.();
    return ctx.scene.enter(SceneConst.FINAL_SELFCHECK_SCENE);
  }

  // ==================== Обробка фото для кроків чекліста ====================

  @On('photo')
  async onChecklistPhoto(@Ctx() ctx: ExecutorWizardContext) {
    console.log('[ServiceChecklistScene] onChecklistPhoto: Отримано фото для чекліста | UserId:', ctx.from?.id, '| StepId:', ctx.session?.checklistPhotoStep);
    const stepId = ctx.session?.checklistPhotoStep;
    if (!stepId) return;

    try {
      const count = await saveChecklistPhoto(ctx, this.imageStorage, this.ordersService, stepId);
      if (count === null) {
        await ctx.reply(ExecutorConst.PhotoNotPhoto);
        return;
      }

      ctx.session.checklistPhotoStep = null;
      await this.recordAnswer(ctx, stepId, 'photo');
      await ctx.reply(ExecutorConst.PhotoSaved(count));
      await this.advanceOne(ctx);
    } catch (error) {
      console.error('Помилка збереження фото чекліста:', error);
      await ctx.reply(ExecutorConst.PhotoSaveError);
    }
  }

  // ==================== Допоміжні методи ====================

  /** Перемальовує крок за індексом. */
  private async renderCurrentStep(
    ctx: ExecutorWizardContext,
    stepIndex: number,
  ): Promise<void> {
    const order = await requireExecutorOrder(ctx, this.ordersService);
    if (!order) return;

    const steps: ChecklistStep[] =
      ((order as any).checklist as any)?.steps ?? [];

    if (steps.length === 0) {
      await ctx.reply(ExecutorConst.EmptyChecklist, {
        reply_markup: Markup.inlineKeyboard([
          [
            Markup.button.callback(
              ExecutorConst.SelfcheckButton,
              'executor_go_selfcheck',
            ),
          ],
        ]).reply_markup,
      });
      return;
    }

    // Зберігаємо індекс у wizard state, щоб наступні кроки працювали
    ctx.wizard.state.stepIndex = stepIndex;
    const current = steps[stepIndex];
    if (!current) {
      // Індекс за межами — переходимо до self-check
      await ctx.scene.enter(SceneConst.FINAL_SELFCHECK_SCENE);
      return;
    }

    const progress = `[${stepIndex + 1}/${steps.length}]`;
    const typeLabel = getTypeLabel(current.type);

    const msg =
      `✅ <b>Service Checklist</b> ${progress}\n\n` +
      `📌 <b>${current.title}</b>\n` +
      `🏷 Тип: ${typeLabel}\n` +
      `📝 ${current.description ?? '—'}\n\n` +
      (current.guide ? `💡 ${current.guide}` : '');

    const buttons: any[][] = [];
    if (current.type === 'checkbox' || current.type === 'confirmation') {
      buttons.push([
        Markup.button.callback(
          '✅ Підтверджую',
          `executor_check_step_${current.id}`,
        ),
      ]);
    } else if (current.type === 'yes_no') {
      buttons.push([
        Markup.button.callback('✅ Так', `executor_yes_step_${current.id}`),
        Markup.button.callback('❌ Ні', `executor_no_step_${current.id}`),
      ]);
    } else if (
      current.type === 'photo' ||
      current.type === 'multiple_photos'
    ) {
      buttons.push([
        Markup.button.callback(
          '📸 Зробити фото',
          `executor_photo_step_${current.id}`,
        ),
      ]);
    } else if (current.type === 'instruction') {
      buttons.push([
        Markup.button.callback(
          '➡️ Далі',
          `executor_next_step_${stepIndex + 1}`,
        ),
      ]);
    } else {
      buttons.push([
        Markup.button.callback(
          '✅ Готово',
          `executor_done_step_${stepIndex + 1}`,
        ),
      ]);
    }

    if (stepIndex > 0) {
      buttons.push([
        Markup.button.callback(
          '↩️ Назад',
          `executor_prev_step_${stepIndex - 1}`,
        ),
      ]);
    }

    buttons.push([
      Markup.button.callback(
        ExecutorConst.SelfcheckButton,
        'executor_go_selfcheck',
      ),
    ]);

    await ctx.reply(msg, {
      parse_mode: 'HTML',
      reply_markup: Markup.inlineKeyboard(buttons).reply_markup,
    });
  }

  /** Зберігає відповідь на крок у сесії та в базі даних. */
  private async recordAnswer(
    ctx: ExecutorWizardContext,
    stepId: string,
    answer: string,
  ): Promise<void> {
    ctx.session = ctx.session || {};
    ctx.session.checklistAnswers = ctx.session.checklistAnswers || {};
    ctx.session.checklistAnswers[stepId] = answer;

    // Persist to database
    const orderId = ctx.session?.orderId ?? ctx.wizard?.state?.orderId;
    const executorId = ctx.from?.id?.toString() ?? '';
    if (orderId && executorId) {
      try {
        await this.ordersService.saveChecklistAnswer(orderId, stepId, answer, executorId);
      } catch (error) {
        console.error('Помилка збереження відповіді чек-листа в БД:', error);
      }
    }
  }

  /** Переходить до наступного кроку. */
  private async advanceOne(ctx: ExecutorWizardContext): Promise<void> {
    const current = ctx.wizard?.state?.stepIndex ?? 0;
    await this.renderCurrentStep(ctx, current + 1);
  }
}

function getTypeLabel(type: string): string {
  switch (type) {
    case 'instruction':
      return 'Інструкція';
    case 'checkbox':
      return 'Чекбокс';
    case 'yes_no':
      return 'Так/Ні';
    case 'text':
      return 'Текст';
    case 'comment':
      return 'Коментар';
    case 'photo':
      return 'Фото';
    case 'multiple_photos':
      return 'Кілька фото';
    case 'select':
      return 'Вибір';
    case 'confirmation':
      return 'Підтвердження';
    default:
      return type;
  }
}
