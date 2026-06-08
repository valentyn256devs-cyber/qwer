import { ApiProperty } from '@nestjs/swagger';
import { IsNotEmpty, IsNumber, IsString, Min } from 'class-validator';

export class CreateServiceDto {
  @ApiProperty({
    description: 'Назва послуги',
    example: 'Фотоогляд місця поховання',
  })
  @IsString()
  @IsNotEmpty()
  name!: string;

  @ApiProperty({
    description: 'Детальний опис того, що входить у послугу',
    example:
      'Фото та відео місця поховання, оцінка стану пам’ятника та території.',
  })
  @IsString()
  @IsNotEmpty()
  description!: string;

  @ApiProperty({
    description: 'Базова вартість послуги в гривнях',
    example: 500,
  })
  @IsNumber()
  @Min(0)
  price!: number;
}
