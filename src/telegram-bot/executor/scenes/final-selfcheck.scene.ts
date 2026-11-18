import { Action, Ctx, Wizard, WizardStep } from 'nestjs-telegraf';
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
}

@Wizard(SceneConst.FINAL_SELFCHECK_SCENE)
export class FinalSelfcheckScene {
  constructor(private readonly ordersService: OrdersService) {}

  @WizardStep(1)
  async stepSelfcheck(@Ctx() ctx: ExecutorWizardContext) {
    const order = await requireExecutorOrder(ctx, this.ordersService);
    if (!order) return;

    const steps: ChecklistStep[] = ((order as any).checklist as any)?.steps ?? [];
    const requiredSteps = steps.filter(s => s.required);

    const summary =
      `🔍 <b>Фінальна self-check перевірка</b>\n\n` +
      `Ось усі required кроки чекліста:\n\n` +
      requiredSteps.map((s, i) => `✅ ${i + 1}. ${s.title}`).join('\n') +
      `\n\nПереконайтеся, що всі роботи виконані.`;

    await ctx.reply(summary, {
      parse_mode: 'HTML',
      reply_markup: Markup.inlineKeyboard([
        [Markup.button.callback(ExecutorConst.ConfirmSelfcheckButton, 'executor_confirm_selfcheck')],
        [Markup.button.callback(ExecutorConst.BackToChecklist, 'executor_back_to_checklist')],
      ]).reply_markup,
    });
  }

  /** Підтвердження self-check → перехід до фото «після». */
  @Action('executor_confirm_selfcheck')
  async onConfirmSelfcheck(@Ctx() ctx: ExecutorWizardContext) {
    await ctx.answerCbQuery?.();
    return ctx.scene.enter(SceneConst.AFTER_PHOTOS_SCENE);
  }

  /** Назад до чекліста. */
  @Action('executor_back_to_checklist')
  async onBackToChecklist(@Ctx() ctx: ExecutorWizardContext) {
    await ctx.answerCbQuery?.();
    return ctx.scene.enter(SceneConst.SERVICE_CHECKLIST_SCENE);
  }
}
