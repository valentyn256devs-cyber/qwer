import { Update, Hears, Command, Ctx } from 'nestjs-telegraf';
import { Context } from 'telegraf';

@Update()
export class TelegramPerformerListener {

  @Hears('💼 Мої завдання')
  @Command('performer_tasks')
  async onGetPerformerTasks(@Ctx() ctx: Context) {
    // Тут логіка фетчингу замовлень, призначених цьому виконавцю
    await ctx.reply('📋 Список ваших активних завдань на об’єктах...');
  }

  @Hears('💰 Баланс')
  @Command('balance')
  async onGetBalance(@Ctx() ctx: Context) {
    await ctx.reply('💳 Ваш поточний баланс для виплат: 0.00 грн');
  }
}