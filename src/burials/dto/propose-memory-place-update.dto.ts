import {
  IsString,
  IsOptional,
  IsArray,
  IsNumber,
  ValidateNested,
  IsBoolean,
} from 'class-validator';
import {Type} from 'class-transformer';

/**
 * DTO для пропозиції оновлення Memory Place (виконавцем)
 */
export class ProposeMemoryPlaceUpdateDto {
  @IsString()
  memoryPlaceId: string;

  @IsOptional()
  @IsString()
  orderId?: string;

  @IsOptional()
  @IsString()
  fullName?: string;

  @IsOptional()
  @IsString()
  cemetery?: string;

  @IsOptional()
  @IsString()
  sector?: string;

  @IsOptional()
  @IsString()
  row?: string;

  @IsOptional()
  @IsString()
  placeNumber?: string;

  @IsOptional()
  @IsString()
  gpsLat?: string;

  @IsOptional()
  @IsString()
  gpsLng?: string;

  @IsOptional()
  @IsString()
  description?: string;

  @IsOptional()
  @IsString()
  landmarks?: string;

  @IsOptional()
  @IsArray()
  @IsString({each: true})
  photos?: string[];

  @IsOptional()
  @IsString()
  monumentData?: string;

  @IsOptional()
  @IsString()
  notes?: string;
}