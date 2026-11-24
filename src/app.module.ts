import { Module } from '@nestjs/common';
import { Back4appService } from './back4app/back4app.service';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { ServicesModule } from './services/services.module';
import { OrdersModule } from './orders/orders.module';
import { TelegrafModule } from 'nestjs-telegraf';
import { session, Middleware } from 'telegraf';
import { TelegramClientModule } from "./telegram-bot/client/telegram-client.module";
import { TelegramExecutorModule } from "./telegram-bot/executor/telegram-executor.module";
import { TelegramBot } from "./telegram-bot/telegram-constants";
import { TelegramAdminModule } from "./telegram-bot/admin/telegram-admin.module";
import { BurialsModule } from "./burials/burials.module";
import { PerformersModule } from "./performers/performers.module";
import { BotInitializerService } from "./telegram-bot/bot-init.service";
import { sessionRecoveryMiddleware } from "./middleware/session-recovery.middleware";
import { RedisSessionStore, buildRedisUrl } from "./middleware/redis-session-store";
import { LoggerModule } from "./logger/logger.module";

/**
 * Будує масив сесійних middleware для бота.
 * Якщо REDIS_ENABLED === false — повертає undefined (сесії не запускаються).
 */
function buildSessionMiddleware(
  configService: ConfigService,
  prefix: string,
): readonly Middleware<any>[] | undefined {
  if (!(configService.get<boolean>('REDIS_ENABLED') ?? true)) {
    return undefined;
  }

  const redisUrl = buildRedisUrl(
    configService.get<string>('REDIS_HOST') ?? 'localhost',
    configService.get<string>('REDIS_PORT') ?? '6379',
    configService.get<string>('REDIS_PASSWORD') ?? undefined,
  );

  return [
    session({
      store: new RedisSessionStore(redisUrl, prefix),
    }),
    sessionRecoveryMiddleware,
  ];
}

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
    }),
    LoggerModule,
    // 1. Клієнтський бот
    TelegrafModule.forRootAsync({
      imports: [ConfigModule],
      botName: TelegramBot.ClientBot,
      useFactory: (configService: ConfigService) => ({
        botName: TelegramBot.ClientBot,
        isGlobal: true,
        token: configService.get<string>('TELEGRAM_BOT_TOKEN') ?? '',
        middlewares: buildSessionMiddleware(
          configService,
          'telegraf:client:session:',
        ),
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
        middlewares: buildSessionMiddleware(
          configService,
          'telegraf:admin:session:',
        ),
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
        middlewares: buildSessionMiddleware(
          configService,
          'telegraf:executor:session:',
        ),
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
export class AppModule {
}
