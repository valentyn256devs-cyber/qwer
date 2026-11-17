import { Ctx, Wizard, WizardStep } from 'nestjs-telegraf';
import { Markup } from 'telegraf';
import { OrdersService } from '../../../orders/orders.service';
import { Scene as SceneConst } from '../../telegram-constants';
import { ExecutorConst } from '../model/executor-const';
import type { ExecutorWizardContext } from '../interfaces/executor-wizard-context.interface';

@Wizard(SceneConst.REVISION_SCENE)
export class RevisionScene {
  constructor(private readonly ordersService: OrdersService) {}

  @WizardStep(1)
  async stepShowRevision(@Ctx() ctx: ExecutorWizardContext) {
    const orderId = ctx.session?.orderId ?? ctx.wizard?.state?.orderId;
    if (!orderId) {
      await ctx.reply(ExecutorConst.OrderNotFound);
      return ctx.scene.leave();
    }

    const executorId = ctx.from?.id.toString() ?? '';
    const order = (await this.ordersService.findByExecutorId(executorId)).find((o: any) => o.id === orderId);
    if (!order) {
      await ctx.reply(ExecutorConst.OrderNotFoundSimple);
      return ctx.scene.leave();
    }

    const adminComment = order.report?.adminComment ?? 'Немає коментаря';

    await ctx.reply(
      `🔄 <b>Замовлення №${orderId} потребує ревізії</b>\n\n` +
      `💬 <b>Коментар адміністратора:</b> ${adminComment}\n\n` +
      `Продовжіть роботу над замовленням:`,
      {
        parse_mode: 'HTML',
        reply_markup: Markup.inlineKeyboard([
          [Markup.button.callback(ExecutorConst.ContinueWorkButton, 'executor_continue_revision')],
          [Markup.button.callback(ExecutorConst.BackToMenu, 'executor_back_to_menu')],
        ]).reply_markup,
      },
    );
  }

  @WizardStep(2)
  async stepHandleAction(@Ctx() ctx: ExecutorWizardContext) {
    if (!ctx.has('callback_query') || !('data' in ctx.callbackQuery)) return;

    const callbackData = ctx.callbackQuery.data;
    await ctx.telegram.answerCbQuery(ctx.callbackQuery.id).catch(() => null);
    await ctx.deleteMessage().catch(() => null);

    if (callbackData === 'executor_continue_revision') {
      await ctx.reply(ExecutorConst.ContinueWorkMessage, { parse_mode: 'HTML' });
      return ctx.scene.leave();
    }

    if (callbackData === 'executor_back_to_menu') {
      await ctx.reply(ExecutorConst.BackToMenuMessage, { parse_mode: 'HTML' });
      return ctx.scene.leave();
    }
  }
}
