import { Module, forwardRef } from "@nestjs/common";
import { OrdersModule } from "../../orders/orders.module";
import { TelegramAdminListener } from "./telegram-admin-listener";
import { AdminService } from "./admin.service";

@Module({
  exports: [AdminService],
  imports: [forwardRef(() => OrdersModule)],
  providers: [TelegramAdminListener, AdminService],
})
export class TelegramAdminModule {
}