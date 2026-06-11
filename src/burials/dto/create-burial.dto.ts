import {IsString, IsOptional, IsNotEmpty, IsArray, ValidateNested} from 'class-validator';
import {Type} from "class-transformer";

export class CreateBurialDto {
  @IsString()
  @IsNotEmpty()
  name: string;

  @IsString()
  @IsOptional()
  burialName?: string;

  @IsString()
  @IsOptional()
  burialLastName?: string;

  @IsString()
  @IsOptional()
  burialFatherName?: string;

  @IsString()
  @IsOptional()
  birthDate?: string | null;

  @IsString()
  @IsOptional()
  deathDate?: string | null;

  @IsString()
  @IsNotEmpty()
  cemetery?: string;

  @IsString()
  @IsOptional()
  coordinates?: string;

  @IsString()
  @IsOptional()
  telegramId?: string;

  @IsString()
  @IsOptional()
  nickName?: string;

  @IsString()
  @IsOptional()
  notes?: string;

  // Для фото, які приходять з боту у форматі base64
/*  @IsArray()
  @IsOptional()
  photos?: string[];*/

  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true }) // 🔥 Кажемо валідувати кожен елемент масиву
  @Type(() => BurialPhotoDto)     // 🔥 Вказуємо тип для трансформації
  photos?: BurialPhotoDto[];
}

export class BurialPhotoDto {
  @IsString()
  @IsNotEmpty()
  name: string;

  @IsString()
  @IsNotEmpty()
  base64: string;
}