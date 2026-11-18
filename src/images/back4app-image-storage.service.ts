import { Injectable, Logger } from '@nestjs/common';
import * as Parse from 'parse/node';
import sharp from 'sharp';
import { Back4appService } from '../back4app/back4app.service';
import { ConfigService } from '@nestjs/config';
import {
  ImageFindContext,
  ImageFindResult,
  ImageSaveContext,
  ImageSaveResult,
  ImageStorageService,
} from './image-storage.interface';

/**
 * Реалізація роботи із зображеннями через Back4app (Parse Server).
 *
 * Файли зберігаються як `Parse.File` у таблиці `ImageModel`,
 * а в БД (Order/Burial) потрапляє лише URL або шлях до файлу.
 *
 * Структура таблиці `ImageModel`:
 *   - `file`         — Parse.File (сам файл)
 *   - `originalName` — оригінальне ім'я файлу
 *   - `kind`         — 'order' | 'burial'
 *   - `entityId`     — orderId або burialId
 *   - `slot`         — before | after | checklist/<stepId> | ...
 *   - `mimeType`     — MIME-тип
 *   - `size`         — розмір у байтах
 */
@Injectable()
export class Back4appImageStorageService implements ImageStorageService {
  private readonly logger = new Logger(Back4appImageStorageService.name);
  private readonly masterKey: string;
  private readonly serverUrl: string;
  private readonly appId: string;
  private readonly jsKey: string;
  private readonly fileKey: string;

  constructor(
    private readonly back4app: Back4appService,
    private readonly config: ConfigService,
  ) {
    this.masterKey = this.config.get<string>('BACK4APP_MASTER_KEY') || '';
    this.serverUrl = this.config.get<string>('BACK4APP_SERVER_URL') || '';
    this.appId = this.config.get<string>('BACK4APP_APP_ID') || '';
    this.jsKey = this.config.get<string>('BACK4APP_JS_KEY') || '';
    this.fileKey = this.config.get<string>('BACK4APP_FILE_KEY') || '';

    // Ініціалізуємо Parse з master key одразу при створенні сервісу
    if (this.appId && this.jsKey && this.masterKey) {
      Parse.initialize(this.appId, this.jsKey, this.masterKey);
      Parse.CoreManager.set('SERVER_URL', this.serverUrl);
      // Parse.CoreManager.set('FILE_KEY', this.fileKey); // Якщо вимагається
      Parse.CoreManager.set('FILE_KEY', this.fileKey);

      // Parse.serverURL = this.serverUrl;

      // Вмикаємо master key для всіх операцій
      Parse.Cloud.useMasterKey();
    }
  }

  async saveImage(
    data: Buffer,
    context: ImageSaveContext,
  ): Promise<ImageSaveResult> {
    if (!context?.id) {
      throw new Error('ImageStorage: context.id is required');
    }

    // 1. Оптимізуємо зображення через sharp
    const optimizedBuffer = await sharp(data)
      .resize({ width: 1920, withoutEnlargement: true })
      .jpeg({ quality: 80 })
      .toBuffer();

    const ext = this.resolveExtension(context.mimeType);
    const fileName = `${Date.now()}-${Math.random()
      .toString(36)
      .slice(2, 8)}${ext}`;

    const base64 = optimizedBuffer.toString('base64');
    const mimeType = 'image/jpeg';

    const ParseInstance = this.back4app.parse;

    // 2. Створюємо Parse.File через SDK з передачею сесії або впевненим useMasterKey
    const parseFile = new ParseInstance.File(fileName, { base64 }, mimeType);

    try {
      // Спробуємо зберегти файл із повним набором прав через SDK
      await parseFile.save({ useMasterKey: true });
    } catch (error) {
      this.logger.error(`Помилка збереження Parse.File: ${error.message}`);

      // Якщо прямий метод падає через політику безпеки сховища Back4app,
      // використовуємо альтернативний шлях через REST з правильним форматом MasterKey
      const cleanServerUrl = this.serverUrl.replace(/\/$/, '');
      const uploadUrl = `${cleanServerUrl}/files/${fileName}`;

      const uploadResponse = await fetch(uploadUrl, {
        method: 'POST',
        headers: {
          'X-Parse-Application-Id': this.appId,
          // У деяких конфігураціях Back4app вимагає саме ці два ключі разом із File-Key
          'X-Parse-Master-Key': this.masterKey,
          ...(this.fileKey ? { 'X-Parse-File-Key': this.fileKey } : {}),
          'Content-Type': mimeType,
        },
        body: optimizedBuffer as unknown as BodyInit,
      });

      if (!uploadResponse.ok) {
        const errorText = await uploadResponse.text();
        throw new Error(`Failed to upload file to Back4app: ${errorText}`);
      }

      const uploadResult = (await uploadResponse.json()) as {
        name: string;
        url: string;
      };

      // Примусово присвоюємо URL якщо REST відпрацював успішно
      (parseFile as any)._name = uploadResult.name;
      (parseFile as any)._url = uploadResult.url;
    }

    const fileUrl = parseFile.url();
    this.logger.log(`Збережено файл у Back4app: ${fileName} → ${fileUrl}`);

    // 3. Створюємо запис у таблиці ImageModel
    const ImageModel = ParseInstance.Object.extend('ImageModel');
    const imageRecord = new ImageModel();

    imageRecord.set('file', parseFile);
    imageRecord.set('originalName', fileName);
    imageRecord.set('kind', context.kind);
    imageRecord.set('entityId', context.id);
    imageRecord.set('slot', context.slot ?? '');
    imageRecord.set('mimeType', mimeType);
    imageRecord.set('size', optimizedBuffer.length);

    await imageRecord.save(null, { useMasterKey: true });

    return {
      path: fileUrl ?? fileName,
      absolutePath: fileUrl ?? '',
      size: optimizedBuffer.length,
    };
  }

  /**
   * Зберігає зображення у Back4app як `Parse.File` + створює запис у `ImageModel`.
   * Перед збереженням зображення стискається та змінюється розмір (макс. ширина 1920px, якість 80%).
   *
   * @param data    — буфер зображення.
   * @param context — контекст збереження (kind, id, slot, mimeType).
   * @returns результат збереження (path, absolutePath, size).
   */
  async saveImage2(
    data: Buffer,
    context: ImageSaveContext,
  ): Promise<ImageSaveResult> {
    if (!context?.id) {
      throw new Error('ImageStorage: context.id is required');
    }

    // Оптимізуємо зображення через sharp: обмежуємо ширину 1920px, якість 80%
    const optimizedBuffer = await sharp(data)
      .resize({ width: 1920, withoutEnlargement: true })
      .jpeg({ quality: 80 })
      .toBuffer();

    const ext = this.resolveExtension(context.mimeType);
    const fileName = `${Date.now()}-${Math.random()
      .toString(36)
      .slice(2, 8)}${ext}`;

    const base64 = optimizedBuffer.toString('base64');
    const mimeType = 'image/jpeg'; // Після оптимізації завжди JPEG

    // Отримуємо Parse (вже ініціалізований з master key в constructor)
    const Parse = this.back4app.parse;

    // Створюємо Parse.File
    const parseFile = new Parse.File(fileName, { base64 }, mimeType);

    // Зберігаємо файл на сервері Back4app (master key увімкнено через Parse.Cloud.useMasterKey())
    await parseFile.save({
      useMasterKey: true,
      ...({
        headers: {
          'X-Parse-Application-Id': this.appId,
          'X-Parse-Master-Key': this.masterKey,
        },
      } as any),
    });

    const fileUrl = parseFile.url();
    this.logger.log(`Збережено файл у Back4app: ${fileName} → ${fileUrl}`);

    // Створюємо запис у таблиці ImageModel
    const ImageModel = Parse.Object.extend('ImageModel');
    const imageRecord = new ImageModel();

    imageRecord.set('file', parseFile);
    imageRecord.set('originalName', fileName);
    imageRecord.set('kind', context.kind);
    imageRecord.set('entityId', context.id);
    imageRecord.set('slot', context.slot ?? '');
    imageRecord.set('mimeType', mimeType);
    imageRecord.set('size', optimizedBuffer.length);

    await imageRecord.save(null, {
      useMasterKey: true,
      /*headers: {
        'X-Parse-File-Key': this.fileKey, // якщо вимагається специфічним бекендом
      }*/
    });

    // У БД зберігаємо URL файлу
    const path = fileUrl ?? fileName;

    return {
      path,
      absolutePath: fileUrl ?? '',
      size: optimizedBuffer.length,
    };
  }

  /**
   * Знаходить зображення за контекстом (kind, id, slot).
   * Повертає масив знайдених зображень.
   */
  async findImages(context: ImageFindContext): Promise<ImageFindResult[]> {
    const Parse = this.back4app.parse;
    const ImageModel = Parse.Object.extend('ImageModel');
    const query = new Parse.Query(ImageModel);
    query.equalTo('kind', context.kind);
    query.equalTo('entityId', context.id);
    if (context.slot) {
      query.equalTo('slot', context.slot);
    }
    query.descending('createdAt');

    const results = await query.find({ useMasterKey: true });

    return results.map((obj) => {
      const file = obj.get('file') as Parse.File;
      return {
        path: file.url() ?? obj.get('originalName'),
        absolutePath: file.url() ?? '',
        originalName: obj.get('originalName'),
        mimeType: obj.get('mimeType'),
        size: obj.get('size'),
        createdAt: obj.createdAt,
      };
    });
  }

  /**
   * Отримує зображення за його відносним шляхом (path/URL).
   * Повертає буфер зображення.
   */
  async getImageByPath(path: string): Promise<Buffer> {
    // Якщо path - це URL, завантажуємо файл
    if (path.startsWith('http')) {
      const response = await fetch(path);
      if (!response.ok) {
        throw new Error(`Failed to fetch image from ${path}: ${response.statusText}`);
      }
      const arrayBuffer = await response.arrayBuffer();
      return Buffer.from(arrayBuffer);
    }

    // Якщо це просто ім'я файлу, шукаємо в ImageModel
    const Parse = this.back4app.parse;
    const ImageModel = Parse.Object.extend('ImageModel');
    const query = new Parse.Query(ImageModel);
    query.equalTo('originalName', path);
    const result = await query.first({ useMasterKey: true });

    if (!result) {
      throw new Error(`Image not found for path: ${path}`);
    }

    const file = result.get('file') as Parse.File;
    const fileUrl = file.url();
    if (!fileUrl) {
      throw new Error(`File URL not available for: ${path}`);
    }

    const response = await fetch(fileUrl);
    if (!response.ok) {
      throw new Error(`Failed to fetch image from ${fileUrl}: ${response.statusText}`);
    }
    const arrayBuffer = await response.arrayBuffer();
    return Buffer.from(arrayBuffer);
  }

  /**
   * Визначає розширення файлу за MIME-типом.
   *
   * @param mimeType — MIME-тип (напр. `image/jpeg`).
   * @returns розширення файлу (напр. `.jpg`).
   */
  private resolveExtension(mimeType?: string): string {
    const map: Record<string, string> = {
      'image/jpeg': '.jpg',
      'image/jpg': '.jpg',
      'image/png': '.png',
      'image/webp': '.webp',
      'image/gif': '.gif',
    };
    if (mimeType && map[mimeType]) {
      return map[mimeType];
    }
    return '.jpg';
  }
}