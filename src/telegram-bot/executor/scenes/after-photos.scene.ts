import { Inject, Logger } from '@nestjs/common';
import { Action, Ctx, Hears, On, Wizard, WizardStep } from 'nestjs-telegraf';
import { Markup } from 'telegraf';
import { OrdersService } from '../../../orders/orders.service';
import {
  ExecutorMenu,
  Scene as SceneConst,
  executorMainMenuButtons,
} from '../../telegram-constants';
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

    // Підраховуємо загальну кількість фото «після» з бази
    const totalAfterPhotos = Object.values(afterPhotos).reduce(
      (sum, photos) => sum + (photos ?? []).length,
      0,
    );

    // Перевіряємо, чи кожен обовʼязковий слот має хо бля одне фото
    const allSlotsHavePhotos = slots.every((s) => {
      if (!s.required) return true;
      return ((afterPhotos[s.key] ?? []).length >= s.minPhotos);
    });

    // Якщо фото всі є (загалом 4 і кожен слот заповнений) — показуємо "Відправити на перевірку"
    if (totalAfterPhotos === 4 && allSlotsHavePhotos) {
      await ctx.reply(
        `📸 <b>Фото «після»</b>\n\nВсі обовʼязкові фото завантажено.\nНадішліть на перевірку адміністратору.`,
        {
          parse_mode: 'HTML',
          reply_markup: Markup.inlineKeyboard(AFTER_PHOTO_BUTTONS(true)).reply_markup,
        },
      );
      return;
    }

    // Якщо фото немає, або їх кількість не 4, або якийсь слот не заповнений — проходимо флоу додавання фото «після»
    // Знаходимо перший незаповнений обовʼязковий слот
    ctx.session = ctx.session || {};
    // Завжди починаємо з 0, щоб знайти перший незаповнений слот (currentAfterSlotIndex може бути застарілим)
    let currentSlotIndex = 0;

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
        `✅ Фото для слоту "${slot.name}" збережено.\n\n` +
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
          `✅ Фото для слоту "${slot.name}" збережено.\n\n` +
          `📸 Наступне фото — ${nextSlot.name}\n${nextSlot.instruction}\n\nНадішліть одне фото.`,
          { parse_mode: 'HTML' },
        );
      } else {
        await ctx.reply(
          `✅ Фото для слоту "${slot.name}" збережено.\n\n` +
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

    // Надсилаємо фото «до» та «після» адміністратору (медіа-групи)
    await this.ordersService.sendPhotosToAdmin(order.id!);

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

  /**
   * Обробка натискання кнопки «Завантажити фото «після»» з повідомлення
   * адміністратора про повернення роботи на доопрацювання.
   *
   * Очищає старі фото «після» та запускає флоу завантаження заново
   * (перезапис старого набору фото новими).
   */
  @Action(/^executor_reupload_after_(.+)$/)
  async onReuploadAfter(@Ctx() ctx: ExecutorWizardContext) {
    const orderId = ((ctx as any).match as RegExpExecArray | null)?.[1] ?? '';
    this.logger.log(`[AfterPhotosScene] onReuploadAfter`, { userId: ctx.from?.id, orderId });
    await ctx.answerCbQuery?.();
    await ctx.editMessageReplyMarkup({ inline_keyboard: [] }).catch(() => null);
    if (!orderId) return;

    // Очищаємо старі фото «після», щоб виконавець завантажив нові
    try {
      await this.ordersService.clearAfterPhotos(orderId);
    } catch (error) {
      this.logger.error(`[AfterPhotosScene] onReuploadAfter failed to clear photos`, error as any);
      await ctx.reply(ExecutorConst.PhotoSaveError);
      return;
    }

    ctx.session = ctx.session || {};
    ctx.session.orderId = orderId;
    // Скидаємо індекс слота, щоб флоу почався з першого обовʼязкового слота
    ctx.session.currentAfterSlotIndex = 0;
    return ctx.scene.enter(SceneConst.AFTER_PHOTOS_SCENE);
  }

  // ==================== Кнопки головного меню (щоб не «застрягти» в сцені) ====================

  @Hears(ExecutorMenu.OpenOrders)
  async onOpenOrdersMenu(@Ctx() ctx: ExecutorWizardContext) {
    this.logger.log(`[AfterPhotosScene] onOpenOrdersMenu`, { userId: ctx.from?.id });
    return ctx.scene.enter(SceneConst.OPEN_ORDERS_SCENE);
  }

  @Hears(ExecutorMenu.MyOrders)
  async onMyOrdersMenu(@Ctx() ctx: ExecutorWizardContext) {
    this.logger.log(`[AfterPhotosScene] onMyOrdersMenu`, { userId: ctx.from?.id });
    return ctx.scene.enter(SceneConst.MY_ORDERS_SCENE);
  }

  @Hears(ExecutorMenu.DoneOrders)
  async onDoneOrdersMenu(@Ctx() ctx: ExecutorWizardContext) {
    this.logger.log(`[AfterPhotosScene] onDoneOrdersMenu`, { userId: ctx.from?.id });
    return ctx.scene.enter(SceneConst.DONE_ORDERS_SCENE);
  }

  @Hears(ExecutorMenu.Help)
  async onHelpMenu(@Ctx() ctx: ExecutorWizardContext) {
    this.logger.log(`[AfterPhotosScene] onHelpMenu`, { userId: ctx.from?.id });
    await ctx.scene.leave();
    await ctx.reply(ExecutorConst.HelpPrompt, {
      reply_markup: Markup.inlineKeyboard([
        [
          Markup.button.callback(
            ExecutorConst.ProblemButton,
            'executor_report_problem_pick',
          ),
        ],
        [
          Markup.button.callback(
            ExecutorConst.CannotCompleteHelpButton,
            'executor_cannot_complete_pick',
          ),
        ],
        [
          Markup.button.callback(ExecutorConst.BackToMenu, 'executor_back_to_menu'),
        ],
      ]).reply_markup,
    });
  }
}
