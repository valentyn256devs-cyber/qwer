import {
  Injectable,
  NotFoundException,
  BadRequestException,
  ForbiddenException,
} from '@nestjs/common';
import { Back4appService } from '../back4app/back4app.service';
import * as Parse from 'parse/node';
import {
  MemoryPlaceTable,
} from './models/memory-place-table';
import {
  MemoryPlaceUpdateRequestTable,
  MemoryPlaceUpdateStatus,
} from './models/memory-place-update-request-table';
import {
  MemoryPlaceVersionTable,
} from './models/memory-place-version-table';
import { ProposeMemoryPlaceUpdateDto } from './dto/propose-memory-place-update.dto';
import { ReviewMemoryPlaceUpdateDto } from './dto/review-memory-place-update.dto';

/**
 * Поля Memory Place, які можна запропонувати змінити.
 */
export const MEMORY_PLACE_UPDATEABLE_FIELDS = [
  'fullName',
  'cemetery',
  'sector',
  'row',
  'placeNumber',
  'gpsLat',
  'gpsLng',
  'description',
  'landmarks',
  'photos',
  'monumentData',
  'notes',
] as const;

export type MemoryPlaceUpdateableField = (typeof MEMORY_PLACE_UPDATEABLE_FIELDS)[number];

/**
 * Людські назви полей для відображення у diff (адмінський перегляд).
 */
const FIELD_LABELS: Record<string, string> = {
  fullName: 'ПІБ',
  cemetery: 'Кладовище',
  sector: 'Сектор',
  row: 'Ряд',
  placeNumber: 'Номер',
  gpsLat: 'GPS (широта)',
  gpsLng: 'GPS (довгота)',
  description: 'Опис',
  landmarks: 'Орієнтири',
  photos: 'Фото',
  monumentData: 'Дані пам\'ятника',
  notes: 'Додаткові примітки',
};

/**
 * Знімок даних Memory Place (поточні або пропоновані).
 */
export interface MemoryPlaceDataSnapshot {
  fullName?: string | null;
  cemetery?: string | null;
  sector?: string | null;
  row?: string | null;
  placeNumber?: string | null;
  gpsLat?: string | null;
  gpsLng?: string | null;
  description?: string | null;
  landmarks?: string | null;
  photos?: string[];
  monumentData?: string | null;
  notes?: string | null;
}

/**
 * Рядок diff для адміністратора.
 */
export interface MemoryPlaceDiffRow {
  field: string;
  label: string;
  current: unknown;
  proposed: unknown;
}

export interface MemoryPlaceUpdateRequestView {
  id: string;
  memoryPlaceId: string;
  orderId?: string;
  proposedBy: string;
  proposedData: MemoryPlaceDataSnapshot;
  currentData: MemoryPlaceDataSnapshot;
  status: MemoryPlaceUpdateStatus;
  clarificationNote?: string;
  createdAt?: string;
  adminReviewedAt?: string;
  adminReviewedBy?: string;
  clientReviewedAt?: string;
  clientReviewedBy?: string;
}

@Injectable()
export class MemoryPlaceUpdateRequestService {
  private readonly memoryPlaceClass = MemoryPlaceTable.TableName;
  private readonly requestClass = MemoryPlaceUpdateRequestTable.TableName;
  private readonly versionClass = MemoryPlaceVersionTable.TableName;

  constructor(private readonly back4app: Back4appService) {}

  /* ========================================================================
   * 1. Виконавець пропонує оновлення (Executors proposes update)
   *    Flow: Propose Update -> AwaitingAdminApproval
   * ======================================================================== */
  async proposeUpdate(
    dto: ProposeMemoryPlaceUpdateDto,
    executorId: string,
  ): Promise<MemoryPlaceUpdateRequestView> {
    // Перевіряємо, що Memory Place існує і знімаємо поточний знімок даних
    const currentData = await this.getMemoryPlaceSnapshot(dto.memoryPlaceId);

    const proposedData = this.extractProposedData(dto);

    if (Object.keys(proposedData).length === 0) {
      throw new BadRequestException('Не вказано жодного поля для оновлення');
    }

    const request = new this.back4app.parse.Object(this.requestClass);
    request.set(MemoryPlaceUpdateRequestTable.Fields.MemoryPlaceId, dto.memoryPlaceId);
    request.set(MemoryPlaceUpdateRequestTable.Fields.OrderId, dto.orderId ?? null);
    request.set(MemoryPlaceUpdateRequestTable.Fields.ProposedBy, executorId);
    request.set(MemoryPlaceUpdateRequestTable.Fields.ProposedData, proposedData);
    request.set(MemoryPlaceUpdateRequestTable.Fields.CurrentData, currentData);
    request.set(
      MemoryPlaceUpdateRequestTable.Fields.Status,
      MemoryPlaceUpdateStatus.AwaitingAdminApproval,
    );
    request.set(MemoryPlaceUpdateRequestTable.Fields.CreatedAt, new Date());

    const saved = await request.save();
    return this.mapRequestView(saved);
  }

  /* ========================================================================
   * 2. Адмін переглядає запит і приймає рішення
   *    Дії: Погодити / Відхилити / Запросити уточнення
   * ======================================================================== */
  async adminReview(
    requestId: string,
    dto: ReviewMemoryPlaceUpdateDto,
    adminId: string,
  ): Promise<MemoryPlaceUpdateRequestView> {
    const request = await this.getRequestById(requestId);

    if (request.get(MemoryPlaceUpdateRequestTable.Fields.Status) !== MemoryPlaceUpdateStatus.AwaitingAdminApproval) {
      throw new BadRequestException(
        'Запит не очікує на схвалення адміністратором',
      );
    }

    const now = new Date();
    request.set(MemoryPlaceUpdateRequestTable.Fields.AdminReviewedAt, now);
    request.set(MemoryPlaceUpdateRequestTable.Fields.AdminReviewedBy, adminId);

    if (dto.clarificationNote) {
      request.set('clarificationNote', dto.clarificationNote);
    }

    switch (dto.status) {
      case MemoryPlaceUpdateStatus.AwaitingClientApproval:
        request.set(MemoryPlaceUpdateRequestTable.Fields.Status, MemoryPlaceUpdateStatus.AwaitingClientApproval);
        break;
      case MemoryPlaceUpdateStatus.RejectedByAdmin:
        request.set(MemoryPlaceUpdateRequestTable.Fields.Status, MemoryPlaceUpdateStatus.RejectedByAdmin);
        break;
      case MemoryPlaceUpdateStatus.PendingClarification:
        request.set(MemoryPlaceUpdateRequestTable.Fields.Status, MemoryPlaceUpdateStatus.PendingClarification);
        break;
      default:
        throw new BadRequestException(
          `Адміністратор не може встановити статус ${dto.status}`,
        );
    }

    const saved = await request.save();
    return this.mapRequestView(saved);
  }

  /* ========================================================================
   * 3. Клієнт переглядає запропоновані зміни і приймає рішення
   *    Дії: Підтвердити зміни / Відхилити / Уточнити
   *    Тільки після Client Approval основна Memory Place змінюється.
   * ======================================================================== */
  async clientReview(
    requestId: string,
    dto: ReviewMemoryPlaceUpdateDto,
    clientId: string,
  ): Promise<MemoryPlaceUpdateRequestView> {
    const request = await this.getRequestById(requestId);

    if (request.get(MemoryPlaceUpdateRequestTable.Fields.Status) !== MemoryPlaceUpdateStatus.AwaitingClientApproval) {
      throw new BadRequestException(
        'Запит не очікує на схвалення клієнтом',
      );
    }

    const now = new Date();
    request.set(MemoryPlaceUpdateRequestTable.Fields.ClientReviewedAt, now);
    request.set(MemoryPlaceUpdateRequestTable.Fields.ClientReviewedBy, clientId);

    if (dto.clarificationNote) {
      request.set('clarificationNote', dto.clarificationNote);
    }

    switch (dto.status) {
      case MemoryPlaceUpdateStatus.Approved: {
        request.set(MemoryPlaceUpdateRequestTable.Fields.Status, MemoryPlaceUpdateStatus.Approved);
        const memoryPlaceId = request.get(
          MemoryPlaceUpdateRequestTable.Fields.MemoryPlaceId,
        ) as string;
        await this.applyApprovedUpdate(request, memoryPlaceId);
        break;
      }
      case MemoryPlaceUpdateStatus.RejectedByClient:
        request.set(MemoryPlaceUpdateRequestTable.Fields.Status, MemoryPlaceUpdateStatus.RejectedByClient);
        break;
      case MemoryPlaceUpdateStatus.PendingClarification:
        request.set(MemoryPlaceUpdateRequestTable.Fields.Status, MemoryPlaceUpdateStatus.PendingClarification);
        break;
      default:
        throw new BadRequestException(
          `Клієнт не може встановити статус ${dto.status}`,
        );
    }

    const saved = await request.save();
    return this.mapRequestView(saved);
  }

  /* ========================================================================
   * 4. Застосувати схвалене оновлення до Memory Place + зберегти версію
   * ======================================================================== */
  private async applyApprovedUpdate(
    request: Parse.Object,
    memoryPlaceId: string,
  ): Promise<void> {
    const proposedData = request.get(
      MemoryPlaceUpdateRequestTable.Fields.ProposedData,
    ) as MemoryPlaceDataSnapshot;
    const currentData = request.get(
      MemoryPlaceUpdateRequestTable.Fields.CurrentData,
    ) as MemoryPlaceDataSnapshot;
    const orderId = request.get(
      MemoryPlaceUpdateRequestTable.Fields.OrderId,
    ) as string | undefined;
    const proposedBy = request.get(
      MemoryPlaceUpdateRequestTable.Fields.ProposedBy,
    ) as string;
    const adminReviewedBy = request.get(
      MemoryPlaceUpdateRequestTable.Fields.AdminReviewedBy,
    ) as string | undefined;
    const clientReviewedBy = request.get(
      MemoryPlaceUpdateRequestTable.Fields.ClientReviewedBy,
    ) as string | undefined;

    // Отримуємо поточний об'єкт Memory Place
    const memoryPlace = await this.getMemoryPlaceObject(memoryPlaceId);
    const currentVersion = (memoryPlace.get(MemoryPlaceTable.Fields.Version) as number) ?? 0;
    const newVersion = currentVersion + 1;

    // Оновлюємо поля Memory Place пропонованими даними
    for (const field of MEMORY_PLACE_UPDATEABLE_FIELDS) {
      if (proposedData[field] !== undefined) {
        memoryPlace.set(MemoryPlaceTable.Fields[field as keyof typeof MemoryPlaceTable.Fields], proposedData[field]);
      }
    }
    memoryPlace.set(MemoryPlaceTable.Fields.Version, newVersion);
    await memoryPlace.save();

    // Зберігаємо версію (попередні дані не видаляються)
    const version = new this.back4app.parse.Object(this.versionClass);
    version.set(MemoryPlaceVersionTable.Fields.MemoryPlaceId, memoryPlaceId);
    version.set(MemoryPlaceVersionTable.Fields.Version, newVersion);
    version.set(MemoryPlaceVersionTable.Fields.PreviousData, currentData);
    version.set(MemoryPlaceVersionTable.Fields.Data, proposedData);
    version.set(MemoryPlaceVersionTable.Fields.ChangedBy, proposedBy); // executor
    version.set(MemoryPlaceVersionTable.Fields.AdminReviewedBy, adminReviewedBy ?? null);
    version.set(MemoryPlaceVersionTable.Fields.ClientReviewedBy, clientReviewedBy ?? null);
    version.set(MemoryPlaceVersionTable.Fields.OrderId, orderId ?? null);
    version.set(MemoryPlaceVersionTable.Fields.ChangedAt, new Date());
    await version.save();
  }

  /* ========================================================================
   * 5. Diff для адміністратора (поле / поточне / пропоноване)
   * ======================================================================== */
  async getDiff(requestId: string): Promise<MemoryPlaceDiffRow[]> {
    const request = await this.getRequestById(requestId);

    const currentData = request.get(
      MemoryPlaceUpdateRequestTable.Fields.CurrentData,
    ) as MemoryPlaceDataSnapshot;
    const proposedData = request.get(
      MemoryPlaceUpdateRequestTable.Fields.ProposedData,
    ) as MemoryPlaceDataSnapshot;

    const rows: MemoryPlaceDiffRow[] = [];

    for (const field of MEMORY_PLACE_UPDATEABLE_FIELDS) {
      const current = currentData[field];
      const proposed = proposedData[field];

      // Показуємо лише поля, які дійсно відрізняються
      if (this.valuesEqual(current, proposed)) {
        continue;
      }

      rows.push({
        field,
        label: FIELD_LABELS[field] ?? field,
        current,
        proposed,
      });
    }

    return rows;
  }

  /* ========================================================================
   * 6. Отримання запиту за ID
   * ======================================================================== */
  async getRequestById(requestId: string): Promise<Parse.Object> {
    try {
      const query = new this.back4app.parse.Query(this.requestClass);
      const result = await query.get(requestId);
      return result;
    } catch {
      throw new NotFoundException(`Запит на оновлення з ID ${requestId} не знайдено`);
    }
  }

  async getRequestViewById(requestId: string): Promise<MemoryPlaceUpdateRequestView> {
    const request = await this.getRequestById(requestId);
    return this.mapRequestView(request);
  }

  /* ========================================================================
   * 7. Список запитів (з опціональними фільтрами)
   * ======================================================================== */
  async listRequests(filters?: {
    memoryPlaceId?: string;
    status?: MemoryPlaceUpdateStatus;
    proposedBy?: string;
  }): Promise<MemoryPlaceUpdateRequestView[]> {
    const query = new this.back4app.parse.Query(this.requestClass);
    query.descending('createdAt');

    if (filters?.memoryPlaceId) {
      query.equalTo(MemoryPlaceUpdateRequestTable.Fields.MemoryPlaceId, filters.memoryPlaceId);
    }
    if (filters?.status) {
      query.equalTo(MemoryPlaceUpdateRequestTable.Fields.Status, filters.status);
    }
    if (filters?.proposedBy) {
      query.equalTo(MemoryPlaceUpdateRequestTable.Fields.ProposedBy, filters.proposedBy);
    }

    const results = await query.find();
    return results.map(r => this.mapRequestView(r));
  }

  /* ========================================================================
   * 8. Версії Memory Place (історія змін)
   * ======================================================================== */
  async listVersions(memoryPlaceId: string): Promise<any[]> {
    const query = new this.back4app.parse.Query(this.versionClass);
    query.equalTo(MemoryPlaceVersionTable.Fields.MemoryPlaceId, memoryPlaceId);
    query.descending('changedAt');
    const results = await query.find();
    return results.map(v => ({
      id: v.id,
      version: v.get(MemoryPlaceVersionTable.Fields.Version),
      previousData: v.get(MemoryPlaceVersionTable.Fields.PreviousData),
      data: v.get(MemoryPlaceVersionTable.Fields.Data),
      changedBy: v.get(MemoryPlaceVersionTable.Fields.ChangedBy),
      adminReviewedBy: v.get(MemoryPlaceVersionTable.Fields.AdminReviewedBy),
      clientReviewedBy: v.get(MemoryPlaceVersionTable.Fields.ClientReviewedBy),
      orderId: v.get(MemoryPlaceVersionTable.Fields.OrderId),
      changedAt: v.get(MemoryPlaceVersionTable.Fields.ChangedAt),
    }));
  }

  /* ========================================================================
   * Приватні хелпери
   * ======================================================================== */

  private async getMemoryPlaceSnapshot(memoryPlaceId: string): Promise<MemoryPlaceDataSnapshot> {
    const obj = await this.getMemoryPlaceObject(memoryPlaceId);
    return this.mapMemoryPlaceToSnapshot(obj);
  }

  private async getMemoryPlaceObject(memoryPlaceId: string): Promise<Parse.Object> {
    try {
      const query = new this.back4app.parse.Query(this.memoryPlaceClass);
      return await query.get(memoryPlaceId);
    } catch {
      throw new NotFoundException(`Memory Place з ID ${memoryPlaceId} не знайдено`);
    }
  }

  private mapMemoryPlaceToSnapshot(obj: Parse.Object): MemoryPlaceDataSnapshot {
    const photos = obj.get(MemoryPlaceTable.Fields.Photos);
    const photoUrls: string[] = Array.isArray(photos)
      ? photos.map((p: any) => (p && typeof p.url === 'function' ? p.url() : String(p)))
      : [];

    return {
      fullName: obj.get(MemoryPlaceTable.Fields.FullName) ?? null,
      cemetery: obj.get(MemoryPlaceTable.Fields.Cemetery) ?? null,
      sector: obj.get(MemoryPlaceTable.Fields.Sector) ?? null,
      row: obj.get(MemoryPlaceTable.Fields.Row) ?? null,
      placeNumber: obj.get(MemoryPlaceTable.Fields.PlaceNumber) ?? null,
      gpsLat: obj.get(MemoryPlaceTable.Fields.GpsLat) ?? null,
      gpsLng: obj.get(MemoryPlaceTable.Fields.GpsLng) ?? null,
      description: obj.get(MemoryPlaceTable.Fields.Description) ?? null,
      landmarks: obj.get(MemoryPlaceTable.Fields.Landmarks) ?? null,
      photos: photoUrls,
      monumentData: obj.get(MemoryPlaceTable.Fields.MonumentData) ?? null,
      notes: obj.get(MemoryPlaceTable.Fields.Notes) ?? null,
    };
  }

  private extractProposedData(dto: ProposeMemoryPlaceUpdateDto): MemoryPlaceDataSnapshot {
    const data: MemoryPlaceDataSnapshot = {};
    for (const field of MEMORY_PLACE_UPDATEABLE_FIELDS) {
      const value = (dto as any)[field];
      if (value !== undefined && value !== null) {
        data[field] = value;
      }
    }
    return data;
  }

  private mapRequestView(obj: Parse.Object): MemoryPlaceUpdateRequestView {
    return {
      id: obj.id,
      memoryPlaceId: obj.get(MemoryPlaceUpdateRequestTable.Fields.MemoryPlaceId) as string,
      orderId: obj.get(MemoryPlaceUpdateRequestTable.Fields.OrderId) as string | undefined,
      proposedBy: obj.get(MemoryPlaceUpdateRequestTable.Fields.ProposedBy) as string,
      proposedData: obj.get(MemoryPlaceUpdateRequestTable.Fields.ProposedData) as MemoryPlaceDataSnapshot,
      currentData: obj.get(MemoryPlaceUpdateRequestTable.Fields.CurrentData) as MemoryPlaceDataSnapshot,
      status: obj.get(MemoryPlaceUpdateRequestTable.Fields.Status) as MemoryPlaceUpdateStatus,
      clarificationNote: obj.get('clarificationNote') as string | undefined,
      createdAt: obj.get(MemoryPlaceUpdateRequestTable.Fields.CreatedAt)?.toISOString?.(),
      adminReviewedAt: obj.get(MemoryPlaceUpdateRequestTable.Fields.AdminReviewedAt)?.toISOString?.(),
      adminReviewedBy: obj.get(MemoryPlaceUpdateRequestTable.Fields.AdminReviewedBy) as string | undefined,
      clientReviewedAt: obj.get(MemoryPlaceUpdateRequestTable.Fields.ClientReviewedAt)?.toISOString?.(),
      clientReviewedBy: obj.get(MemoryPlaceUpdateRequestTable.Fields.ClientReviewedBy) as string | undefined,
    };
  }

  private valuesEqual(a: unknown, b: unknown): boolean {
    if (a === b) {
      return true;
    }
    if (a == null || b == null) {
      return false;
    }
    if (Array.isArray(a) && Array.isArray(b)) {
      if (a.length !== b.length) {
        return false;
      }
      return a.every((item, index) => item === b[index]);
    }
    return false;
  }
}
