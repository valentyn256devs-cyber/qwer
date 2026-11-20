import {Injectable, Logger, NotFoundException} from '@nestjs/common';
import {Back4appService} from '../back4app/back4app.service';
import * as Parse from 'parse/node';
import {BurialTable} from './models/burial-table';
import {CreateBurialDto} from './dto/create-burial.dto';

@Injectable()
export class BurialsService {
  private readonly logger = new Logger(BurialsService.name);
  private readonly className = BurialTable.TableName;

  constructor(private readonly back4app: Back4appService) {
  }

  /**
   * Створення нового поховання (працює і для API, і для бота)
   */
  async create(dto: CreateBurialDto) {
    this.logger.log(`[BurialsService] create`, { dto });
    const burial = new Parse.Object(this.className);

    burial.set(BurialTable.Fields.Name, dto.name);
    burial.set(BurialTable.Fields.BurialName, dto.burialName);
    burial.set(BurialTable.Fields.BurialLastName, dto.burialLastName);
    burial.set(BurialTable.Fields.BurialFatherName, dto.burialFatherName);
    burial.set(BurialTable.Fields.BirthDate, dto.birthDate ?? null);
    burial.set(BurialTable.Fields.DeathDate, dto.deathDate ?? null);
    // burial.set(BurialTable.Fields.BirthDate, dto.birthDate ? new Date(dto.birthDate) : null);
    // burial.set(BurialTable.Fields.DeathDate, dto.deathDate ? new Date(dto.deathDate) : null);
    burial.set(BurialTable.Fields.Cemetery, dto.cemetery);
    burial.set(BurialTable.Fields.Coordinates, dto.coordinates ?? '');
    burial.set(BurialTable.Fields.TelegramId, dto.telegramId ?? '');
    burial.set(BurialTable.Fields.Notes, dto.notes ?? '');

    // Обробка фото, якщо вони передані в base64 (наприклад, з Telegram)
    const parseFiles: Parse.File[] = [];
    if (dto.photos && dto.photos.length > 0) {
      for (const fileData of dto.photos) {
        const parseFile = new this.back4app.parse.File(fileData.name, {base64: fileData.base64});
        // const parseFile = new this.back4app.parse.File(fileData.name, {base64: fileData.base64});
        const savedFile = await parseFile.save();
        parseFiles.push(savedFile);
      }
    }
    burial.set(BurialTable.Fields.Photos, parseFiles);

    const saved = await burial.save();
    return this.mapFields(saved);
  }

  /**
   * Отримання всіх поховань конкретного користувача Telegram
   */
  async findByTelegramId(telegramId: string, includeDeleted = false) {
    this.logger.log(`[BurialsService] findByTelegramId`, { telegramId, includeDeleted });
    const query = new this.back4app.parse.Query(this.className);
    query.equalTo(BurialTable.Fields.TelegramId, telegramId);
    query.descending('createdAt');

    // 🌟 якщо includeDeleted === false, відсікаємо м'яко видалені записи
    if (!includeDeleted) {
      query.notEqualTo('isDeleted', true);
    }

    const results = await query.find();
    return results.map(b => this.mapFields(b));
  }

  /**
   * Отримання одного поховання за objectId
   */
  async findOne(id: string) {
    this.logger.log(`[BurialsService] findOne`, { id });
    try {
      const query = new this.back4app.parse.Query(this.className);
      const result = await query.get(id);
      return this.mapFields(result);
    } catch {
      throw new NotFoundException(`Поховання з ID ${id} не знайдено`);
    }
  }

  async findBurialById(id: string | undefined) {
    // this.logger.log(`[BurialsService] findBurialById`, { id });
    try {
      if (!id) {
        return undefined;
      }
      return this.findOne(id);
    } catch (error) {
      console.log(error);
      return undefined;
    }
  }

  async updateBurial(id: string, data: Partial<any>): Promise<any> {
    this.logger.log(`[BurialsService] updateBurial`, { id, data });
    const query = new Parse.Query(this.className);
    const obj = await query.get(id);

    if (!obj) throw new Error('Burial object not found');

    // Динамічно проходимо по полях, які надіслав візард
    if (data.name !== undefined) obj.set(BurialTable.Fields.Name, data.name);
    if (data.cemetery !== undefined) obj.set(BurialTable.Fields.Cemetery, data.cemetery);
    if (data.coordinates !== undefined) obj.set(BurialTable.Fields.Coordinates, data.coordinates);
    if (data.burialLastName !== undefined) obj.set(BurialTable.Fields.BurialLastName, data.burialLastName);
    if (data.burialName !== undefined) obj.set(BurialTable.Fields.BurialName, data.burialName);
    if (data.burialFatherName !== undefined) obj.set(BurialTable.Fields.BurialFatherName, data.burialFatherName);
    if (data.birthDate !== undefined) obj.set(BurialTable.Fields.BirthDate, data.birthDate);
    if (data.deathDate !== undefined) obj.set(BurialTable.Fields.DeathDate, data.deathDate);
    if (data.notes !== undefined) obj.set(BurialTable.Fields.Notes, data.notes);

    if (data.isDeleted !== undefined) obj.set('isDeleted', data.isDeleted);

    await obj.save();
    return obj;
  }

  /**
   * Мапінг з Parse.Object у стандартний об'єкт
   */
  private mapFields(obj: Parse.Object) {
    this.logger.log(`[BurialsService] mapFields`, { id: obj.id });
    const photosArray = obj.get(BurialTable.Fields.Photos) as Parse.File[] | undefined;
    const urls = photosArray ? photosArray.map(file => file.url()) : [];

    return {
      id: obj.id,
      name: obj.get(BurialTable.Fields.Name) as string,
      burialName: obj.get(BurialTable.Fields.BurialName) as string | null,
      burialLastName: obj.get(BurialTable.Fields.BurialLastName) as string | null,
      burialFatherName: obj.get(BurialTable.Fields.BurialFatherName) as string | null,
      birthDate: obj.get(BurialTable.Fields.BirthDate) as string | null,
      deathDate: obj.get(BurialTable.Fields.DeathDate) as string | null,
      cemetery: obj.get(BurialTable.Fields.Cemetery) as string,
      coordinates: obj.get(BurialTable.Fields.Coordinates) as string,
      notes: obj.get(BurialTable.Fields.Notes) as string,
      telegramId: obj.get(BurialTable.Fields.TelegramId) as string,
      photos: urls,
      createdAt: obj.createdAt,

      isDeleted: obj.get(BurialTable.Fields.isDeleted) as boolean,
    };
  }
}