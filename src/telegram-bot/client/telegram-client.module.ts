import {Module} from "@nestjs/common";
import {TelegramClientListener} from "./telegram-client-listener";
import {OrdersModule} from "../../orders/orders.module";
import {ServicesModule} from "../../services/services.module";

@Module({
  imports: [ServicesModule, OrdersModule],
  providers: [TelegramClientListener],
})
export class TelegramClientModule {}