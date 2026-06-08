import { Module } from '@nestjs/common';
import { Back4appService } from './back4app/back4app.service';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { ServicesModule } from './services/services.module';
import { OrdersModule } from './orders/orders.module';
import { TelegrafModule } from 'nestjs-telegraf';
import { session } from 'telegraf';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
    }),
    TelegrafModule.forRootAsync({
      imports: [ConfigModule],
      useFactory: (configService: ConfigService) => ({
        token: configService.get<string>('TELEGRAM_BOT_TOKEN') ?? '',
        middlewares: [session()],
      }),
      inject: [ConfigService],
    }),
    ServicesModule,
    OrdersModule,
  ],
  providers: [Back4appService],
  exports: [Back4appService],
})
export class AppModule {}
