import { IsString, IsOptional, IsEnum } from 'class-validator';
import { MemoryPlaceUpdateStatus } from '../models/memory-place-update-request-table';

/**
 * DTO для перегляду та рішення щодо запиту на оновлення Memory Place.
 * Використовується як адміном, так і клієнтом.
 */
export class ReviewMemoryPlaceUpdateDto {
  /**
   * Новий статус запиту.
   * Адмін може: AwaitingClientApproval | RejectedByAdmin | PendingClarification
   * Клієнт може: Approved | RejectedByClient | PendingClarification
   */
  @IsEnum(MemoryPlaceUpdateStatus)
  status: MemoryPlaceUpdateStatus;

  @IsOptional()
  @IsString()
  clarificationNote?: string;

  @IsOptional()
  @IsString()
  reviewedBy?: string;
}
