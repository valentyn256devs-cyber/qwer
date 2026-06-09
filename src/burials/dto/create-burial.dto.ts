import { IsString, IsOptional, IsNotEmpty, IsDateString } from 'class-validator';

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

  @IsDateString()
  @IsOptional()
  birthDate?: string;

  @IsDateString()
  @IsOptional()
  deathDate?: string;

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
  notes?: string;

  // Для фото, які приходять з боту у форматі base64
  @IsOptional()
  photos?: { name: string; base64: string }[];
}