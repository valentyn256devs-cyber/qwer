import {Module} from "@nestjs/common";
import {TelegramClientListener} from "./telegram-client-listener";
import {OrdersModule} from "../../orders/orders.module";
import {ServicesModule} from "../../services/services.module";
import {BurialsModule} from "../../burials/burials.module";

@Module({
  imports: [ServicesModule, OrdersModule, BurialsModule],
  providers: [TelegramClientListener],
})
export class TelegramClientModule {
  constructor() {
    console.log('[TelegramClientModule] Ініціалізація модуля клієнтського бота');
  }
}