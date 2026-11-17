import { Ctx, Wizard, WizardStep } from 'nestjs-telegraf';
import { Markup } from 'telegraf';
import { OrdersService } from '../../../orders/orders.service';
import { Scene as SceneConst } from '../../telegram-constants';
import { ExecutorConst } from '../model/executor-const';
import type { ExecutorWizardContext } from '../interfaces/executor-wizard-context.interface';

export interface PhotoSlot {
  key: string;
  name: string;
  instruction: string;
  required: boolean;
  minPhotos: number;
  guideUrl?: string;
}

const DEFAULT_BEFORE_SLOTS: PhotoSlot[] = [
  { key: 'front', name: 'Загальний вигляд спереду', instruction: 'Зробіть фото всього поховання спереду.', required: true, minPhotos: 1 },
  { key: 'left', name: 'Вигляд зліва', instruction: 'Зробіть фото зліва.', required: true, minPhotos: 1 },
  { key: 'right', name: 'Вигляд справа', instruction: 'Зробіть фото справа.', required: true, minPhotos: 1 },
  { key: 'monument', name: 'Памʼятник крупним планом', instruction: 'Зробіть крупний план памʼятника.', required: true, minPhotos: 1 },
];

@Wizard(SceneConst.BEFORE_PHOTOS_SCENE)
export class BeforePhotosScene {
  constructor(private readonly ordersService: OrdersService) {}

  @WizardStep(1)
  async stepBeforePhotos(@Ctx() ctx: ExecutorWizardContext) {
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

    const slots = ((order.service as any)?.photoSlots as PhotoSlot[] | undefined) ?? DEFAULT_BEFORE_SLOTS;
    const beforePhotos: string[] = order.report?.photosBefore ?? [];

    const msg =
      `📸 <b>Фото «до»</b>\n\n` +
      `Завантажте фото за слотами. Дозволено використовувати Before Photo як reference.\n\n` +
      `📸 Вже завантажено: ${beforePhotos.length} шт.\n\n` +
      slots.map((s, i) => {
        const status = beforePhotos.length >= s.minPhotos ? '✅' : '⬜';
        return `${status} ${i + 1}. <b>${s.name}</b>\n   ${s.instruction}`;
      }).join('\n\n');

    await ctx.reply(msg, { parse_mode: 'HTML' });

    await ctx.reply(ExecutorConst.PhotoUploadHint, {
      reply_markup: Markup.inlineKeyboard([
        [Markup.button.callback(ExecutorConst.NextChecklistButton, 'executor_next_checklist')],
        [Markup.button.callback(ExecutorConst.BackToDetails, 'executor_back_to_details')],
      ]).reply_markup,
    });
  }
}
