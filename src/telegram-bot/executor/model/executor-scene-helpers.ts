import { Markup } from 'telegraf';
import { OrdersService } from '../../../orders/orders.service';
import { ExecutorConst } from './executor-const';
import { downloadLargestPhoto } from './telegram-photo';
import type { ImageStorageService } from '../../../images/image-storage.interface';
import type { ExecutorWizardContext } from '../interfaces/executor-wizard-context.interface';

/**
 * Спільні helper-функції для сцен виконавця.
 *
 * Усі сцени (`before-photos`, `after-photos`, `service-checklist`,
 * `final-selfcheck`, `submit`, `order-details`, `search-verify`, `revision`)
 * використовують ці функції, щоб уникнути дублювання коду.
 */

/** Один рядок inline-клавіатури. */
export type InlineButton = ReturnType<typeof Markup.button.callback>;

/**
 * Повертає `orderId` з сесії або wizard state.
 *
 * @param ctx — контекст сцени (wizard + session).
 * @returns `orderId` або `undefined`, якщо його немає.
 */
export function getOrderId(ctx: ExecutorWizardContext): string | undefined {
  return ctx.session?.orderId ?? ctx.wizard?.state?.orderId;
}

/**
 * Завантажує замовлення виконавця за `orderId` з сесії.
 *
 * @param ctx           — контекст сцени (wizard + session).
 * @param ordersService — сервіс для роботи із замовленнями.
 * @returns `order` або `null`, якщо orderId відсутній або замовлення не знайдено.
 */
export async function loadExecutorOrder(
  ctx: ExecutorWizardContext,
  ordersService: OrdersService,
): Promise<any | null> {
  const orderId = getOrderId(ctx);
  if (!orderId) return null;

  const executorId = ctx.from?.id?.toString() ?? '';
  const orders = await ordersService.findByExecutorId(executorId);
  return (orders ?? []).find((o: any) => o.id === orderId) ?? null;
}

/**
 * Завантажує замовлення або відповідає помилкою + залишає сцену.
 *
 * Використовується на початку кожної сцени: якщо orderId відсутній або
 * замовлення не знайдено — користувач отримує повідомлення, а сцена залишається.
 *
 * @param ctx           — контекст сцени (wizard + session).
 * @param ordersService — сервіс для роботи із замовленнями.
 * @returns `order` або `null` (якщо `null` — сцена вже залишена, викликач має return).
 */
export async function requireExecutorOrder(
  ctx: ExecutorWizardContext,
  ordersService: OrdersService,
): Promise<any | null> {
  const orderId = getOrderId(ctx);
  if (!orderId) {
    await ctx.reply(ExecutorConst.OrderNotFound);
    await ctx.scene.leave();
    return null;
  }

  const order = await loadExecutorOrder(ctx, ordersService);
  if (!order) {
    await ctx.reply(ExecutorConst.OrderNotFoundSimple);
    await ctx.scene.leave();
    return null;
  }

  return order;
}

/**
 * Завантажує фото з Telegram, зберігає на диск через `ImageStorageService`
 * та записує відносний шлях у БД через `OrdersService.addReportPhotoPath`.
 *
 * @param ctx           — контекст сцени (wizard + session).
 * @param imageStorage  — сервіс для збереження зображень.
 * @param ordersService — сервіс для роботи із замовленнями.
 * @param slot          — 'before' | 'after' — у яку папку/поле зберігати.
 * @returns кількість фото у відповідному масиві або `null` при помилці.
 */
export async function saveOrderPhoto(
  ctx: ExecutorWizardContext,
  imageStorage: ImageStorageService,
  ordersService: OrdersService,
  slot: 'before' | 'after',
): Promise<number | null> {
  const orderId = getOrderId(ctx);
  if (!orderId) return null;

  const photo = await downloadLargestPhoto(ctx);
  if (!photo) return null;

  const result = await imageStorage.saveImage(photo.buffer, {
    kind: 'order',
    id: orderId,
    slot,
    mimeType: photo.mimeType,
  });

  if (!result) return null;

  await ordersService.addReportPhotoPath(orderId, slot, result.path);

  const order = await loadExecutorOrder(ctx, ordersService);
  return slot === 'before'
    ? (order?.report?.photosBefore?.length ?? 0)
    : (order?.report?.photosAfter?.length ?? 0);
}

/**
 * Обробляє надіслане фото: зберігає його та відповідає підтвердженням.
 *
 * Викликається з `@On('photo')` обробників сцен фото.
 *
 * @param ctx           — контекст сцени (wizard + session).
 * @param imageStorage  — сервіс для збереження зображень.
 * @param ordersService — сервіс для роботи із замовленнями.
 * @param slot          — 'before' | 'after'.
 * @param extraButtons  — кнопки, які показуються після збереження (напр. «Далі», «Назад»).
 */
export async function handleOrderPhoto(
  ctx: ExecutorWizardContext,
  imageStorage: ImageStorageService,
  ordersService: OrdersService,
  slot: 'before' | 'after',
  extraButtons: InlineButton[][],
): Promise<void> {
  try {
    const count = await saveOrderPhoto(ctx, imageStorage, ordersService, slot);
    if (count === null) {
      await ctx.reply(ExecutorConst.PhotoNotPhoto);
      return;
    }

    await ctx.reply(ExecutorConst.PhotoSaved(count), {
      reply_markup: Markup.inlineKeyboard(extraButtons).reply_markup,
    });
  } catch (error) {
    console.error(`Помилка збереження фото «${slot}»:`, error);
    await ctx.reply(ExecutorConst.PhotoSaveError);
  }
}

/**
 * Зберігає фото кроку чек-листа: завантажує з Telegram, зберігає через
 * `ImageStorageService` у папку `checklist/<stepId>/` та додає шлях у
 * `order.checklistPhotos[stepId]`. Повертає оновлену кількість фото або `null`.
 *
 * @param ctx           — контекст сцени (wizard + session).
 * @param imageStorage  — сервіс для збереження зображень.
 * @param ordersService — сервіс для роботи із замовленнями.
 * @param stepId        — ідентифікатор кроку чек-листа.
 * @returns оновлену кількість фото для цього кроку або `null` при помилці.
 */
export async function saveChecklistPhoto(
  ctx: ExecutorWizardContext,
  imageStorage: ImageStorageService,
  ordersService: OrdersService,
  stepId: string,
): Promise<number | null> {
  const orderId = getOrderId(ctx);
  if (!orderId) return null;

  const photo = await downloadLargestPhoto(ctx);
  if (!photo) return null;

  const result = await imageStorage.saveImage(photo.buffer, {
    kind: 'order',
    id: orderId,
    slot: `checklist/${stepId}`,
    mimeType: photo.mimeType,
  });

  if (!result) return null;

  return ordersService.addChecklistPhoto(orderId, stepId, result.path);
}