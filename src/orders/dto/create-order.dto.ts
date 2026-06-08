import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsEmail,
  IsIn,
  IsNotEmpty,
  IsOptional,
  IsString,
} from 'class-validator';

export class CreateOrderDto {
  @ApiProperty({
    description: "Ім'я клієнта",
    example: 'John',
  })
  @IsString()
  @IsNotEmpty()
  clientName!: string;

  @ApiProperty({
    description: 'Номер телефону клієнта',
    example: '+380971234567',
  })
  @IsString()
  @IsNotEmpty()
  clientPhone!: string;

  @ApiPropertyOptional({
    description: 'Електронна пошта клієнта (необов’язково)',
    example: 'valentin@example.com',
  })
  @IsEmail()
  @IsOptional()
  clientEmail?: string;

  @ApiProperty({
    description: 'Telegram ID користувача для зворотного зв’язку',
    example: '123456789',
  })
  @IsString()
  @IsNotEmpty()
  telegramId!: string;

  @ApiProperty({
    description: 'ID послуги з таблиці Service (Back4app objectId)',
    example: 'bpTq2hGMrI',
  })
  @IsString()
  @IsNotEmpty()
  serviceId!: string;

  @ApiPropertyOptional({
    description: 'Додаткові побажання або кастомний коментар до замовлення',
    example: 'Прибрати бур’ян біля пам’ятника та висадити квіти',
  })
  @IsString()
  @IsOptional()
  customComment?: string;

  @ApiProperty({
    description: 'Спосіб вказання локації місця поховання',
    enum: ['coordinates', 'address_text', 'google_maps'],
    example: 'address_text',
  })
  @IsIn(['coordinates', 'address_text', 'google_maps'])
  @IsNotEmpty()
  locationType!: 'coordinates' | 'address_text' | 'google_maps';

  @ApiProperty({
    description:
      'Дані локації відповідно до типу (координати, лінк на карти або текст)',
    example: 'Кропивницький, Далекосхідне кладовище',
  })
  @IsString()
  @IsNotEmpty()
  locationData!: string;

  @ApiPropertyOptional({
    description:
      'Детальна інформація про місце (сектор, ряд, номер могили тощо)',
    example: 'Сектор 4, ряд 12, місце 5',
  })
  @IsString()
  @IsOptional()
  cemeteryDetails?: string;
}
