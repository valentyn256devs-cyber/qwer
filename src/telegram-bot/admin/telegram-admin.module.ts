import {Module} from "@nestjs/common";
import {OrdersModule} from "../../orders/orders.module";
import {TelegramAdminListener} from "./telegram-admin-listener";

@Module({
  imports: [OrdersModule],
  providers: [TelegramAdminListener],
})
export class TelegramAdminModule {}