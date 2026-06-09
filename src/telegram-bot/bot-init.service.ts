import { Injectable, OnModuleInit } from '@nestjs/common';
import { InjectBot } from 'nestjs-telegraf';
import { Telegraf, Context } from 'telegraf';
import { TelegramBot } from './telegram-constants';

@Injectable()
export class BotInitializerService implements OnModuleInit {
  constructor(
    @InjectBot(TelegramBot.AdminBot)
    private readonly bot: Telegraf<Context>,
  ) {}

  async onModuleInit() {
    try {
      // Встановлюємо глобальні команди для бота
      await this.bot.telegram.setMyCommands([
        { command: 'start', description: '🚀 Розпочати оформлення заявки' },
        { command: 'cancel', description: '❌ Скасувати поточну дію' },
      ]);
      console.log('✅ Команди меню бота успішно оновлено!');
    } catch (error) {
      console.error('❌ Помилка встановлення команд:', error);
    }
  }
}