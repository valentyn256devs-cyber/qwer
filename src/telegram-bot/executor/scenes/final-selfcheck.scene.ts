import { Ctx, Wizard, WizardStep } from 'nestjs-telegraf';
import { Markup } from 'telegraf';
import { OrdersService } from '../../../orders/orders.service';
import { Scene as SceneConst } from '../../telegram-constants';
import { ExecutorConst } from '../model/executor-const';
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
    const orderId = ctx.session?.orderId ?? ctx.wizard?.state?.orderId;
    if (!orderId) {
      await ctx.reply(ExecutorConst.OrderNotFound);
      return ctx.scene.leave();
    }

    const executorId = ctx.from?.id.toString() ?? '';
    const order = (await this.ordersService.findByExecutorId(executorId)).find((o: any) => o.id === orderId);
    if (!order) {
      await ctx.reply(ExecutorConst.OrderNotFoundSimple);
      return ctx.scene.leave();
    }

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
}
