import { Ctx, Wizard, WizardStep } from 'nestjs-telegraf';
import { OrdersService } from '../../../orders/orders.service';
import { Scene as SceneConst } from '../../telegram-constants';
import { ExecutorConst } from '../executor-const';
import type { ExecutorWizardContext } from '../interfaces/executor-wizard-context.interface';

@Wizard(SceneConst.ACCEPT_ORDER_SCENE)
export class AcceptOrderScene {
  constructor(private readonly ordersService: OrdersService) {}

  @WizardStep(1)
  async stepAccept(@Ctx() ctx: ExecutorWizardContext) {
    const orderId = ctx.session?.orderId ?? ctx.wizard?.state?.orderId;
    if (!orderId) {
      await ctx.reply(ExecutorConst.OrderNotFound);
      return ctx.scene.leave();
    }

    const executorId = ctx.from?.id.toString() ?? '';

    await ctx.reply(ExecutorConst.AcceptLoading);

    try {
      const order = await this.ordersService.assignExecutor(orderId, executorId, 'executor_bot');
      await ctx.reply(
        ExecutorConst.AcceptSuccess(order.id, order.service?.name ?? '—'),
        { parse_mode: 'HTML' },
      );
    } catch (error: any) {
      const message = (error as Error).message ?? '';
      if (message.includes('вже прийняте') || message.includes('уже взято')) {
        await ctx.reply(
          ExecutorConst.AcceptConflict,
          { parse_mode: 'HTML' },
        );
      } else {
        await ctx.reply(ExecutorConst.AcceptError);
      }
    }
    await ctx.scene.leave();
  }
}
