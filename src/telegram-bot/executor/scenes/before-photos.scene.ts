import { Inject } from '@nestjs/common';
import { Action, Ctx, On, Wizard, WizardStep } from 'nestjs-telegraf';
import { Markup } from 'telegraf';
import { OrdersService } from '../../../orders/orders.service';
import { Scene as SceneConst } from '../../telegram-constants';
import { ExecutorConst } from '../model/executor-const';
import {
  requireExecutorOrder,
  saveOrderPhoto,
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
const BEFORE_PHOTO_BUTTONS = (beforePhotosConfirmed: boolean) => {
  const rows: any[][] = [];
  rows.push([
    Markup.button.callback(
      beforePhotosConfirmed
        ? ExecutorConst.NextChecklistButton
        : ExecutorConst.SendForReviewButton,
      'executor_next_checklist',
    ),
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
    console.log('[BeforePhotosScene] stepBeforePhotos: Фото "до" | UserId:', ctx.from?.id, '| OrderId:', ctx.session?.orderId);
    const order = await requireExecutorOrder(ctx, this.ordersService);
    if (!order) return;

    const slots = ((order.service as any)?.photoSlots as PhotoSlot[] | undefined) ?? DEFAULT_BEFORE_SLOTS;
    const photosPerSlot: Record<string, string[]> =
      ((order.report?.photosBeforeBySlot as any) ?? {});
    const beforePhotosConfirmed = order.BeforePhotosConfirmationResponse === 'yes';

    // Якщо адмін вже підтвердив фото — показуємо "Далі — Service Checklist"
    if (beforePhotosConfirmed) {
      await ctx.reply(
        `✅ Фото «до» вже підтверджено адміністратором.`,
        {
          reply_markup: Markup.inlineKeyboard(BEFORE_PHOTO_BUTTONS(true)).reply_markup,
        },
      );
      return;
    }

    // Перевіряємо, чи всі обовʼязкові слоти заповнені
    const allFilled = slots.every((s) => {
      if (!s.required) return true;
      return ((photosPerSlot[s.key] ?? []).length >= s.minPhotos);
    });

    if (allFilled) {
      // Всі слоти заповнені — показуємо "Відправити на перевірку"
      await ctx.reply(
        `📸 <b>Фото «до»</b>\n\nВсі обовʼязкові фото завантажено.\nНадішліть на перевірку адміністратору.`,
        {
          parse_mode: 'HTML',
          reply_markup: Markup.inlineKeyboard(BEFORE_PHOTO_BUTTONS(false)).reply_markup,
        },
      );
      return;
    }

    // Знаходимо перший незаповнений обовʼязковий слот
    ctx.session = ctx.session || {};
    let currentSlotIndex = ctx.session.currentBeforeSlotIndex ?? 0;

    // Пропускаємо вже заповнені слоти
    while (currentSlotIndex < slots.length) {
      const s = slots[currentSlotIndex];
      if (s.required && ((photosPerSlot[s.key] ?? []).length < s.minPhotos)) {
        break;
      }
      currentSlotIndex++;
    }

    ctx.session.currentBeforeSlotIndex = currentSlotIndex;

    if (currentSlotIndex >= slots.length) {
      // Всі слоти заповнені
      await ctx.reply(
        `📸 <b>Фото «до»</b>\n\nВсі обовʼязкові фото завантажено.\nНадішліть на перевірку адміністратору.`,
        {
          parse_mode: 'HTML',
          reply_markup: Markup.inlineKeyboard(BEFORE_PHOTO_BUTTONS(false)).reply_markup,
        },
      );
      return;
    }

    const slot = slots[currentSlotIndex];
    await ctx.reply(
      `📸 <b>Фото «до» — ${slot.name}</b>\n\n${slot.instruction}\n\nНадішліть одне фото.`,
      { parse_mode: 'HTML' },
    );
  }

  /**
   * Обробка надісланого фото «до».
   * Фото зберігається у поточному слоті, потім переходимо до наступного.
   */
  @On('photo')
  async onBeforePhoto(@Ctx() ctx: ExecutorWizardContext) {
    console.log('[BeforePhotosScene] onBeforePhoto: Отримано фото "до" | UserId:', ctx.from?.id, '| OrderId:', ctx.session?.orderId, '| SlotIndex:', ctx.session?.currentBeforeSlotIndex);
    const order = await requireExecutorOrder(ctx, this.ordersService);
    if (!order) return;

    const slots = ((order.service as any)?.photoSlots as PhotoSlot[] | undefined) ?? DEFAULT_BEFORE_SLOTS;
    const beforePhotosConfirmed = order.BeforePhotosConfirmationResponse === 'yes';

    if (beforePhotosConfirmed) {
      await ctx.reply('Фото «до» вже підтверджено адміністратором. Додавати нові фото не можна.');
      return;
    }

    ctx.session = ctx.session || {};
    let currentSlotIndex = ctx.session.currentBeforeSlotIndex ?? 0;

    const photosPerSlot: Record<string, string[]> =
      ((order.report?.photosBeforeBySlot as any) ?? {});

    // Пропускаємо вже заповнені слоти
    while (currentSlotIndex < slots.length) {
      const s = slots[currentSlotIndex];
      if (s.required && ((photosPerSlot[s.key] ?? []).length < s.minPhotos)) {
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
      'before',
      slot.key,
    );

    if (count === null) {
      await ctx.reply(ExecutorConst.PhotoSaveError);
      return;
    }

    // Переходимо до наступного слоту
    ctx.session.currentBeforeSlotIndex = currentSlotIndex + 1;

    // Перезавантажуємо замовлення, щоб отримати оновлені фото
    const updatedOrder = await requireExecutorOrder(ctx, this.ordersService);
    if (!updatedOrder) return;

    const updatedPhotos: Record<string, string[]> =
      ((updatedOrder.report?.photosBeforeBySlot as any) ?? {});

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
          reply_markup: Markup.inlineKeyboard(BEFORE_PHOTO_BUTTONS(false)).reply_markup,
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
        ctx.session.currentBeforeSlotIndex = nextSlotIndex;
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
            reply_markup: Markup.inlineKeyboard(BEFORE_PHOTO_BUTTONS(false)).reply_markup,
          },
        );
      }
    }
  }

  @Action('executor_next_checklist')
  async onNextChecklist(@Ctx() ctx: ExecutorWizardContext) {
    console.log('[BeforePhotosScene] onNextChecklist: Наступний чекліст / відправка на перевірку | UserId:', ctx.from?.id, '| OrderId:', ctx.session?.orderId);
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
        `Будь ласка, завантажте фото для всіх обовʼязкових слотів перед відправкою на перевірку.`,
        { parse_mode: 'HTML' },
      );
      return;
    }

    const beforePhotosConfirmed = order.BeforePhotosConfirmationResponse === 'yes';

    if (beforePhotosConfirmed) {
      // Адмін вже підтвердив фото — переходимо до Service Checklist
      return ctx.scene.enter(SceneConst.SERVICE_CHECKLIST_SCENE);
    }

    // Надсилаємо фото адміну на перевірку
    const executorId = ctx.from?.id?.toString() ?? '';
    await this.ordersService.notifyAdminBeforePhotos(order.id!, executorId);

    await ctx.reply(
      `⏳ Фото «до» надіслано адміністратору на перевірку (замовлення №${order.id!}).\n\n` +
      `Очікуйте на підтвердження адміністратора. Як тільки адмін підтвердить фото, ви зможете приступити до виконання робіт.`,
      { parse_mode: 'HTML' },
    );
    return;
  }

  @Action('executor_back_to_details')
  async onBackToDetails(@Ctx() ctx: ExecutorWizardContext) {
    console.log('[BeforePhotosScene] onBackToDetails: Назад до деталей | UserId:', ctx.from?.id);
    await ctx.answerCbQuery?.();
    return ctx.scene.enter(SceneConst.ORDER_DETAILS_SCENE);
  }
}
