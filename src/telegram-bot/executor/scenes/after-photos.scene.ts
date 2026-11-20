import { Inject, Logger } from '@nestjs/common';
import { Action, Ctx, On, Wizard, WizardStep } from 'nestjs-telegraf';
import { Markup } from 'telegraf';
import { OrdersService } from '../../../orders/orders.service';
import { Scene as SceneConst } from '../../telegram-constants';
import { ExecutorConst } from '../model/executor-const';
import { requireExecutorOrder, saveOrderPhoto, } from '../model/executor-scene-helpers';
import { IMAGE_STORAGE_SERVICE } from '../../../images/image-storage.constants';
import type { ImageStorageService } from '../../../images/image-storage.interface';
import type { ExecutorWizardContext } from '../interfaces/executor-wizard-context.interface';
import { OrderStatus } from "../../../orders/models/order-status";

export interface PhotoSlot {
  key: string;
  name: string;
  instruction: string;
  required: boolean;
  minPhotos: number;
}

const DEFAULT_AFTER_SLOTS: PhotoSlot[] = [
  {
    key: 'front',
    name: 'Front View',
    instruction: 'Зробіть фото всього поховання спереду (аналогічно Before).',
    required: true,
    minPhotos: 1
  },
  { key: 'left', name: 'Left View', instruction: 'Зробіть фото зліва.', required: true, minPhotos: 1 },
  { key: 'right', name: 'Right View', instruction: 'Зробіть фото справа.', required: true, minPhotos: 1 },
  {
    key: 'monument',
    name: 'Monument Close-up',
    instruction: 'Зробіть крупний план памʼятника.',
    required: true,
    minPhotos: 1
  },
];

/** Кнопки під повідомленням про завантаження фото «після». */
const AFTER_PHOTO_BUTTONS = (allFilled: boolean) => {
  const rows: any[][] = [];
  rows.push([
    Markup.button.callback(
      allFilled
        ? ExecutorConst.GoSubmitButton
        : ExecutorConst.GoSubmitButton,
      'executor_go_submit',
    ),
  ]);
  rows.push([
    Markup.button.callback(ExecutorConst.BackToSelfcheck, 'executor_back_to_selfcheck'),
  ]);
  return rows;
};

@Wizard(SceneConst.AFTER_PHOTOS_SCENE)
export class AfterPhotosScene {
  private readonly logger = new Logger(AfterPhotosScene.name);

  constructor(
    private readonly ordersService: OrdersService,
    @Inject(IMAGE_STORAGE_SERVICE)
    private readonly imageStorage: ImageStorageService,
  ) {
  }

  @WizardStep(1)
  async stepAfterPhotos(@Ctx() ctx: ExecutorWizardContext) {
    this.logger.log(`[AfterPhotosScene] stepAfterPhotos`, { userId: ctx.from?.id, orderId: ctx.session?.orderId });
    const order = await requireExecutorOrder(ctx, this.ordersService);
    if (!order) return;

    const status = order.status;
    switch (status) {
      case OrderStatus.Canceled:
        await ctx.reply('Ваше замовлення скасовано.');
        return;
      case OrderStatus.Done:
        await ctx.reply('Ваше замовлення вже завершено.');
        return;
    }

    const slots = ((order.service as any)?.photoSlots as PhotoSlot[] | undefined) ?? DEFAULT_AFTER_SLOTS;
    const afterPhotos: Record<string, string[]> =
      ((order.report?.photosAfterBySlot as any) ?? {});

    // Перевіряємо, чи всі обовʼязкові слоти заповнені
    const allFilled = slots.every((s) => {
      if (!s.required) return true;
      return ((afterPhotos[s.key] ?? []).length >= s.minPhotos);
    });

    if (allFilled) {
      await ctx.reply(
        `📸 <b>Фото «після»</b>\n\nВсі обовʼязкові фото завантажено.\nНадішліть на перевірку адміністратору.`,
        {
          parse_mode: 'HTML',
          reply_markup: Markup.inlineKeyboard(AFTER_PHOTO_BUTTONS(true)).reply_markup,
        },
      );
      return;
    }

    // Знаходимо перший незаповнений обовʼязковий слот
    ctx.session = ctx.session || {};
    let currentSlotIndex = ctx.session.currentAfterSlotIndex ?? 0;

    // Пропускаємо вже заповнені слоти
    while (currentSlotIndex < slots.length) {
      const s = slots[currentSlotIndex];
      if (s.required && ((afterPhotos[s.key] ?? []).length < s.minPhotos)) {
        break;
      }
      currentSlotIndex++;
    }

    ctx.session.currentAfterSlotIndex = currentSlotIndex;

    if (currentSlotIndex >= slots.length) {
      await ctx.reply(
        `📸 <b>Фото «після»</b>\n\nВсі обовʼязкові фото завантажено.\nНадішліть на перевірку адміністратору.`,
        {
          parse_mode: 'HTML',
          reply_markup: Markup.inlineKeyboard(AFTER_PHOTO_BUTTONS(true)).reply_markup,
        },
      );
      return;
    }

    const slot = slots[currentSlotIndex];
    await ctx.reply(
      `📸 <b>Фото «після» — ${slot.name}</b>\n\n${slot.instruction}\n\nНадішліть одне фото.`,
      { parse_mode: 'HTML' },
    );
  }

  /**
   * Обробка надісланого фото «після».
   * Фото зберігається у поточному слоті, потім переходимо до наступного.
   */
  @On('photo')
  async onAfterPhoto(@Ctx() ctx: ExecutorWizardContext) {
    this.logger.log(`[AfterPhotosScene] onAfterPhoto`, {
      userId: ctx.from?.id,
      orderId: ctx.session?.orderId,
      slotIndex: ctx.session?.currentAfterSlotIndex
    });
    const order = await requireExecutorOrder(ctx, this.ordersService);
    if (!order) return;

    const slots = ((order.service as any)?.photoSlots as PhotoSlot[] | undefined) ?? DEFAULT_AFTER_SLOTS;
    const afterPhotos: Record<string, string[]> =
      ((order.report?.photosAfterBySlot as any) ?? {});

    ctx.session = ctx.session || {};
    let currentSlotIndex = ctx.session.currentAfterSlotIndex ?? 0;

    // Пропускаємо вже заповнені слоти
    while (currentSlotIndex < slots.length) {
      const s = slots[currentSlotIndex];
      if (s.required && ((afterPhotos[s.key] ?? []).length < s.minPhotos)) {
        break;
      }
      currentSlotIndex++;
    }

    if (currentSlotIndex >= slots.length) {
      await ctx.reply('Всі обовʼязкові слоти вже заповнені. Надішліть фото на перевірку адміністратору.');
      return;
    }

    const slot = slots[currentSlotIndex];

    // Зберігаємо фото у поточний слот
    const count = await saveOrderPhoto(
      ctx,
      this.imageStorage,
      this.ordersService,
      'after',
      slot.key,
    );

    if (count === null) {
      await ctx.reply(ExecutorConst.PhotoSaveError);
      return;
    }

    // Переходимо до наступного слоту
    ctx.session.currentAfterSlotIndex = currentSlotIndex + 1;

    // Перезавантажуємо замовлення, щоб отримати оновлені фото
    const updatedOrder = await requireExecutorOrder(ctx, this.ordersService);
    if (!updatedOrder) return;

    const updatedPhotos: Record<string, string[]> =
      ((updatedOrder.report?.photosAfterBySlot as any) ?? {});

    // Перевіряємо, чи всі обовʼязкові слоти заповнені
    const allFilled = slots.every((s) => {
      if (!s.required) return true;
      return ((updatedPhotos[s.key] ?? []).length >= s.minPhotos);
    });

    if (allFilled) {
      await ctx.reply(
        `✅ Фото для слоту "${slot.name}" збережено (${count}/${slot.minPhotos}).\n\n` +
        `Всі обовʼязкові фото завантажено.\nНадішліть на перевірку адміністратору.`,
        {
          reply_markup: Markup.inlineKeyboard(AFTER_PHOTO_BUTTONS(true)).reply_markup,
        },
      );
    } else {
      // Знаходимо наступний незаповнений слот
      let nextSlotIndex = currentSlotIndex + 1;
      while (nextSlotIndex < slots.length) {
        const s = slots[nextSlotIndex];
        if (s.required && ((updatedPhotos[s.key] ?? []).length < s.minPhotos)) {
          break;
        }
        nextSlotIndex++;
      }

      if (nextSlotIndex < slots.length) {
        const nextSlot = slots[nextSlotIndex];
        ctx.session.currentAfterSlotIndex = nextSlotIndex;
        await ctx.reply(
          `✅ Фото для слоту "${slot.name}" збережено (${count}/${slot.minPhotos}).\n\n` +
          `📸 Наступне фото — ${nextSlot.name}\n${nextSlot.instruction}\n\nНадішліть одне фото.`,
          { parse_mode: 'HTML' },
        );
      } else {
        await ctx.reply(
          `✅ Фото для слоту "${slot.name}" збережено (${count}/${slot.minPhotos}).\n\n` +
          `Всі обовʼязкові фото завантажено.\nНадішліть на перевірку адміністратору.`,
          {
            reply_markup: Markup.inlineKeyboard(AFTER_PHOTO_BUTTONS(true)).reply_markup,
          },
        );
      }
    }
  }

  @Action('executor_go_submit')
  async onGoSubmit(@Ctx() ctx: ExecutorWizardContext) {
    this.logger.log(`[AfterPhotosScene] onGoSubmit`, { userId: ctx.from?.id, orderId: ctx.session?.orderId });
    await ctx.answerCbQuery?.();

    const order = await requireExecutorOrder(ctx, this.ordersService);
    if (!order) return;

    const slots = ((order.service as any)?.photoSlots as PhotoSlot[] | undefined) ?? DEFAULT_AFTER_SLOTS;
    const afterPhotos: Record<string, string[]> =
      ((order.report?.photosAfterBySlot as any) ?? {});

    // Validate all required slots are filled
    const missingSlots = slots
      .filter((s) => s.required)
      .filter((s) => {
        const count = (afterPhotos[s.key] ?? []).length;
        return count < s.minPhotos;
      });

    if (missingSlots.length > 0) {
      const missingNames = missingSlots.map((s) => s.name).join(', ');
      await ctx.reply(
        `⚠️ Не всі обовʼязкові слоти фото «після» заповнені.\n\n` +
        `Бракує фото для: ${missingNames}\n\n` +
        `Будь ласка, завантажте фото для всіх обовʼязкових слотів перед відправкою на перевірку.`,
        { parse_mode: 'HTML' },
      );
      return;
    }

    const executorId = ctx.from?.id?.toString() ?? '';
    await this.ordersService.submitForCompletionReview(order.id!, executorId);

    await ctx.reply(
      `⏳ Роботу надіслано адміністратору на перевірку (замовлення №${order.id!}).\n\n` +
      `Очікуйте на підтвердження адміністратора.`,
      { parse_mode: 'HTML' },
    );
    return;
  }

  @Action('executor_back_to_selfcheck')
  async onBackToSelfcheck(@Ctx() ctx: ExecutorWizardContext) {
    this.logger.log(`[AfterPhotosScene] onBackToSelfcheck`, { userId: ctx.from?.id });
    await ctx.answerCbQuery?.();
    return ctx.scene.enter(SceneConst.FINAL_SELFCHECK_SCENE);
  }
}
