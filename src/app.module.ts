import { Module } from '@nestjs/common';
import { Back4appService } from './back4app/back4app.service';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { ServicesModule } from './services/services.module';
import { OrdersModule } from './orders/orders.module';
import { TelegrafModule } from 'nestjs-telegraf';
import { session } from 'telegraf';
import {TelegramClientModule} from "./telegram-bot/client/telegram-client.module";
import {TelegramBot} from "./telegram-bot/telegram-constants";
import {TelegramAdminModule} from "./telegram-bot/admin/telegram-admin.module";
import {BurialsModule} from "./burials/burials.module";

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
    }),
    // 1. Клієнтський бот (дефолтний, без імені)
    TelegrafModule.forRootAsync({
      imports: [ConfigModule],
      botName: TelegramBot.ClientBot,
      useFactory: (configService: ConfigService) => ({
        botName: TelegramBot.ClientBot,
        isGlobal: true,
        token: configService.get<string>('TELEGRAM_BOT_TOKEN') ?? '',
        middlewares: [session()],
        include: [TelegramClientModule]
      }),
      inject: [ConfigService],
    }),

    // 2. Адмінський бот (іменований)
    TelegrafModule.forRootAsync({
      imports: [ConfigModule],
      botName: TelegramBot.AdminBot,
      useFactory: (configService: ConfigService) => ({
        isGlobal: true,
        token: configService.get<string>('TELEGRAM_ADMIN_BOT_TOKEN') ?? '',
        include: [TelegramAdminModule]
      }),
      inject: [ConfigService],
    }),

    TelegramClientModule,
    TelegramAdminModule,

    ServicesModule,
    OrdersModule,
    BurialsModule,
  ],
  providers: [Back4appService],
  exports: [Back4appService],
})
export class AppModule {}
