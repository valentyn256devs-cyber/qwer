import { Module } from '@nestjs/common';
import { OrdersService } from './orders.service';
import { OrdersController } from './orders.controller';
import { Back4appService } from '../back4app/back4app.service';
import { ServicesModule } from '../services/services.module';
import { CreateOrderScene } from '../telegram-bot/client/scenes/create-order.scene';

@Module({
  imports: [ServicesModule],
  controllers: [OrdersController],
  providers: [
    OrdersService,
    Back4appService,
    CreateOrderScene,
  ],
  exports: [OrdersService],
})
export class OrdersModule {}
