import { Update, Hears, Command, Ctx } from 'nestjs-telegraf';
import { Context } from 'telegraf';
import { PerformerConst } from '../../performers/performer-const';

@Update()
export class TelegramPerformerListener {

  @Hears(PerformerConst.TasksMenuButton)
  @Command('performer_tasks')
  async onGetPerformerTasks(@Ctx() ctx: Context) {
    // Тут логіка фетчингу замовлень, призначених цьому виконавцю
    await ctx.reply(PerformerConst.TasksListPlaceholder);
  }

  @Hears(PerformerConst.BalanceMenuButton)
  @Command('balance')
  async onGetBalance(@Ctx() ctx: Context) {
    await ctx.reply(PerformerConst.BalancePlaceholder);
  }
}