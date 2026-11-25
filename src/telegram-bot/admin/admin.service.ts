import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { Back4appService } from '../../back4app/back4app.service';
import * as Parse from 'parse/node';
import { AdminTable, AdminEntity, AdminRole } from './models/admin-table';

@Injectable()
export class AdminService {
  private readonly logger = new Logger(AdminService.name);
  private readonly adminClassName = AdminTable.TableName;

  constructor(private back4app: Back4appService) {}

  /**
   * Створити або оновити адміна за telegramId.
   * Якщо адмін вже існує — оновлюємо його дані.
   */
  async upsertAdmin(params: {
    telegramId: string;
    username?: string | null;
    firstName?: string | null;
    lastName?: string | null;
    role?: AdminRole;
  }): Promise<AdminEntity> {
    this.logger.log(`[AdminService] upsertAdmin`, { telegramId: params.telegramId });

    const query = new this.back4app.parse.Query(this.adminClassName);
    query.equalTo(AdminTable.Fields.TelegramId, params.telegramId);
    const results = await query.find();

    let admin: Parse.Object;
    if (results.length > 0) {
      admin = results[0];
    } else {
      admin = new this.back4app.parse.Object(this.adminClassName);
      admin.set(AdminTable.Fields.TelegramId, params.telegramId);
      admin.set(AdminTable.Fields.CreatedAt, new Date());
    }

    if (params.username !== undefined) admin.set(AdminTable.Fields.Username, params.username);
    if (params.firstName !== undefined) admin.set(AdminTable.Fields.FirstName, params.firstName);
    if (params.lastName !== undefined) admin.set(AdminTable.Fields.LastName, params.lastName);
    if (params.role !== undefined) admin.set(AdminTable.Fields.Role, params.role);
    admin.set(AdminTable.Fields.IsActive, true);
    admin.set(AdminTable.Fields.UpdatedAt, new Date());

    const saved = await admin.save();
    return this.mapAdmin(saved);
  }

  /**
   * Отримати адміна за telegramId.
   */
  async findByTelegramId(telegramId: string): Promise<AdminEntity | null> {
    this.logger.log(`[AdminService] findByTelegramId`, { telegramId });
    const query = new this.back4app.parse.Query(this.adminClassName);
    query.equalTo(AdminTable.Fields.TelegramId, telegramId);
    const results = await query.find();
    if (!results || results.length === 0) return null;
    return this.mapAdmin(results[0]);
  }

  /**
   * Отримати всіх активних адмінів.
   */
  async findAllActive(): Promise<AdminEntity[]> {
    this.logger.log(`[AdminService] findAllActive`, {});
    const query = new this.back4app.parse.Query(this.adminClassName);
    query.equalTo(AdminTable.Fields.IsActive, true);
    const results = await query.find();
    return results.map((r) => this.mapAdmin(r));
  }

  /**
   * Отримати всіх адмінів (включаючи неактивних).
   */
  async findAll(): Promise<AdminEntity[]> {
    this.logger.log(`[AdminService] findAll`, {});
    const query = new this.back4app.parse.Query(this.adminClassName);
    const results = await query.find();
    return results.map((r) => this.mapAdmin(r));
  }

  /**
   * Деактивувати адміна (м'яке видалення).
   */
  async deactivateAdmin(telegramId: string): Promise<void> {
    this.logger.log(`[AdminService] deactivateAdmin`, { telegramId });
    const admin = await this.findByTelegramId(telegramId);
    if (!admin) throw new NotFoundException(`Адміна з telegramId ${telegramId} не знайдено`);

    const query = new this.back4app.parse.Query(this.adminClassName);
    query.equalTo(AdminTable.Fields.TelegramId, telegramId);
    const results = await query.find();
    if (results.length > 0) {
      const obj = results[0];
      obj.set(AdminTable.Fields.IsActive, false);
      obj.set(AdminTable.Fields.UpdatedAt, new Date());
      await obj.save();
    }
  }

  /**
   * Перевірити чи є користувач адміном.
   */
  async isAdmin(telegramId: string): Promise<boolean> {
    const admin = await this.findByTelegramId(telegramId);
    return admin ? admin.isActive === true : false;
  }

  private mapAdmin(obj: Parse.Object): AdminEntity {
    return {
      objectId: obj.id,
      telegramId: obj.get(AdminTable.Fields.TelegramId) as string,
      username: obj.get(AdminTable.Fields.Username) as string | null,
      firstName: obj.get(AdminTable.Fields.FirstName) as string | null,
      lastName: obj.get(AdminTable.Fields.LastName) as string | null,
      role: obj.get(AdminTable.Fields.Role) as AdminRole | undefined,
      isActive: obj.get(AdminTable.Fields.IsActive) as boolean | undefined,
      createdAt: obj.createdAt,
      updatedAt: obj.updatedAt,
    };
  }
}
