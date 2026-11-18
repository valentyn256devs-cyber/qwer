/**
 * Типи контексту збереження зображення.
 *
 * `kind` визначає, у яку групу папок складати файл:
 *  - `order`  → `<root>/orders/<id>/`
 *  - `burial` → `<root>/burials/<id>/`
 */
export type ImageStorageKind = 'order' | 'burial';

/**
 * Контекст збереження одного зображення.
 */
export interface ImageSaveContext {
  /** Група папок: замовлення чи поховання. */
  kind: ImageStorageKind;
  /** Ідентифікатор (orderId або burialId) — назва підпапки. */
  id: string;
  /** Додатковий підкаталог/префікс (напр. `before`, `after`, `checklist`). */
  slot?: string;
  /** MIME-тип або розширення файлу (напр. `image/jpeg`, `jpg`). */
  mimeType?: string;
}

/**
 * Результат збереження зображення.
 */
export interface ImageSaveResult {
  /** Відносний шлях до файлу (те, що зберігається в БД). */
  path: string;
  /** Абсолютний шлях на диску. */
  absolutePath: string;
  /** Розмір файлу в байтах. */
  size: number;
}

/**
 * Контекст пошуку зображень.
 */
export interface ImageFindContext {
  /** Група папок: замовлення чи поховання. */
  kind: ImageStorageKind;
  /** Ідентифікатор (orderId або burialId). */
  id: string;
  /** Додатковий підкаталог/префікс (напр. `before`, `after`, `checklist`). Опціонально. */
  slot?: string;
}

/**
 * Результат пошуку зображення.
 */
export interface ImageFindResult {
  /** Відносний шлях до файлу. */
  path: string;
  /** Абсолютний шлях/URL до файлу. */
  absolutePath: string;
  /** Оригінальне ім'я файлу. */
  originalName: string;
  /** MIME-тип файлу. */
  mimeType: string;
  /** Розмір файлу в байтах. */
  size: number;
  /** Дата створення запису. */
  createdAt: Date;
}

/**
 * Контракт сервісу роботи із зображеннями.
 *
 * Реалізація живе в окремому класі (`LocalStorageImageService`),
 * щоб логіку роботи з ФС можна було замінити/протестувати ізольовано.
 */
export interface ImageStorageService {
  /**
   * Зберігає зображення у відповідну папку (`orders/<id>` або `burials/<id>`)
   * та повертає відносний шлях, який потрібно записати в БД.
   */
  saveImage(data: Buffer, context: ImageSaveContext): Promise<ImageSaveResult | null>;

  /**
   * Знаходить зображення за контекстом (kind, id, slot).
   * Повертає масив знайдених зображень.
   */
  findImages(context: ImageFindContext): Promise<ImageFindResult[]>;

  /**
   * Отримує зображення за його відносним шляхом (path).
   * Повертає буфер зображення.
   */
  getImageByPath(path: string): Promise<Buffer>;
}