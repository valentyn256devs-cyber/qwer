import {Module} from '@nestjs/common';
import {OrdersService} from './orders.service';
import {OrdersController} from './orders.controller';
import {Back4appService} from '../back4app/back4app.service';
import {ServicesModule} from '../services/services.module';
import {CreateOrderScene} from '../telegram-bot/client/scenes/create-order.scene';
import {CreateBurialScene} from "../telegram-bot/client/scenes/create-burial.scene";
import {BurialsModule} from "../burials/burials.module";
import {EditBurialScene} from "../telegram-bot/client/scenes/edit-burial.scene";

@Module({
  imports: [ServicesModule, BurialsModule],
  controllers: [OrdersController],
  providers: [
    OrdersService,
    Back4appService,

    CreateOrderScene,
    CreateBurialScene,
    EditBurialScene,
  ],
  exports: [OrdersService],
})
export class OrdersModule {
}
