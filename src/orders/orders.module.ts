import { Module, forwardRef } from '@nestjs/common';
import { OrdersService } from './orders.service';
import { OrdersController } from './orders.controller';
import { Back4appService } from '../back4app/back4app.service';
import { ServicesModule } from '../services/services.module';
import { CreateOrderScene } from '../telegram-bot/client/scenes/create-order.scene';
import { CreateBurialScene } from "../telegram-bot/client/scenes/create-burial.scene";
import { BurialsModule } from "../burials/burials.module";
import { EditBurialScene } from "../telegram-bot/client/scenes/edit-burial.scene";
import { PerformersModule } from "../performers/performers.module";
import { ImagesModule } from "../images/images.module";
import { TelegramAdminModule } from "../telegram-bot/admin/telegram-admin.module";

@Module({
  imports: [ServicesModule, BurialsModule, PerformersModule, ImagesModule, forwardRef(() => TelegramAdminModule)],
  controllers: [OrdersController],
  providers: [
    OrdersService,
    Back4appService,

    CreateOrderScene,
    CreateBurialScene,
    EditBurialScene,
  ],
  exports: [OrdersService, Back4appService],
})
export class OrdersModule {
}
