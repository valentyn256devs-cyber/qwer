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
  guideUrl?: string;
}

const DEFAULT_BEFORE_SLOTS: PhotoSlot[] = [
  { key: 'front', name: 'Загальний вигляд спереду', instruction: 'Зробіть фото всього поховання спереду.', required: true, minPhotos: 1 },
  { key: 'left', name: 'Вигляд зліва', instruction: 'Зробіть фото зліва.', required: true, minPhotos: 1 },
  { key: 'right', name: 'Вигляд справа', instruction: 'Зробіть фото справа.', required: true, minPhotos: 1 },
  { key: 'monument', name: 'Памʼятник крупним планом', instruction: 'Зробіть крупний план памʼятника.', required: true, minPhotos: 1 },
];

/** Кнопки під повідомленням про завантаження фото «до». */
const BEFORE_PHOTO_BUTTONS = [
  [Markup.button.callback(ExecutorConst.NextChecklistButton, 'executor_next_checklist')],
  [Markup.button.callback(ExecutorConst.BackToDetails, 'executor_back_to_details')],
];

@Wizard(SceneConst.BEFORE_PHOTOS_SCENE)
export class BeforePhotosScene {
  constructor(
    private readonly ordersService: OrdersService,
    @Inject(IMAGE_STORAGE_SERVICE)
    private readonly imageStorage: ImageStorageService,
  ) {}

  @WizardStep(1)
  async stepBeforePhotos(@Ctx() ctx: ExecutorWizardContext) {
    const order = await requireExecutorOrder(ctx, this.ordersService);
    if (!order) return;

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
      reply_markup: Markup.inlineKeyboard(BEFORE_PHOTO_BUTTONS).reply_markup,
    });
  }

  /**
   * Обробка надісланого фото «до».
   * Фото завантажується з Telegram, зберігається на диск через ImageStorageService,
   * а в БД (Back4app) записується лише відносний шлях.
   */
  @On('photo')
  async onBeforePhoto(@Ctx() ctx: ExecutorWizardContext) {
    await handleOrderPhoto(
      ctx,
      this.imageStorage,
      this.ordersService,
      'before',
      BEFORE_PHOTO_BUTTONS,
    );
  }

  @Action('executor_next_checklist')
  async onNextChecklist(@Ctx() ctx: ExecutorWizardContext) {
    await ctx.answerCbQuery?.();
    return ctx.scene.enter(SceneConst.SERVICE_CHECKLIST_SCENE);
  }

  @Action('executor_back_to_details')
  async onBackToDetails(@Ctx() ctx: ExecutorWizardContext) {
    await ctx.answerCbQuery?.();
    return ctx.scene.enter(SceneConst.ORDER_DETAILS_SCENE);
  }
}
