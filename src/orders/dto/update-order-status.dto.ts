import { ApiProperty } from '@nestjs/swagger';
import { IsEnum, IsNotEmpty } from 'class-validator';
import { OrderStatus } from '../models/order-status';

export class UpdateOrderStatusDto {
  @ApiProperty({
    description: 'Новий статус замовлення',
    enum: OrderStatus,
    example: OrderStatus.InProgress,
  })
  @IsEnum(OrderStatus)
  @IsNotEmpty()
  status!: OrderStatus;
}
