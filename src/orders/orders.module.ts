import { Module } from '@nestjs/common';
import { OrdersService } from './orders.service';
import { OrdersController } from './orders.controller';
import { Back4appService } from '../back4app/back4app.service';
import { TelegramOrderListener } from '../telegram-bot/listener/telegram-order-listener';
import { ServicesModule } from '../services/services.module';
import { CreateOrderScene } from '../telegram-bot/scenes/create-order.scene';

@Module({
  imports: [ServicesModule],
  controllers: [OrdersController],
  providers: [
    OrdersService,
    Back4appService,
    TelegramOrderListener,
    CreateOrderScene,
  ],
  exports: [OrdersService],
})
export class OrdersModule {}
