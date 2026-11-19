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
const AFTER_PHOTO_BUTTONS = (
  slots: PhotoSlot[],
  photosPerSlot: Record<string, string[]>,
) => {
  const rows: any[][] = [];
  rows.push(
    slots.map((s) => {
      const count = (photosPerSlot[s.key] ?? []).length;
      const ok = count >= s.minPhotos;
      return Markup.button.callback(
        `${ok ? '✅' : '⬜'} ${s.name}`,
        `executor_select_after_slot_${s.key}`,
      );
    }),
  );
  rows.push([
    Markup.button.callback(ExecutorConst.GoSubmitButton, 'executor_go_submit'),
  ]);
  rows.push([
    Markup.button.callback(ExecutorConst.BackToSelfcheck, 'executor_back_to_selfcheck'),
  ]);
  return rows;
};

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
    const beforePhotos: Record<string, string[]> =
      ((order.report?.photosBeforeBySlot as any) ?? {});
    const afterPhotos: Record<string, string[]> =
      ((order.report?.photosAfterBySlot as any) ?? {});

    // Ініціалізуємо вибраний слот у сесії
    ctx.session = ctx.session || {};
    if (!ctx.session.selectedAfterPhotoSlot) {
      ctx.session.selectedAfterPhotoSlot = slots[0]?.key;
    }

    const msg =
      `📸 <b>Фото «після»</b>\n\n` +
      `Завантажте фото «після» відповідно до слотів «до».\n` +
      `Рекомендується використовувати Before Photo як reference для максимального однакового ракурсу.\n\n` +
      `📸 Before Photo: ${Object.values(beforePhotos).flat().length} шт.\n` +
      `📸 After Photo: ${Object.values(afterPhotos).flat().length} шт.\n\n` +
      `Статус слотів:\n` +
      slots.map((s, i) => {
        const count = (afterPhotos[s.key] ?? []).length;
        const ok = count >= s.minPhotos;
        return `${ok ? '✅' : '⬜'} ${i + 1}. <b>${s.name}</b> (${count}/${s.minPhotos})\n   ${s.instruction}`;
      }).join('\n\n');

    await ctx.reply(msg, { parse_mode: 'HTML' });

    await ctx.reply(ExecutorConst.PhotoUploadAfter, {
      reply_markup: Markup.inlineKeyboard(AFTER_PHOTO_BUTTONS(slots, afterPhotos)).reply_markup,
    });
  }

  /**
   * Обробка надісланого фото «після».
   * Фото зберігається у поточно вибраному слоті.
   */
  @On('photo')
  async onAfterPhoto(@Ctx() ctx: ExecutorWizardContext) {
    const order = await requireExecutorOrder(ctx, this.ordersService);
    if (!order) return;

    const slots = ((order.service as any)?.photoSlots as PhotoSlot[] | undefined) ?? DEFAULT_AFTER_SLOTS;
    const slotKey = ctx.session?.selectedAfterPhotoSlot ?? slots[0]?.key;

    await handleOrderPhoto(
      ctx,
      this.imageStorage,
      this.ordersService,
      'after',
      slotKey,
      AFTER_PHOTO_BUTTONS(slots, ((order.report?.photosAfterBySlot as any) ?? {})),
    );
  }

  /** Вибір слота для завантаження фото «після». */
  @Action(/^executor_select_after_slot_(.+)$/)
  async onSelectSlot(@Ctx() ctx: ExecutorWizardContext) {
    await ctx.answerCbQuery?.();
    const slotKey = ((ctx as any).match as RegExpExecArray | null)?.[1] ?? '';
    ctx.session = ctx.session || {};
    ctx.session.selectedAfterPhotoSlot = slotKey;

    const order = await requireExecutorOrder(ctx, this.ordersService);
    if (!order) return;

    const slots = ((order.service as any)?.photoSlots as PhotoSlot[] | undefined) ?? DEFAULT_AFTER_SLOTS;
    const slot = slots.find((s) => s.key === slotKey);
    await ctx.reply(
      `📸 Обрано слот: <b>${slot?.name ?? slotKey}</b>\n${slot?.instruction ?? ''}\n\nНадішліть фото для цього слоту.`,
      { parse_mode: 'HTML' },
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
