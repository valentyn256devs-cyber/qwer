import { Inject } from '@nestjs/common';
import { Action, Ctx, On, Wizard, WizardStep } from 'nestjs-telegraf';
import { Markup } from 'telegraf';
import { OrdersService } from '../../../orders/orders.service';
import { Scene as SceneConst } from '../../telegram-constants';
import { ExecutorConst } from '../model/executor-const';
import {
  handleOrderPhoto,
  requireExecutorOrder,
} from '../model/executor-scene-helpers';
import { IMAGE_STORAGE_SERVICE } from '../../../images/image-storage.constants';
import type { ImageStorageService } from '../../../images/image-storage.interface';
import type { ExecutorWizardContext } from '../interfaces/executor-wizard-context.interface';

export interface PhotoSlot {
  key: string;
  name: string;
  instruction: string;
  required: boolean;
  minPhotos: number;
}

const DEFAULT_AFTER_SLOTS: PhotoSlot[] = [
  { key: 'front', name: 'Front View', instruction: 'Зробіть фото всього поховання спереду (аналогічно Before).', required: true, minPhotos: 1 },
  { key: 'left', name: 'Left View', instruction: 'Зробіть фото зліва.', required: true, minPhotos: 1 },
  { key: 'right', name: 'Right View', instruction: 'Зробіть фото справа.', required: true, minPhotos: 1 },
  { key: 'monument', name: 'Monument Close-up', instruction: 'Зробіть крупний план памʼятника.', required: true, minPhotos: 1 },
];

/** Кнопки під повідомленням про завантаження фото «після». */
const AFTER_PHOTO_BUTTONS = [
  [Markup.button.callback(ExecutorConst.GoSubmitButton, 'executor_go_submit')],
  [Markup.button.callback(ExecutorConst.BackToSelfcheck, 'executor_back_to_selfcheck')],
];

@Wizard(SceneConst.AFTER_PHOTOS_SCENE)
export class AfterPhotosScene {
  constructor(
    private readonly ordersService: OrdersService,
    @Inject(IMAGE_STORAGE_SERVICE)
    private readonly imageStorage: ImageStorageService,
  ) {}

  @WizardStep(1)
  async stepAfterPhotos(@Ctx() ctx: ExecutorWizardContext) {
    const order = await requireExecutorOrder(ctx, this.ordersService);
    if (!order) return;

    const slots = ((order.service as any)?.photoSlots as PhotoSlot[] | undefined) ?? DEFAULT_AFTER_SLOTS;
    const beforePhotos: string[] = order.report?.photosBefore ?? [];
    const afterPhotos: string[] = order.report?.photosAfter ?? [];

    const msg =
      `📸 <b>Фото «після»</b>\n\n` +
      `Завантажте фото «після» відповідно до слотів «до».\n` +
      `Рекомендується використовувати Before Photo як reference для максимального однакового ракурсу.\n\n` +
      `📸 Before Photo: ${beforePhotos.length} шт.\n` +
      `📸 After Photo: ${afterPhotos.length} шт.\n\n` +
      slots.map((s, i) => {
        const status = afterPhotos.length >= s.minPhotos ? '✅' : '⬜';
        return `${status} ${i + 1}. <b>${s.name}</b>\n   ${s.instruction}`;
      }).join('\n\n');

    await ctx.reply(msg, { parse_mode: 'HTML' });

    await ctx.reply(ExecutorConst.PhotoUploadAfter, {
      reply_markup: Markup.inlineKeyboard(AFTER_PHOTO_BUTTONS).reply_markup,
    });
  }

  /**
   * Обробка надісланого фото «після».
   * Фото завантажується з Telegram, зберігається на диск через ImageStorageService,
   * а в БД (Back4app) записується лише відносний шлях.
   */
  @On('photo')
  async onAfterPhoto(@Ctx() ctx: ExecutorWizardContext) {
    await handleOrderPhoto(
      ctx,
      this.imageStorage,
      this.ordersService,
      'after',
      AFTER_PHOTO_BUTTONS,
    );
  }

  @Action('executor_go_submit')
  async onGoSubmit(@Ctx() ctx: ExecutorWizardContext) {
    await ctx.answerCbQuery?.();
    return ctx.scene.enter(SceneConst.SUBMIT_SCENE);
  }

  @Action('executor_back_to_selfcheck')
  async onBackToSelfcheck(@Ctx() ctx: ExecutorWizardContext) {
    await ctx.answerCbQuery?.();
    return ctx.scene.enter(SceneConst.FINAL_SELFCHECK_SCENE);
  }
}
