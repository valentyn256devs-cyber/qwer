import { Injectable, Logger } from '@nestjs/common';
import * as Parse from 'parse/node';
import sharp from 'sharp';
import { Back4appService } from '../back4app/back4app.service';
import { ImageModelTable } from './models/image-model-table';
import {
  ImageFindContext,
  ImageFindResult,
  ImageSaveContext,
  ImageSaveResult,
  ImageStorageService,
} from './image-storage.interface';

/**
 * Реалізація збереження зображень у вигляді Base64 рядка в таблицю `ImageModel`.
 * Використовує Back4appService для доступу до Parse (як інші сервіси).
 * Патерн відповідає BurialsService.
 */
@Injectable()
export class TmpImageStorageService implements ImageStorageService {
  private readonly logger = new Logger(TmpImageStorageService.name);
  private readonly className = ImageModelTable.TableName;

  constructor(private readonly back4app: Back4appService) {
  }

  /**
   * Зберігає зображення як Base64 рядок у таблиці `ImageModel`.
   */
  async saveImage(
    data: Buffer,
    context: ImageSaveContext,
  ): Promise<ImageSaveResult | null> {
    if (!context?.id) {
      throw new Error('ImageStorage: context.id is required');
    }

    // 1. Оптимізуємо зображення через sharp (макс. ширина 1200px, якість 75%)
    const optimizedBuffer = await sharp(data)
      .resize({ width: 1200, withoutEnlargement: true })
      .jpeg({ quality: 75 })
      .toBuffer();

    const fileName = `${Date.now()}-${Math.random()
      .toString(36)
      .slice(2, 8)}.jpg`;

    // 2. Конвертуємо буфер у Data URL (рядок Base64)
    const base64String = `data:image/jpeg;base64,${optimizedBuffer.toString('base64')}`;

    // 3. Зберігаємо текстовий рядок у таблицю ImageModel через Back4appService
    const Parse = this.back4app.parse;
    const imageRecord = new Parse.Object(this.className);

    imageRecord.set(ImageModelTable.Fields.Base64Data, base64String);
    imageRecord.set(ImageModelTable.Fields.OriginalName, fileName);
    imageRecord.set(ImageModelTable.Fields.Kind, context.kind);
    imageRecord.set(ImageModelTable.Fields.EntityId, context.id);
    imageRecord.set(ImageModelTable.Fields.Slot, context.slot ?? '');
    imageRecord.set(ImageModelTable.Fields.MimeType, 'image/jpeg');
    imageRecord.set(ImageModelTable.Fields.Size, optimizedBuffer.length);

    try {
      const saved = await imageRecord.save();
      this.logger.log(`Збережено зображення у вигляді Base64 для ${context.kind}:${context.id}`);
      return this.mapFields(saved);
    } catch (e) {
      this.logger.error(`Помилка при збереженні зображення: ${e}`);
    }
    return null;
  }

  /**
   * Знаходить зображення за контекстом.
   */
  async findImages(context: ImageFindContext): Promise<ImageFindResult[]> {
    const Parse = this.back4app.parse;
    const query = new Parse.Query(this.className);
    query.equalTo(ImageModelTable.Fields.Kind, context.kind);
    query.equalTo(ImageModelTable.Fields.EntityId, context.id);
    if (context.slot) {
      query.equalTo(ImageModelTable.Fields.Slot, context.slot);
    }
    query.descending('createdAt');

    const results = await query.find({ useMasterKey: true });

    return results.map((obj) => this.mapFields(obj));
  }

  /**
   * Отримує зображення як Buffer за його назвою або Base64 рядком.
   */
  async getImageByPath(path: string): Promise<Buffer> {
    // Якщо це вже готовий Base64 рядок
    if (path.startsWith('data:image')) {
      const base64Data = path.split(',')[1];
      return Buffer.from(base64Data, 'base64');
    }

    // Якщо це ім'я файлу, шукаємо в базі за оригінальною назвою
    const Parse = this.back4app.parse;
    const query = new Parse.Query(this.className);
    query.equalTo(ImageModelTable.Fields.OriginalName, path);
    const result = await query.first({ useMasterKey: true });

    if (!result) {
      throw new Error(`Image not found for path: ${path}`);
    }

    const base64String = result.get(ImageModelTable.Fields.Base64Data) as string;
    if (!base64String) {
      throw new Error(`Base64 data not available for: ${path}`);
    }

    const base64Data = base64String.split(',')[1] || base64String;
    return Buffer.from(base64Data, 'base64');
  }

  /**
   * Мапінг з Parse.Object у стандартний об'єкт ImageSaveResult / ImageFindResult.
   * Патерн відповідає BurialsService.mapFields.
   */
  private mapFields(obj: Parse.Object): ImageSaveResult & ImageFindResult {
    const base64Data = obj.get(ImageModelTable.Fields.Base64Data) as string | undefined;
    return {
      path: obj.get(ImageModelTable.Fields.OriginalName) as string,
      absolutePath: base64Data ?? '',
      originalName: obj.get(ImageModelTable.Fields.OriginalName) as string,
      mimeType: obj.get(ImageModelTable.Fields.MimeType) as string,
      size: obj.get(ImageModelTable.Fields.Size) as number,
      createdAt: obj.createdAt,
    };
  }
}