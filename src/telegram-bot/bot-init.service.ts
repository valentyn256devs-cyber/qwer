import { Injectable, OnModuleInit } from '@nestjs/common';
import { InjectBot } from 'nestjs-telegraf';
import { Telegraf, Context } from 'telegraf';
import { TelegramBot } from './telegram-constants';

@Injectable()
export class BotInitializerService implements OnModuleInit {
  constructor(
    @InjectBot(TelegramBot.ClientBot)
    private readonly clientBot: Telegraf<Context>,
    @InjectBot(TelegramBot.AdminBot)
    private readonly adminBot: Telegraf<Context>,
  ) {}

  async onModuleInit() {
    try {
      // Встановлюємо команди для клієнтського бота
      await this.clientBot.telegram.setMyCommands([
        { command: 'start', description: '🚀 Розпочати оформлення заявки' },
        { command: 'cancel', description: '❌ Скасувати поточну дію' },
      ]);
      console.log('✅ Команди клієнтського бота успішно оновлено!');

      // Встановлюємо команди для адмінського бота
      await this.adminBot.telegram.setMyCommands([
        { command: 'start', description: '🛡️ Панель адміністратора' },
        { command: 'cancel', description: '❌ Скасувати поточну дію' },
      ]);
      console.log('✅ Команди адмінського бота успішно оновлено!');
    } catch (error) {
      console.error('❌ Помилка встановлення команд:', error);
    }
  }
}