/**
 * Завантаження фото з Telegram у Buffer.
 *
 * Використовується сценами виконавця (before/after photos):
 * 1. Беремо найбільше доступне фото з `ctx.message.photo`.
 * 2. Отримуємо посилання через `bot.telegram.getFileLink(fileId)`.
 * 3. Завантажуємо байти через `fetch` (Node 18+).
 */

export interface DownloadedPhoto {
  buffer: Buffer;
  mimeType: string;
  fileId: string;
}

/**
 * Завантажує найбільше фото з повідомлення Telegram.
 *
 * @param ctx — контекст Telegraf (містить `message.photo` та `bot.telegram`).
 * @returns `DownloadedPhoto` або `null`, якщо у повідомленні немає фото.
 */
export async function downloadLargestPhoto(
  ctx: any,
): Promise<DownloadedPhoto | null> {
  const photos = ctx?.message?.photo;
  if (!Array.isArray(photos) || photos.length === 0) {
    return null;
  }

  // Telegram віддає масив фото від найменшого до найбільшого — беремо останній.
  const largest = photos[photos.length - 1];
  const fileId: string | undefined = largest?.file_id;
  if (!fileId) {
    return null;
  }

  const link = await ctx.telegram.getFileLink(fileId);
  const url = typeof link === 'string' ? link : link.toString();

  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Не вдалося завантажити фото з Telegram (${response.status})`);
  }

  const arrayBuffer = await response.arrayBuffer();
  const buffer = Buffer.from(arrayBuffer);

  return { buffer, mimeType: 'image/jpeg', fileId };
}