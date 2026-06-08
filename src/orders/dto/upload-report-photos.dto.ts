import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsArray,
  IsEnum,
  IsNotEmpty,
  IsOptional,
  IsString,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';

class Base64FileDto {
  @ApiProperty({
    description: 'Назва файлу з розширенням',
    example: 'photo_before_1.jpg',
  })
  @IsString()
  @IsNotEmpty()
  name!: string;

  @ApiProperty({
    description: 'Вміст файлу у форматі Base64 string',
    example: 'data:image/jpeg;base64,/9j/4AAQSkZJRg...',
  })
  @IsString()
  @IsNotEmpty()
  base64!: string;
}

export class UploadReportPhotosDto {
  @ApiProperty({
    description: 'Етап звіту: стан "ДО" або "ПІСЛЯ"',
    enum: ['before', 'after'],
    example: 'before',
  })
  @IsEnum(['before', 'after'])
  @IsNotEmpty()
  type!: 'before' | 'after';

  @ApiProperty({
    description: 'Масив об’єктів із файлами у форматі Base64',
    type: [Base64FileDto],
  })
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => Base64FileDto)
  files!: Base64FileDto[];

  @ApiPropertyOptional({
    description:
      'Фінальний текстовий коментар або звіт від адміністратора/виконавця',
    example: 'Територію очищено від бур’яну, пам’ятник вимито. Фотозвіт додаю.',
  })
  @IsString()
  @IsOptional()
  adminComment?: string;
}
