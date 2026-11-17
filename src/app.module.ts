import { Module } from '@nestjs/common';
import { Back4appService } from './back4app/back4app.service';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { ServicesModule } from './services/services.module';
import { OrdersModule } from './orders/orders.module';
import { TelegrafModule } from 'nestjs-telegraf';
import { session } from 'telegraf';
import {TelegramClientModule} from "./telegram-bot/client/telegram-client.module";
import {TelegramExecutorModule} from "./telegram-bot/executor/telegram-executor.module";
import {TelegramBot} from "./telegram-bot/telegram-constants";
import {TelegramAdminModule} from "./telegram-bot/admin/telegram-admin.module";
import {BurialsModule} from "./burials/burials.module";
import {PerformersModule} from "./performers/performers.module";
import {BotInitializerService} from "./telegram-bot/bot-init.service";

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
    }),
    // 1. Клієнтський бот
    TelegrafModule.forRootAsync({
      imports: [ConfigModule],
      botName: TelegramBot.ClientBot,
      useFactory: (configService: ConfigService) => ({
        botName: TelegramBot.ClientBot,
        isGlobal: true,
        token: configService.get<string>('TELEGRAM_BOT_TOKEN') ?? '',
        middlewares: [session()],
        include: [TelegramClientModule],
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
        include: [TelegramAdminModule],
      }),
      inject: [ConfigService],
    }),

    // 3. Бот виконавця (окремий чат-бот)
    TelegrafModule.forRootAsync({
      imports: [ConfigModule],
      botName: TelegramBot.ExecutorBot,
      useFactory: (configService: ConfigService) => ({
        botName: TelegramBot.ExecutorBot,
        isGlobal: true,
        token: configService.get<string>('TELEGRAM_EXECUTOR_BOT_TOKEN') ?? '',
        middlewares: [session()],
        include: [TelegramExecutorModule],
      }),
      inject: [ConfigService],
    }),

    TelegramClientModule,
    TelegramExecutorModule,
    TelegramAdminModule,

    ServicesModule,
    OrdersModule,
    BurialsModule,
    PerformersModule,
  ],
  providers: [Back4appService, BotInitializerService],
  exports: [Back4appService],
})
export class AppModule {}
