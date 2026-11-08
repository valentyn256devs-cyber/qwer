import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsEnum, IsNotEmpty, IsOptional, IsString } from 'class-validator';
import { ExecutorInabilityReason } from '../models/order-status';

export class CancelOrderDto {
  @ApiProperty({ description: 'Причина скасування', example: 'Клієнт передумав' })
  @IsString()
  @IsNotEmpty()
  reason!: string;

  @ApiPropertyOptional({ description: 'Коментар' })
  @IsOptional()
  @IsString()
  comment?: string;

  @ApiPropertyOptional({ description: 'Коментар для клієнта (тільки для адміна)' })
  @IsOptional()
  @IsString()
  commentForClient?: string;
}

export class RequestCancellationDto {
  @ApiProperty({ description: 'Причина запиту на скасування' })
  @IsString()
  @IsNotEmpty()
  reason!: string;

  @ApiPropertyOptional({ description: 'Коментар' })
  @IsOptional()
  @IsString()
  comment?: string;
}

export class ReportExecutorInabilityDto {
  @ApiProperty({ enum: ExecutorInabilityReason, description: 'Причина неможливості виконання' })
  @IsEnum(ExecutorInabilityReason)
  reason!: ExecutorInabilityReason;

  @ApiPropertyOptional({ description: 'Коментар (обовʼязковий для деяких причин)' })
  @IsOptional()
  @IsString()
  comment?: string;
}

export class ReviewCancellationRequestDto {
  @ApiProperty({ enum: ['approve', 'reject'], description: 'Рішення адміністратора' })
  @IsString()
  @IsNotEmpty()
  decision!: 'approve' | 'reject';

  @ApiPropertyOptional({ description: 'Коментар до рішення' })
  @IsOptional()
  @IsString()
  decisionComment?: string;
}
