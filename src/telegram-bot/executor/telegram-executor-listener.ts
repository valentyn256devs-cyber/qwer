import { Update, Hears, Command, Ctx, SceneEnter, On } from 'nestjs-telegraf';
import { Markup } from 'telegraf';
import type { SceneContext } from 'telegraf/scenes';
import { OrdersService } from '../../orders/orders.service';
import { Scene } from '../telegram-constants';
import { ExecutorConst } from './executor-const';

export const ExecutorMenu = {
  OpenOrders: '📋 Відкриті замовлення',
  MyOrders: '💼 Мої замовлення',
  DoneOrders: '✅ Виконані',
  Help: '🆘 Допомога / Проблема',
} as const;

export const executorMainMenuButtons = Markup.keyboard([
  [ExecutorMenu.OpenOrders],
  [ExecutorMenu.MyOrders, ExecutorMenu.DoneOrders],
  [ExecutorMenu.Help],
]).resize().reply_markup;

@Update()
export class TelegramExecutorListener {
  constructor(private readonly ordersService: OrdersService) {}

  @Hears(ExecutorMenu.OpenOrders)
  @Command('open_orders')
  async onOpenOrders(@Ctx() ctx: SceneContext) {
    await ctx.scene.enter(Scene.OPEN_ORDERS_SCENE);
  }

  @Hears(ExecutorMenu.MyOrders)
  @Command('my_orders')
  async onMyOrders(@Ctx() ctx: SceneContext) {
    await ctx.scene.enter(Scene.MY_ORDERS_SCENE);
  }

  @Hears(ExecutorMenu.DoneOrders)
  @Command('done_orders')
  async onDoneOrders(@Ctx() ctx: SceneContext) {
    await ctx.scene.enter(Scene.DONE_ORDERS_SCENE);
  }

  @Hears(ExecutorMenu.Help)
  @Command('help')
  async onHelp(@Ctx() ctx: SceneContext) {
    await ctx.reply(ExecutorConst.HelpPrompt, {
      reply_markup: Markup.inlineKeyboard([
        [Markup.button.callback(ExecutorConst.ProblemButton, 'executor_report_problem')],
        [Markup.button.callback(ExecutorConst.CannotCompleteHelpButton, 'executor_cannot_complete')],
        [Markup.button.callback(ExecutorConst.BackToMenu, 'executor_back_to_menu')],
      ]).reply_markup,
    });
  }

  @SceneEnter()
  async onSceneEnter(@Ctx() ctx: SceneContext) {
    await ctx.reply(ExecutorConst.Welcome, {
      reply_markup: executorMainMenuButtons,
    });
  }
}
