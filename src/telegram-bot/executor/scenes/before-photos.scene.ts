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
const BEFORE_PHOTO_BUTTONS = (
  slots: PhotoSlot[],
  photosPerSlot: Record<string, string[]>,
) => {
  const rows: any[][] = [];
  // Кнопка вибору слота для завантаження фото
  rows.push(
    slots.map((s) => {
      const count = (photosPerSlot[s.key] ?? []).length;
      const ok = count >= s.minPhotos;
      return Markup.button.callback(
        `${ok ? '✅' : '⬜'} ${s.name}`,
        `executor_select_slot_${s.key}`,
      );
    }),
  );
  rows.push([
    Markup.button.callback(ExecutorConst.NextChecklistButton, 'executor_next_checklist'),
  ]);
  rows.push([
    Markup.button.callback(ExecutorConst.BackToDetails, 'executor_back_to_details'),
  ]);
  return rows;
};

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
    const photosPerSlot: Record<string, string[]> =
      ((order.report?.photosBeforeBySlot as any) ?? {});

    // Ініціалізуємо вибраний слот у сесії
    ctx.session = ctx.session || {};
    if (!ctx.session.selectedPhotoSlot) {
      ctx.session.selectedPhotoSlot = slots[0]?.key;
    }

    const msg =
      `📸 <b>Фото «до»</b>\n\n` +
      `Завантажте фото за слотами. Оберіть слот нижче, а потім надішліть фото.\n\n` +
      `📸 Статус слотів:\n` +
      slots.map((s, i) => {
        const count = (photosPerSlot[s.key] ?? []).length;
        const ok = count >= s.minPhotos;
        return `${ok ? '✅' : '⬜'} ${i + 1}. <b>${s.name}</b> (${count}/${s.minPhotos})\n   ${s.instruction}`;
      }).join('\n\n');

    await ctx.reply(msg, { parse_mode: 'HTML' });

    await ctx.reply(ExecutorConst.PhotoUploadHint, {
      reply_markup: Markup.inlineKeyboard(BEFORE_PHOTO_BUTTONS(slots, photosPerSlot)).reply_markup,
    });
  }

  /**
   * Обробка надісланого фото «до».
   * Фото зберігається у поточно вибраному слоті.
   */
  @On('photo')
  async onBeforePhoto(@Ctx() ctx: ExecutorWizardContext) {
    const order = await requireExecutorOrder(ctx, this.ordersService);
    if (!order) return;

    const slots = ((order.service as any)?.photoSlots as PhotoSlot[] | undefined) ?? DEFAULT_BEFORE_SLOTS;
    const slotKey = ctx.session?.selectedPhotoSlot ?? slots[0]?.key;

    await handleOrderPhoto(
      ctx,
      this.imageStorage,
      this.ordersService,
      'before',
      slotKey,
      BEFORE_PHOTO_BUTTONS(slots, ((order.report?.photosBeforeBySlot as any) ?? {})),
    );
  }

  /** Вибір слота для завантаження фото. */
  @Action(/^executor_select_slot_(.+)$/)
  async onSelectSlot(@Ctx() ctx: ExecutorWizardContext) {
    await ctx.answerCbQuery?.();
    const slotKey = ((ctx as any).match as RegExpExecArray | null)?.[1] ?? '';
    ctx.session = ctx.session || {};
    ctx.session.selectedPhotoSlot = slotKey;

    const order = await requireExecutorOrder(ctx, this.ordersService);
    if (!order) return;

    const slots = ((order.service as any)?.photoSlots as PhotoSlot[] | undefined) ?? DEFAULT_BEFORE_SLOTS;
    const photosPerSlot: Record<string, string[]> =
      ((order.report?.photosBeforeBySlot as any) ?? {});

    const slot = slots.find((s) => s.key === slotKey);
    await ctx.reply(
      `📸 Обрано слот: <b>${slot?.name ?? slotKey}</b>\n${slot?.instruction ?? ''}\n\nНадішліть фото для цього слоту.`,
      { parse_mode: 'HTML' },
    );
  }

  @Action('executor_next_checklist')
  async onNextChecklist(@Ctx() ctx: ExecutorWizardContext) {
    await ctx.answerCbQuery?.();

    const order = await requireExecutorOrder(ctx, this.ordersService);
    if (!order) return;

    const slots = ((order.service as any)?.photoSlots as PhotoSlot[] | undefined) ?? DEFAULT_BEFORE_SLOTS;
    const photosPerSlot: Record<string, string[]> =
      ((order.report?.photosBeforeBySlot as any) ?? {});

    // Req 11: Не дозволяти перейти далі, поки всі required slots не заповнені
    const missingSlots = slots
      .filter((s) => s.required)
      .filter((s) => {
        const count = (photosPerSlot[s.key] ?? []).length;
        return count < s.minPhotos;
      });

    if (missingSlots.length > 0) {
      const missingNames = missingSlots.map((s) => s.name).join(', ');
      await ctx.reply(
        `⚠️ Не всі обовʼязкові слоти заповнені.\n\n` +
        `Бракує фото для: ${missingNames}\n\n` +
        `Будь ласка, завантажте фото для всіх обовʼязкових слотів перед переходом до чек-листа.`,
        { parse_mode: 'HTML' },
      );
      return;
    }

    return ctx.scene.enter(SceneConst.SERVICE_CHECKLIST_SCENE);
  }

  @Action('executor_back_to_details')
  async onBackToDetails(@Ctx() ctx: ExecutorWizardContext) {
    await ctx.answerCbQuery?.();
    return ctx.scene.enter(SceneConst.ORDER_DETAILS_SCENE);
  }
}
