import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { Back4appService } from '../back4app/back4app.service';
import { IMAGE_STORAGE_SERVICE } from './image-storage.constants';
import { TmpImageStorageService } from "./tmp-image-storage.service";

/**
 * Модуль роботи із зображеннями.
 *
 * Наружу віддає контракт `ImageStorageService` (токен `IMAGE_STORAGE_SERVICE`),
 * реалізація — `Back4appImageStorageService` (збереження у таблиці Back4app).
 */
@Module({
  imports: [ConfigModule],
  providers: [
    Back4appService,
    TmpImageStorageService,
    {
      provide: IMAGE_STORAGE_SERVICE,
      useExisting: TmpImageStorageService,
    },
  ],
  exports: [IMAGE_STORAGE_SERVICE],
})
export class ImagesModule {}