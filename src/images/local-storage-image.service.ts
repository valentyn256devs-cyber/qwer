import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { promises as fs } from 'fs';
import * as path from 'path';
import sharp from 'sharp';
import {
  ImageFindContext,
  ImageFindResult,
  ImageSaveContext,
  ImageSaveResult,
  ImageStorageService,
} from './image-storage.interface';

/**
 * Реалізація роботи із зображеннями на локальному диску.
 *
 * Структура папок:
 *   <root>/orders/<orderId>/<slot>/<timestamp>-<rand>.<ext>
 *   <root>/burials/<burialId>/<slot>/<timestamp>-<rand>.<ext>
 *
 * У БД зберігається лише відносний шлях (напр. `orders/<id>/before/169...-ab.jpg`).
 */
@Injectable()
export class LocalStorageImageService
  implements ImageStorageService, OnModuleInit
{
  private readonly logger = new Logger(LocalStorageImageService.name);
  private readonly root: string;

  constructor(private readonly config: ConfigService) {
    this.root = path.resolve(
      this.config.get<string>('IMAGE_STORAGE_ROOT') || './storage/images',
    );
  }

  /** Створює кореневу папку при старті застосунку. */
  async onModuleInit(): Promise<void> {
    await fs.mkdir(this.root, { recursive: true });
    this.logger.log(`Image storage root: ${this.root}`);
  }

  async saveImage(
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

    const groupDir = context.kind === 'burial' ? 'burials' : 'orders';
    const ext = this.resolveExtension(context.mimeType);
    const fileName = `${Date.now()}-${Math.random()
      .toString(36)
      .slice(2, 8)}${ext}`;

    // Відносний шлях (те, що йде в БД).
    const relativeSegments = [groupDir, context.id];
    if (context.slot) {
      relativeSegments.push(context.slot);
    }
    relativeSegments.push(fileName);
    const relativePath = relativeSegments.join('/');

    const absolutePath = path.join(this.root, ...relativeSegments);
    await fs.mkdir(path.dirname(absolutePath), { recursive: true });
    await fs.writeFile(absolutePath, optimizedBuffer);

    return {
      path: relativePath,
      absolutePath,
      size: optimizedBuffer.length,
    };
  }

  /**
   * Знаходить зображення за контекстом (kind, id, slot).
   * Повертає масив знайдених зображень.
   */
  async findImages(context: ImageFindContext): Promise<ImageFindResult[]> {
    const groupDir = context.kind === 'burial' ? 'burials' : 'orders';
    const searchDir = path.join(this.root, groupDir, context.id);

    if (context.slot) {
      return this.findImagesInDir(path.join(searchDir, context.slot));
    }

    // Якщо slot не вказано, шукаємо в всіх підпапках
    const results: ImageFindResult[] = [];
    try {
      const entries = await fs.readdir(searchDir, { withFileTypes: true });
      for (const entry of entries) {
        if (entry.isDirectory()) {
          const subResults = await this.findImagesInDir(path.join(searchDir, entry.name));
          results.push(...subResults);
        } else if (entry.isFile() && this.isImageFile(entry.name)) {
          const filePath = path.join(searchDir, entry.name);
          const stat = await fs.stat(filePath);
          const relativePath = path.relative(this.root, filePath).replace(/\\/g, '/');
          results.push({
            path: relativePath,
            absolutePath: filePath,
            originalName: entry.name,
            mimeType: this.getMimeType(entry.name),
            size: stat.size,
            createdAt: stat.birthtime,
          });
        }
      }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
        throw error;
      }
      // Папка не існує - повертаємо порожній масив
    }

    return results.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
  }

  /**
   * Отримує зображення за його відносним шляхом (path).
   * Повертає буфер зображення.
   */
  async getImageByPath(relativePath: string): Promise<Buffer> {
    const absolutePath = path.join(this.root, relativePath);
    try {
      return await fs.readFile(absolutePath);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        throw new Error(`Image not found at path: ${relativePath}`);
      }
      throw error;
    }
  }

  /**
   * Рекурсивно знаходить зображення в директорії.
   */
  private async findImagesInDir(dir: string): Promise<ImageFindResult[]> {
    const results: ImageFindResult[] = [];
    try {
      const entries = await fs.readdir(dir, { withFileTypes: true });
      for (const entry of entries) {
        if (entry.isFile() && this.isImageFile(entry.name)) {
          const filePath = path.join(dir, entry.name);
          const stat = await fs.stat(filePath);
          const relativePath = path.relative(this.root, filePath).replace(/\\/g, '/');
          results.push({
            path: relativePath,
            absolutePath: filePath,
            originalName: entry.name,
            mimeType: this.getMimeType(entry.name),
            size: stat.size,
            createdAt: stat.birthtime,
          });
        }
      }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
        throw error;
      }
    }
    return results;
  }

  /** Перевіряє, чи є файл зображенням за розширенням. */
  private isImageFile(fileName: string): boolean {
    const ext = path.extname(fileName).toLowerCase();
    return ['.jpg', '.jpeg', '.png', '.webp', '.gif'].includes(ext);
  }

  /** Визначає MIME-тип за розширенням файлу. */
  private getMimeType(fileName: string): string {
    const ext = path.extname(fileName).toLowerCase();
    const map: Record<string, string> = {
      '.jpg': 'image/jpeg',
      '.jpeg': 'image/jpeg',
      '.png': 'image/png',
      '.webp': 'image/webp',
      '.gif': 'image/gif',
    };
    return map[ext] || 'image/jpeg';
  }

  /** Визначає розширення файлу за MIME-типом. */
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