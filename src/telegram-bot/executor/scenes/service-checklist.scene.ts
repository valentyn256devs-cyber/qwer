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
  validation?: any;
  guide?: string;
  minPhotos?: number;
  maxPhotos?: number;
}

@Wizard(SceneConst.SERVICE_CHECKLIST_SCENE)
export class ServiceChecklistScene {
  constructor(private readonly ordersService: OrdersService) {}

  @WizardStep(1)
  async stepChecklist(@Ctx() ctx: ExecutorWizardContext) {
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
    if (steps.length === 0) {
      await ctx.reply(ExecutorConst.EmptyChecklist, {
        reply_markup: Markup.inlineKeyboard([
          [Markup.button.callback(ExecutorConst.SelfcheckButton, 'executor_go_selfcheck')],
        ]).reply_markup,
      });
      return;
    }

    const stepIndex = ctx.wizard?.state?.stepIndex ?? 0;
    const current = steps[stepIndex];

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
      buttons.push([Markup.button.callback('✅ Підтверджую', `executor_check_step_${current.id}`)]);
    } else if (current.type === 'yes_no') {
      buttons.push(
        [Markup.button.callback('✅ Так', `executor_yes_step_${current.id}`), Markup.button.callback('❌ Ні', `executor_no_step_${current.id}`)],
      );
    } else if (current.type === 'photo' || current.type === 'multiple_photos') {
      buttons.push([Markup.button.callback('📸 Зробити фото', `executor_photo_step_${current.id}`)]);
    } else if (current.type === 'instruction') {
      buttons.push([Markup.button.callback('➡️ Далі', `executor_next_step_${stepIndex}`)]);
    } else {
      buttons.push([Markup.button.callback('✅ Готово', `executor_done_step_${stepIndex}`)]);
    }

    if (stepIndex > 0) {
      buttons.push([Markup.button.callback('↩️ Назад', `executor_prev_step_${stepIndex - 1}`)]);
    }

    buttons.push([Markup.button.callback(ExecutorConst.SelfcheckButton, 'executor_go_selfcheck')]);

    await ctx.reply(msg, { parse_mode: 'HTML', reply_markup: Markup.inlineKeyboard(buttons).reply_markup });
  }
}

function getTypeLabel(type: string): string {
  switch (type) {
    case 'instruction': return 'Інструкція';
    case 'checkbox': return 'Чекбокс';
    case 'yes_no': return 'Так/Ні';
    case 'text': return 'Текст';
    case 'comment': return 'Коментар';
    case 'photo': return 'Фото';
    case 'multiple_photos': return 'Кілька фото';
    case 'select': return 'Вибір';
    case 'confirmation': return 'Підтвердження';
    default: return type;
  }
}
