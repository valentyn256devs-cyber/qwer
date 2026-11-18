import { BadRequestException, ForbiddenException, Injectable, NotFoundException, } from '@nestjs/common';
import { Back4appService } from '../back4app/back4app.service';
import * as Parse from 'parse/node';
import { OrderTable } from './models/order-table';
import { OrderRevisionTable } from './models/order-revision-table';
import { OrderAssignmentHistoryTable } from './models/order-assignment-history-table';
import { OrderStatusHistoryTable } from './models/order-status-history-table';
import { CancellationRequestStatus, CancellationRequestTable, } from './models/cancellation-request-table';
import { ClarificationRequestTable, ClarificationStatus, } from './models/clarification-request-table';
import {
  ExecutorInabilityReason,
  ExecutorInabilityReasonsRequiringComment,
  OrderStatus,
  UnassignReason,
} from './models/order-status';
import { CreateOrderDto } from './dto/create-order.dto';
import { InjectBot } from 'nestjs-telegraf';
import { mainMenuButtons, TelegramBot } from '../telegram-bot/telegram-constants';
import { ExecutorConst } from '../telegram-bot/executor/model/executor-const';
import { Context, Telegraf } from 'telegraf';
import { PerformersService } from '../performers/performers.service';
import { BurialsService } from '../burials/burials.service';

@Injectable()
export class OrdersService {
  private readonly orderClassName = OrderTable.TableName;
  private readonly serviceClassName = 'Service';
  private readonly assignmentHistoryClassName = OrderAssignmentHistoryTable.TableName;
  private readonly cancellationRequestClassName = CancellationRequestTable.TableName;
  private readonly statusHistoryClassName = OrderStatusHistoryTable.TableName;

  /** Req 40: deadline notification intervals (hours) — configurable */
  private readonly deadlineNotificationConfig = {
    executorAfterAssignment: true,
    executor24h: 24,
    executor3h: 3,
    notifyOnOverdue: true,
  };

  /**
   * In-memory tracking of order-notification messages sent to performers.
   * Key: orderId → list of { telegramId, messageId } so we can delete
   * the notification from each performer's chat once the order is taken.
   */
  private readonly orderNotifications = new Map<
    string,
    Array<{ telegramId: string; messageId: number }>
  >();
  /** Statuses where client can directly cancel (req 42) */
  private readonly clientDirectCancelStatuses = new Set<OrderStatus>([
    OrderStatus.New,
    OrderStatus.AwaitingAdminReview,
    OrderStatus.Confirmed,
    OrderStatus.AvailableForExecutor,
  ]);
  /** Statuses where client must request cancellation (req 42) */
  private readonly clientRequestCancelStatuses = new Set<OrderStatus>([
    OrderStatus.Assigned,
    OrderStatus.AwaitingClientConfirmation,
    OrderStatus.InProgress,
    OrderStatus.RevisionRequired,
  ]);

  constructor(
    private back4app: Back4appService,
    @InjectBot(TelegramBot.ClientBot)
    private readonly clientBot: Telegraf<Context>,
    @InjectBot(TelegramBot.AdminBot)
    private readonly adminBot: Telegraf<Context>,
    @InjectBot(TelegramBot.ExecutorBot)
    private readonly executorBot: Telegraf<Context>,
    private readonly performersService: PerformersService,
    private readonly burialsService: BurialsService,
  ) {
  }

  /**
   * Отримує Order за ID через find (бо action «get» заборонений CLP на Back4app).
   * Кидає NotFoundException, якщо замовлення не існує.
   */
  private async getOrderObject(id: string): Promise<Parse.Object> {
    const query = new this.back4app.parse.Query(this.orderClassName);
    query.equalTo('objectId', id);
    query.include('service');
    const results = await query.find();
    if (!results || results.length === 0) {
      throw new NotFoundException(`Заявку з ID ${id} не знайдено`);
    }
    return results[0];
  }

  async create(createOrderDto: CreateOrderDto) {
    const {
      clientName,
      clientPhone,
      clientEmail,
      telegramId,
      serviceId,
      burialId,
      customComment,
      serviceDateFrom,
      serviceDateTo,
      executionDeadline,
    } = createOrderDto as CreateOrderDto & {
      serviceDateFrom?: string;
      serviceDateTo?: string;
      executionDeadline?: string;
    };

    const servicePointer = Parse.Object.fromJSON({
      className: this.serviceClassName,
      objectId: serviceId,
    });

    const order = new Parse.Object(this.orderClassName);
    order.set(OrderTable.Fields.ClientName, clientName);
    order.set(OrderTable.Fields.ClientPhone, clientPhone);
    order.set(OrderTable.Fields.ClientEmail, clientEmail ?? null);
    order.set(OrderTable.Fields.TelegramId, telegramId);
    order.set(OrderTable.Fields.Status, OrderStatus.New);
    order.set(OrderTable.Fields.Service, servicePointer);
    order.set(OrderTable.Fields.BurialId, burialId ?? '');

    // Req 37: execution deadlines
    if (serviceDateFrom) order.set(OrderTable.Fields.ServiceDateFrom, new Date(serviceDateFrom));
    if (serviceDateTo) order.set(OrderTable.Fields.ServiceDateTo, new Date(serviceDateTo));
    if (executionDeadline) order.set(OrderTable.Fields.ExecutionDeadline, new Date(executionDeadline));

    order.set(OrderTable.Fields.ClientPhotos, []);
    order.set(OrderTable.Fields.ReportPhotosBefore, []);
    order.set(OrderTable.Fields.ReportPhotosAfter, []);
    order.set(OrderTable.Fields.AdminComment, '');
    // Побажання/коментар клієнта — потрібні виконавцю для виконання
    order.set(OrderTable.Fields.ClientComment, customComment ?? '');
    order.set(OrderTable.Fields.AdditionalServices, []);

    const savedOrder = await order.save();
    await this.recordStatusHistory({
      orderId: savedOrder.id!,
      fromStatus: 'none',
      toStatus: OrderStatus.New,
      changedBy: `client:${telegramId}`,
      reason: 'order_created',
    });

    return this.mapOrderFields(savedOrder);
  }

  async findAll() {
    const query = new this.back4app.parse.Query(this.orderClassName);
    query.include('service');
    query.descending('createdAt');

    const results = await query.find();
    return results.map((order) => {
      const service = order.get(OrderTable.Fields.Service) as
        | Parse.Object
        | undefined;
      return {
        id: order.id,
        clientName: order.get(OrderTable.Fields.ClientName) as string,
        clientEmail: order.get(OrderTable.Fields.ClientEmail) as string | null,
        status: order.get(OrderTable.Fields.Status) as OrderStatus,
        createdAt: order.createdAt,
        service: service
          ? {
            id: service.id,
            name: service.get('name') as string,
            price: service.get('price') as number,
          }
          : null,
      };
    });
  }

  async findByTelegramId(telegramId: string) {
    const query = new this.back4app.parse.Query(this.orderClassName);
    query.equalTo(OrderTable.Fields.TelegramId, telegramId);
    query.include('service');
    query.descending('createdAt');

    const results = await query.find();
    return results.map((order) => this.mapOrderFields(order));
  }

  async updateStatus(
    id: string,
    status: OrderStatus,
    meta?: { changedBy?: string; reason?: string; comment?: string },
  ) {
    const query = new this.back4app.parse.Query(this.orderClassName);
    query.include('service');
    try {
      const order = await this.getOrderObject(id);
      const fromStatus = order.get(OrderTable.Fields.Status) as OrderStatus;
      order.set(OrderTable.Fields.Status, status);
      const updatedOrder = await order.save();
      await this.recordStatusHistory({
        orderId: id,
        fromStatus,
        toStatus: status,
        changedBy: meta?.changedBy ?? 'system',
        reason: meta?.reason,
        comment: meta?.comment,
      });
      return this.mapOrderFields(updatedOrder);
    } catch (error) {
      console.log(error);
      throw new NotFoundException(`Заявку з ID ${id} не знайдено`);
    }
  }

  async uploadReportPhotos(
    id: string,
    type: 'before' | 'after',
    base64Files: { name: string; base64: string }[],
    adminComment?: string,
  ) {
    // const query = new this.back4app.parse.Query(this.orderClassName);
    const query = new Parse.Query(this.orderClassName);

    try {
      const order = await this.getOrderObject(id);
      const parseFiles: Parse.File[] = [];

      // Завантажуємо кожен файл у хмару Back4app
      for (const fileData of base64Files) {
        const parseFile = new this.back4app.parse.File(fileData.name, {
          base64: fileData.base64,
        });
        const savedFile = await parseFile.save();
        parseFiles.push(savedFile);
      }

      if (type === 'before') {
        // Додаємо нові фото до існуючих (якщо завантажують порціями)
        /*const currentPhotos =
          order.get(OrderTable.Fields.ReportPhotosBefore) || [];
        order.set(OrderTable.Fields.ReportPhotosBefore, [
          ...currentPhotos,
          ...parseFiles,
        ]);*/
        const currentPhotos =
          (order.get(OrderTable.Fields.ReportPhotosBefore) as
            | Parse.File[]
            | undefined) ?? [];
        order.set(OrderTable.Fields.ReportPhotosBefore, [
          ...currentPhotos,
          ...parseFiles,
        ]);
        order.set(OrderTable.Fields.Status, OrderStatus.InProgress);
      } else {
        /*const currentPhotos =
          order.get(OrderTable.Fields.ReportPhotosAfter) ?? [];
        order.set(OrderTable.Fields.ReportPhotosAfter, [
          ...currentPhotos,
          ...parseFiles,
        ]);*/
        const currentPhotos =
          (order.get(OrderTable.Fields.ReportPhotosAfter) as
            | Parse.File[]
            | undefined) ?? [];
        order.set(OrderTable.Fields.ReportPhotosAfter, [
          ...currentPhotos,
          ...parseFiles,
        ]);
        order.set(OrderTable.Fields.Status, OrderStatus.AwaitingClientConfirmation); // Очікує підтвердження від клієнта
      }

      if (adminComment) {
        order.set(OrderTable.Fields.AdminComment, adminComment);
      }

      const updatedOrder = await order.save();
      return this.mapOrderFields(updatedOrder);
    } catch (error) {
      throw new BadRequestException(
        `Помилка під час завантаження фотозвіту: ${(error as Error).message}`,
      );
    }
  }

  /**
   * Додає ОДИН шлях до локального зображення у масив фото звіту.
   *
   * Використовується виконавцем (Telegram-бот): фото спершу зберігається
   * на диск через ImageStorageService, а в БД (Back4app) потрапляє лише шлях.
   *
   * @param id       Order objectId
   * @param type     'before' | 'after'
   * @param filePath відносний шлях (напр. `orders/<id>/before/169...-ab.jpg`)
   */
  async addReportPhotoPath(
    id: string,
    type: 'before' | 'after',
    filePath: string,
  ): Promise<void> {
    const order = await this.getOrderObject(id);

    if (type === 'before') {
      const current =
        (order.get(OrderTable.Fields.ReportPhotosBefore) as
          | string[]
          | undefined) ?? [];
      order.set(OrderTable.Fields.ReportPhotosBefore, [...current, filePath]);
      order.set(OrderTable.Fields.Status, OrderStatus.InProgress);
    } else {
      const current =
        (order.get(OrderTable.Fields.ReportPhotosAfter) as
          | string[]
          | undefined) ?? [];
      order.set(OrderTable.Fields.ReportPhotosAfter, [...current, filePath]);
      order.set(
        OrderTable.Fields.Status,
        OrderStatus.AwaitingClientConfirmation,
      );
    }

    await order.save();
  }

  /**
   * Додає ОДИН шлях до локального зображення у фото кроку чек-листа.
   *
   * Використовується виконавцем (Telegram-бот): фото спершу зберігається
   * на диск через ImageStorageService, а в БД (Back4app) потрапляє лише шлях.
   *
   * @param id       Order objectId
   * @param stepId   id кроку чек-листа
   * @param filePath відносний шлях (напр. `orders/<id>/checklist/<stepId>/169...-ab.jpg`)
   * @returns оновлена кількість фото для цього кроку
   */
  async addChecklistPhoto(
    id: string,
    stepId: string,
    filePath: string,
  ): Promise<number> {
    const order = await this.getOrderObject(id);

    const current =
      (order.get(OrderTable.Fields.ChecklistPhotos) as
        | Record<string, string[]>
        | undefined) ?? {};
    const stepPhotos = current[stepId] ?? [];
    const updated = { ...current, [stepId]: [...stepPhotos, filePath] };

    order.set(OrderTable.Fields.ChecklistPhotos, updated);
    await order.save();

    return updated[stepId].length;
  }

  /**
   * ✅ Метод ПІДТВЕРДЖЕННЯ заявки адміном + сповіщення клієнта
   */
  async confirmAndNotify(orderId: string, clientId: string) {
    const updatedOrder = await this.updateStatus(orderId, OrderStatus.Confirmed);

    await this.clientBot.telegram.sendMessage(
      clientId,
      `🟢 <b>Вашу заявку №${orderId} успішно підтверджено адміністратором!</b>\n\n` +
      `Ми вже взялися за виконання роботи. Очікуйте на фотозвіт.`,
      { parse_mode: 'HTML', reply_markup: mainMenuButtons }
    );

    // Сповіщаємо всіх активних виконавців про нове підтверджене замовлення
    await this.notifyPerformersAboutOrder(orderId, updatedOrder);

    return updatedOrder;
  }

  // ==================== Хелпери для форматування сповіщень ====================

  /**
   * Оновлює сповіщення про замовлення в чатах інших виконавців на «вже підтверджено»
   * (прибирає кнопки), окрім того, хто підтвердив. Якщо редагування неможливе — видаляє.
   * Викликається одразу після assignExecutor.
   */
  async notifyPerformersOrderTaken(orderId: string, takenByExecutorId: string) {
    const notifications = this.orderNotifications.get(orderId);
    if (!notifications || notifications.length === 0) return;

    for (const { telegramId, messageId } of notifications) {
      // Не чіпаємо того, хто підтвердив замовлення
      if (telegramId === takenByExecutorId) continue;
      try {
        await this.executorBot.telegram.editMessageText(
          telegramId,
          messageId,
          undefined,
          ExecutorConst.NewOrderTakenByOther(orderId),
          { parse_mode: 'HTML' },
        );
      } catch {
        // Якщо редагування не вдалося — видаляємо повідомлення
        try {
          await this.executorBot.telegram.deleteMessage(telegramId, messageId);
        } catch {
          // ignore — повідомлення вже видалено або бот не має прав
        }
      }
    }

    this.orderNotifications.delete(orderId);
  }

  /**
   * Надсилає замовнику (клієнту) коротке текстове повідомлення,
   * що його замовлення прийнято виконавцем. Без додаткових даних.
   */
  private async notifyClientOrderTaken(
    clientTelegramId: string,
    orderId: string,
  ): Promise<void> {
    try {
      await this.clientBot.telegram.sendMessage(
        clientTelegramId,
        ExecutorConst.ClientOrderTaken(orderId),
      );
    } catch (error) {
      console.error(
        `Не вдалося надіслати сповіщення замовнику ${clientTelegramId}:`,
        error,
      );
    }
  }

  /**
   * Сповіщає адміністратора, що виконавець підтвердив замовлення.
   * Надсилає ФІО, телефон виконавця та номер замовлення.
   */
  async notifyAdminAboutExecutorConfirm(orderId: string, executorTelegramId: string) {
    const adminChatId = process.env.TELEGRAM_ADMIN_CHAT_ID || '';
    if (!adminChatId) return;

    let performer: any;
    try {
      performer = await this.performersService.findByTelegramId(executorTelegramId);
    } catch {
      performer = null;
    }

    const fullName =
      performer?.firstName || performer?.lastName
        ? `${performer?.lastName ?? ''} ${performer?.firstName ?? ''}`.trim()
        : '';
    const phone = performer?.phoneNumber ?? '';

    const text =
      `✅ <b>Виконавець підтвердив замовлення №${orderId}</b>\n\n` +
      `👤 <b>Виконавець:</b> ${this.escapeHtml(fullName) || '—'}\n` +
      `📞 <b>Телефон:</b> ${this.escapeHtml(phone) || '—'}`;

    try {
      await this.adminBot.telegram.sendMessage(adminChatId, text, { parse_mode: 'HTML' });
    } catch (error) {
      console.error('Не вдалося надіслати повідомлення адміністратору:', error);
    }
  }

  /**
   * ❌ Метод ВІДХИЛЕННЯ заявки адміном + сповіщення клієнта
   */
  async rejectAndNotify(orderId: string, clientId: string) {
    const updatedOrder = await this.updateStatus(orderId, OrderStatus.Rejected);

    await this.clientBot.telegram.sendMessage(
      clientId,
      `🔴 <b>На жаль, вашу заявку №${orderId} було відхилено.</b>\n\n` +
      `Для уточнення деталей або якщо виникла помилка, будь ласка, зв'яжіться з нашою підтримкою або натисніть /help.`,
      { parse_mode: 'HTML', reply_markup: mainMenuButtons }
    );

    return updatedOrder;
  }

  /**
   * 🔍 Метод запиту на УТОЧНЕННЯ даних + сповіщення клієнта
   */
  async clarifyAndNotify(orderId: string, clientId: string) {
    const updatedOrder = await this.updateStatus(orderId, OrderStatus.PendingClarification);

    await this.clientBot.telegram.sendMessage(
      clientId,
      `🟡 <b>Адміністратор просить уточнити дані щодо заявки №${orderId}.</b>\n\n` +
      `Найближчим часом менеджер зв'яжеться з вами за вказаним номером телефону або безпосередньо в Telegram для узгодження деталей.`,
      { parse_mode: 'HTML' }
    );

    return updatedOrder;
  }

  async findAvailable() {
    const query = new this.back4app.parse.Query(this.orderClassName);
    query.equalTo(OrderTable.Fields.Status, OrderStatus.AvailableForExecutor);
    query.include('service');
    // Req 38: sort by nearest deadline (nulls last)
    query.ascending(OrderTable.Fields.ExecutionDeadline);
    query.addAscending('createdAt');

    const results = await query.find();
    return results.map((order) => this.mapOrderFields(order));
  }

  async findByExecutorId(executorId: string) {
    const query = new this.back4app.parse.Query(this.orderClassName);
    query.equalTo(OrderTable.Fields.AssignedExecutorId, executorId);
    query.include('service');
    query.descending('createdAt');

    const results = await query.find();
    return results.map((order) => this.mapOrderFields(order));
  }

  async startExecution(orderId: string, executorId: string) {
    const query = new Parse.Query(this.orderClassName);
    try {
      const order = await this.getOrderObject(orderId);
      const currentStatus = order.get(OrderTable.Fields.Status) as OrderStatus;
      const currentExecutor = order.get(OrderTable.Fields.AssignedExecutorId) as string | null;
      if (currentStatus !== OrderStatus.Assigned || currentExecutor !== executorId) {
        throw new BadRequestException('Замовлення не доступне для запуску');
      }
      order.set(OrderTable.Fields.Status, OrderStatus.InProgress);
      order.set(OrderTable.Fields.StartedAt, new Date());
      const updated = await order.save();
      return this.mapOrderFields(updated);
    } catch (error) {
      throw new BadRequestException(`Помилка запуску виконання: ${(error as Error).message}`);
    }
  }

  async submitForReview(orderId: string, executorId: string, comment?: string) {
    const query = new Parse.Query(this.orderClassName);
    try {
      const order = await this.getOrderObject(orderId);
      const currentStatus = order.get(OrderTable.Fields.Status) as OrderStatus;
      const currentExecutor = order.get(OrderTable.Fields.AssignedExecutorId) as string | null;
      if (currentStatus !== OrderStatus.InProgress || currentExecutor !== executorId) {
        throw new BadRequestException('Замовлення не можна здати на перевірку');
      }
      if (comment) {
        order.set(OrderTable.Fields.ExecutorComment, comment);
      }
      order.set(OrderTable.Fields.Status, OrderStatus.AwaitingCompletionReview);
      order.set(OrderTable.Fields.SubmittedAt, new Date());
      const updated = await order.save();
      return this.mapOrderFields(updated);
    } catch (error) {
      throw new BadRequestException(`Помилка здачі на перевірку: ${(error as Error).message}`);
    }
  }

  async assignExecutor(orderId: string, executorId: string, assignedBy: string) {
    // const query = new Parse.Query(this.orderClassName);
    try {
      const order = await this.getOrderObject(orderId);
      const currentStatus = order.get(OrderTable.Fields.Status) as OrderStatus;
      const currentExecutor = order.get(OrderTable.Fields.AssignedExecutorId) as string | null;
      // Дозволяємо взяти замовлення як з «Доступно для виконавця»,
      // так і щойно підтверджене адміном («Підтверджено») — через кнопку «Підтвердити».
      const canAssign =
        currentStatus === OrderStatus.AvailableForExecutor ||
        currentStatus === OrderStatus.Confirmed;
      if (!canAssign || currentExecutor) {
        throw new BadRequestException('Замовлення вже прийняте іншим виконавцем');
      }
      order.set(OrderTable.Fields.AssignedExecutorId, executorId);
      order.set(OrderTable.Fields.AssignedBy, assignedBy);
      order.set(OrderTable.Fields.AssignedAt, new Date());
      order.set(OrderTable.Fields.Status, OrderStatus.Assigned);
      const updated = await order.save();
      await this.recordAssignmentHistory({ orderId, executorId, assignedBy });

      // Видаляємо сповіщення про це замовлення з чатів інших виконавців
      await this.notifyPerformersOrderTaken(orderId, executorId);

      // Сповіщаємо замовника (клієнта), що його замовлення прийнято виконавцем
      const clientTelegramId = order.get(OrderTable.Fields.TelegramId) as
        | string
        | null
        | undefined;
      if (clientTelegramId) {
        await this.notifyClientOrderTaken(clientTelegramId, orderId);
      }

      return this.mapOrderFields(updated);
    } catch (error) {
      throw new BadRequestException(`Помилка призначення: ${(error as Error).message}`);
    }
  }

  /**
   * ➖ Unassign Executor
   * Причина обов'язкова. Після Unassign: assignedExecutorId = null, status = AvailableForExecutor.
   */
  async unassignExecutor(orderId: string, adminId: string, reason: UnassignReason, comment?: string) {
    const query = new Parse.Query(this.orderClassName);
    try {
      const order = await this.getOrderObject(orderId);
      const currentExecutor = order.get(OrderTable.Fields.AssignedExecutorId) as string | null;
      if (!currentExecutor) {
        throw new BadRequestException('На замовленні немає призначеного виконавця');
      }
      await this.closeLatestAssignmentHistory({
        orderId,
        executorId: currentExecutor,
        unassignedBy: adminId,
        reason,
        comment,
      });
      order.set(OrderTable.Fields.AssignedExecutorId, null);
      order.set(OrderTable.Fields.UnassignedBy, adminId);
      order.set(OrderTable.Fields.UnassignedAt, new Date());
      order.set(OrderTable.Fields.UnassignReason, reason);
      order.set(OrderTable.Fields.Status, OrderStatus.AvailableForExecutor);
      const updated = await order.save();
      return this.mapOrderFields(updated);
    } catch (error) {
      if (error instanceof BadRequestException) throw error;
      throw new BadRequestException(`Помилка скасування призначення: ${(error as Error).message}`);
    }
  }

  /**
   * 🔄 Change Executor
   * Адмін може вибрати іншого виконавця. Прогрес не втрачається.
   */
  async changeExecutor(orderId: string, newExecutorId: string, adminId: string, reason?: string) {
    const query = new Parse.Query(this.orderClassName);
    try {
      const order = await this.getOrderObject(orderId);
      const currentExecutor = order.get(OrderTable.Fields.AssignedExecutorId) as string | null;
      if (!currentExecutor) {
        throw new BadRequestException('На замовленні немає призначеного виконавця для заміни');
      }
      if (currentExecutor === newExecutorId) {
        throw new BadRequestException('Новий виконавець співпадає з поточним');
      }
      await this.closeLatestAssignmentHistory({
        orderId,
        executorId: currentExecutor,
        unassignedBy: adminId,
        reason: reason ?? UnassignReason.AdminDecision,
      });
      order.set(OrderTable.Fields.AssignedExecutorId, newExecutorId);
      order.set(OrderTable.Fields.AssignedBy, adminId);
      order.set(OrderTable.Fields.AssignedAt, new Date());
      const updated = await order.save();
      await this.recordAssignmentHistory({
        orderId,
        executorId: newExecutorId,
        assignedBy: adminId,
        reason: 'change_executor'
      });
      return this.mapOrderFields(updated);
    } catch (error) {
      if (error instanceof BadRequestException) throw error;
      throw new BadRequestException(`Помилка зміни виконавця: ${(error as Error).message}`);
    }
  }

  /**
   * 👑 Take Over
   * Адміністратор стає виконавцем замовлення.
   * Один користувач може мати декілька ролей: Admin + Executor.
   */
  async takeOverExecutor(orderId: string, adminId: string) {
    const query = new Parse.Query(this.orderClassName);
    try {
      const order = await this.getOrderObject(orderId);
      const currentExecutor = order.get(OrderTable.Fields.AssignedExecutorId) as string | null;
      if (currentExecutor === adminId) {
        throw new BadRequestException('Ви вже є виконавцем цього замовлення');
      }
      if (currentExecutor) {
        await this.closeLatestAssignmentHistory({
          orderId,
          executorId: currentExecutor,
          unassignedBy: adminId,
          reason: UnassignReason.AdminDecision,
          comment: 'Admin take over',
        });
      }
      order.set(OrderTable.Fields.AssignedExecutorId, adminId);
      order.set(OrderTable.Fields.AssignedBy, adminId);
      order.set(OrderTable.Fields.AssignedAt, new Date());
      const currentStatus = order.get(OrderTable.Fields.Status) as OrderStatus;
      if (currentStatus === OrderStatus.AvailableForExecutor) {
        order.set(OrderTable.Fields.Status, OrderStatus.Assigned);
      }
      const updated = await order.save();
      await this.recordAssignmentHistory({ orderId, executorId: adminId, assignedBy: adminId, reason: 'take_over' });
      return this.mapOrderFields(updated);
    } catch (error) {
      if (error instanceof BadRequestException) throw error;
      throw new BadRequestException(`Помилка переймання замовлення: ${(error as Error).message}`);
    }
  }

  async revisionRequired(
    orderId: string,
    adminId: string,
    description: string,
    checklistSteps?: any[],
    photoIds?: string[],
  ) {
    const query = new Parse.Query(this.orderClassName);
    try {
      const order = await this.getOrderObject(orderId);
      const currentStatus = order.get(OrderTable.Fields.Status) as OrderStatus;
      if (currentStatus !== OrderStatus.AwaitingCompletionReview) {
        throw new BadRequestException('Замовлення не очікує на перевірку');
      }
      order.set(OrderTable.Fields.Status, OrderStatus.RevisionRequired);
      const updated = await order.save();

      const revision = new Parse.Object(OrderRevisionTable.TableName);
      revision.set(OrderRevisionTable.Fields.OrderId, orderId);
      revision.set(OrderRevisionTable.Fields.RevisionNumber, 1);
      revision.set(OrderRevisionTable.Fields.FromStatus, OrderStatus.AwaitingCompletionReview);
      revision.set(OrderRevisionTable.Fields.ToStatus, OrderStatus.RevisionRequired);
      revision.set(OrderRevisionTable.Fields.Description, description);
      if (checklistSteps) revision.set(OrderRevisionTable.Fields.ChecklistSteps, checklistSteps);
      if (photoIds) revision.set(OrderRevisionTable.Fields.PhotoIds, photoIds);
      revision.set(OrderRevisionTable.Fields.CreatedBy, adminId);
      revision.set(OrderRevisionTable.Fields.CreatedByRole, 'admin');
      revision.set(OrderRevisionTable.Fields.CreatedAt, new Date());
      await revision.save();

      return this.mapOrderFields(updated);
    } catch (error) {
      throw new BadRequestException(`Помилка створення ревізії: ${(error as Error).message}`);
    }
  }

  async resubmitForReview(orderId: string, executorId: string, comment?: string) {
    const query = new Parse.Query(this.orderClassName);
    try {
      const order = await this.getOrderObject(orderId);
      const currentStatus = order.get(OrderTable.Fields.Status) as OrderStatus;
      const currentExecutor = order.get(OrderTable.Fields.AssignedExecutorId) as string | null;
      if (currentStatus !== OrderStatus.RevisionRequired || currentExecutor !== executorId) {
        throw new BadRequestException('Замовлення не можна повторно здати');
      }
      if (comment) {
        order.set(OrderTable.Fields.ExecutorComment, comment);
      }
      order.set(OrderTable.Fields.Status, OrderStatus.AwaitingCompletionReview);
      order.set(OrderTable.Fields.SubmittedAt, new Date());
      const updated = await order.save();

      const revision = new Parse.Object(OrderRevisionTable.TableName);
      revision.set(OrderRevisionTable.Fields.OrderId, orderId);
      revision.set(OrderRevisionTable.Fields.RevisionNumber, 1);
      revision.set(OrderRevisionTable.Fields.FromStatus, OrderStatus.RevisionRequired);
      revision.set(OrderRevisionTable.Fields.ToStatus, OrderStatus.AwaitingCompletionReview);
      revision.set(OrderRevisionTable.Fields.Description, comment ?? '');
      revision.set(OrderRevisionTable.Fields.CreatedBy, executorId);
      revision.set(OrderRevisionTable.Fields.CreatedByRole, 'executor');
      revision.set(OrderRevisionTable.Fields.CreatedAt, new Date());
      revision.set(OrderRevisionTable.Fields.ResolvedAt, new Date());
      if (comment) revision.set(OrderRevisionTable.Fields.ExecutorComment, comment);
      await revision.save();

      return this.mapOrderFields(updated);
    } catch (error) {
      throw new BadRequestException(`Помилка повторної здачі: ${(error as Error).message}`);
    }
  }

  async approveCompletion(orderId: string, adminId: string) {
    const query = new Parse.Query(this.orderClassName);
    try {
      const order = await this.getOrderObject(orderId);
      const currentStatus = order.get(OrderTable.Fields.Status) as OrderStatus;
      if (currentStatus !== OrderStatus.AwaitingCompletionReview) {
        throw new BadRequestException('Замовлення не очікує на перевірку');
      }
      order.set(OrderTable.Fields.Status, OrderStatus.Done);
      order.set(OrderTable.Fields.CompletedAt, new Date());
      order.set(OrderTable.Fields.CompletedBy, adminId);
      const updated = await order.save();
      return this.mapOrderFields(updated);
    } catch (error) {
      throw new BadRequestException(`Помилка схвалення: ${(error as Error).message}`);
    }
  }

  async sendClientReport(orderId: string) {
    const order = await this.findById(orderId);
    if (!order) {
      throw new NotFoundException('Замовлення не знайдено');
    }

    const telegramId = order.client.telegramId;
    const photosBefore = order.report.photosBefore ?? [];
    const photosAfter = order.report.photosAfter ?? [];

    const text = `🎉 <b>Вашу роботу № виконано!</b>

` +
      `📌 <b>Послуга:</b> ${order.service?.name ?? 'Не вказано'}
` +
      `📅 <b>Дата виконання:</b> ${new Date().toLocaleDateString('uk-UA')}
` +
      `💬 <b>Коментар виконавця:</b> ${order.executorComment ?? 'Немає коментаря'}

` +
      `Дякуємо, що обрали наш сервіс!`;

    await this.clientBot.telegram.sendMessage(telegramId, text, { parse_mode: 'HTML' });

    for (const url of photosBefore) {
      try {
        await this.clientBot.telegram.sendPhoto(telegramId, url);
      } catch (e) {
        console.error('Failed to send before photo:', e);
      }
    }

    for (const url of photosAfter) {
      try {
        await this.clientBot.telegram.sendPhoto(telegramId, url);
      } catch (e) {
        console.error('Failed to send after photo:', e);
      }
    }

    return order;
  }

  async findById(id: string) {
    const query = new this.back4app.parse.Query(this.orderClassName);
    query.include('service');
    try {
      const order = await this.getOrderObject(id);
      return this.mapOrderFields(order);
    } catch {
      return null;
    }
  }

  /** Req 39: Overdue is not a separate status */
  isOverdue(order: { status: OrderStatus; deadlines?: { executionDeadline?: Date | string | null } }): boolean {
    const deadline = order.deadlines?.executionDeadline;
    if (!deadline) return false;
    const dl = deadline instanceof Date ? deadline : new Date(deadline);
    if (Number.isNaN(dl.getTime())) return false;
    const terminal = [OrderStatus.Done, OrderStatus.Canceled, OrderStatus.Rejected];
    return Date.now() > dl.getTime() && !terminal.includes(order.status);
  }

  /** Req 38: Human-readable time remaining until deadline */
  formatDeadlineRemaining(deadline?: Date | string | null): string {
    if (!deadline) return '—';
    const dl = deadline instanceof Date ? deadline : new Date(deadline);
    if (Number.isNaN(dl.getTime())) return '—';
    const diffMs = dl.getTime() - Date.now();
    if (diffMs <= 0) return 'прострочено';
    const totalMinutes = Math.floor(diffMs / (1000 * 60));
    const days = Math.floor(totalMinutes / (60 * 24));
    const hours = Math.floor((totalMinutes % (60 * 24)) / 60);
    const minutes = totalMinutes % 60;
    const parts: string[] = [];
    if (days > 0) parts.push(`${days} дн.`);
    if (hours > 0 || days > 0) parts.push(`${hours} год`);
    if (days === 0) parts.push(`${minutes} хв`);
    return parts.join(' ');
  }

  formatDeadline(deadline?: Date | string | null): string {
    if (!deadline) return '—';
    const dl = deadline instanceof Date ? deadline : new Date(deadline);
    if (Number.isNaN(dl.getTime())) return '—';
    return dl.toLocaleString('uk-UA', { dateStyle: 'short', timeStyle: 'short' });
  }

  // ==================== Req 38-39: Deadline & Overdue helpers ====================

  async clientCancelOrder(orderId: string, telegramId: string, reason?: string, comment?: string) {
    const query = new Parse.Query(this.orderClassName);
    const order = await this.getOrderObject(orderId);
    const status = order.get(OrderTable.Fields.Status) as OrderStatus;
    const ownerTg = order.get(OrderTable.Fields.TelegramId) as string;
    if (ownerTg !== telegramId) throw new ForbiddenException('Це не ваше замовлення');
    if (status === OrderStatus.Done) throw new BadRequestException('Виконане замовлення не можна скасувати');
    if (this.clientRequestCancelStatuses.has(status)) {
      return this.createCancellationRequest(orderId, `client:${telegramId}`, reason ?? 'Client requested cancellation', comment);
    }
    if (!this.clientDirectCancelStatuses.has(status)) {
      throw new BadRequestException('Скасування недоступне на поточному етапі');
    }
    return this.applyCancellation(order, `client:${telegramId}`, reason ?? 'Client canceled', comment ?? null, status, null);
  }

  /** Req 42,45: Create cancellation request for post-assignment stages */
  async createCancellationRequest(orderId: string, requestedBy: string, reason: string, comment?: string) {
    if (!reason?.trim()) throw new BadRequestException('Причина скасування обовʼязкова');
    const query = new Parse.Query(this.orderClassName);
    const order = await this.getOrderObject(orderId);
    const status = order.get(OrderTable.Fields.Status) as OrderStatus;
    if (status === OrderStatus.Done || status === OrderStatus.Canceled) {
      throw new BadRequestException('Замовлення вже завершене або скасоване');
    }
    const req = new Parse.Object(this.cancellationRequestClassName);
    req.set(CancellationRequestTable.Fields.OrderId, orderId);
    req.set(CancellationRequestTable.Fields.RequestedBy, requestedBy);
    req.set(CancellationRequestTable.Fields.RequestedAt, new Date());
    req.set(CancellationRequestTable.Fields.Reason, reason);
    if (comment) req.set(CancellationRequestTable.Fields.Comment, comment);
    req.set(CancellationRequestTable.Fields.Status, CancellationRequestStatus.Pending);
    const saved = await req.save();
    order.set(OrderTable.Fields.CancellationRequestId, saved.id);
    await order.save();
    return { requestId: saved.id, status: CancellationRequestStatus.Pending };
  }

  /** Req 43: Executor reports inability to complete */
  async reportExecutorInability(
    orderId: string,
    executorId: string,
    reason: ExecutorInabilityReason,
    comment?: string,
  ) {
    if (!reason) throw new BadRequestException('Причина обовʼязкова');
    if (ExecutorInabilityReasonsRequiringComment.includes(reason) && !comment?.trim()) {
      throw new BadRequestException('Для обраної причини коментар обовʼязковий');
    }
    const query = new Parse.Query(this.orderClassName);
    const order = await this.getOrderObject(orderId);
    const status = order.get(OrderTable.Fields.Status) as OrderStatus;
    const currentExecutor = order.get(OrderTable.Fields.AssignedExecutorId) as string | null;
    if (currentExecutor !== executorId) throw new ForbiddenException('Ви не є виконавцем цього замовлення');
    const allowed = new Set([OrderStatus.Assigned, OrderStatus.InProgress, OrderStatus.RevisionRequired, OrderStatus.AwaitingClientConfirmation]);
    if (!allowed.has(status)) throw new BadRequestException('Неможливо повідомити про проблему на поточному етапі');

    // Unassign and return to pool; admin decides next steps (req 43)
    await this.closeLatestAssignmentHistory({
      orderId,
      executorId,
      unassignedBy: `executor:${executorId}`,
      reason,
      comment,
    });
    order.set(OrderTable.Fields.AssignedExecutorId, null);
    order.set(OrderTable.Fields.UnassignedBy, `executor:${executorId}`);
    order.set(OrderTable.Fields.UnassignedAt, new Date());
    order.set(OrderTable.Fields.UnassignReason, UnassignReason.ExecutorRequestedReassignment);
    order.set(OrderTable.Fields.Status, OrderStatus.AvailableForExecutor);
    await order.save();
    await this.recordStatusHistory({
      orderId,
      fromStatus: status,
      toStatus: OrderStatus.AvailableForExecutor,
      changedBy: `executor:${executorId}`,
      reason,
      comment,
    });
    // Admin notification hook (req 40/43) — best-effort
    return this.mapOrderFields(order);
  }

  // ==================== Req 36: Assignment History ====================

  /** Req 44,46: Admin cancels order with audit */
  async adminCancelOrder(
    orderId: string,
    adminId: string,
    reason: string,
    comment?: string,
    commentForClient?: string,
  ) {
    if (!reason?.trim()) throw new BadRequestException('Причина скасування обовʼязкова');
    const query = new Parse.Query(this.orderClassName);
    const order = await this.getOrderObject(orderId);
    const status = order.get(OrderTable.Fields.Status) as OrderStatus;
    if (status === OrderStatus.Done) throw new BadRequestException('Виконане замовлення не можна скасувати');
    if (status === OrderStatus.Canceled) throw new BadRequestException('Замовлення вже скасоване');
    const cancellationRequestId = order.get(OrderTable.Fields.CancellationRequestId) as string | null;
    return this.applyCancellation(order, `admin:${adminId}`, reason, comment ?? commentForClient ?? null, status, cancellationRequestId);
  }

  /** Req 42,45: Admin reviews a cancellation request */
  async reviewCancellationRequest(
    requestId: string,
    adminId: string,
    decision: 'approve' | 'reject',
    decisionComment?: string,
  ) {
    const reqQuery = new Parse.Query(this.cancellationRequestClassName);
    reqQuery.equalTo('objectId', requestId);
    const reqResults = await reqQuery.find();
    if (!reqResults || reqResults.length === 0) {
      throw new NotFoundException(`Запит на скасування з ID ${requestId} не знайдено`);
    }
    const req = reqResults[0];
    const reqStatus = req.get(CancellationRequestTable.Fields.Status) as CancellationRequestStatus;
    if (reqStatus !== CancellationRequestStatus.Pending) {
      throw new BadRequestException('Запит вже розглянуто');
    }
    const orderId = req.get(CancellationRequestTable.Fields.OrderId) as string;
    const order = await this.getOrderObject(orderId);
    const prevStatus = order.get(OrderTable.Fields.Status) as OrderStatus;

    req.set(CancellationRequestTable.Fields.ReviewedBy, adminId);
    req.set(CancellationRequestTable.Fields.ReviewedAt, new Date());
    if (decisionComment) req.set(CancellationRequestTable.Fields.DecisionComment, decisionComment);

    if (decision === 'approve') {
      req.set(CancellationRequestTable.Fields.Status, CancellationRequestStatus.Approved);
      await req.save();
      if (prevStatus !== OrderStatus.Done && prevStatus !== OrderStatus.Canceled) {
        await this.applyCancellation(
          order,
          `admin:${adminId}`,
          (req.get(CancellationRequestTable.Fields.Reason) as string) ?? 'Cancellation approved',
          decisionComment ?? (req.get(CancellationRequestTable.Fields.Comment) as string) ?? null,
          prevStatus,
          requestId,
        );
      }
      return { requestId, status: CancellationRequestStatus.Approved };
    } else {
      req.set(CancellationRequestTable.Fields.Status, CancellationRequestStatus.Rejected);
      await req.save();
      // Keep order in its current status (req 42: admin makes final decision)
      return { requestId, status: CancellationRequestStatus.Rejected };
    }
  }

  /**
   * Req 48: Executor reports a problem/help request.
   * MUST NOT change order status or cancel the order.
   */
  async reportExecutorProblem(params: {
    orderId: string;
    executorId: string;
    reason: string;
    comment?: string;
    photoFileIds?: string[];
  }) {
    const order = await this.findById(params.orderId);
    if (!order) throw new NotFoundException('Замовлення не знайдено');
    try {
      const rec = new Parse.Object(ClarificationRequestTable.TableName);
      rec.set(ClarificationRequestTable.Fields.OrderId, params.orderId);
      rec.set(ClarificationRequestTable.Fields.CreatedBy, `executor:${params.executorId}`);
      rec.set(ClarificationRequestTable.Fields.Recipient, 'admin');
      rec.set(ClarificationRequestTable.Fields.Question, `[${params.reason}] ${params.comment ?? ''}`.trim());
      rec.set(ClarificationRequestTable.Fields.CreatedAt, new Date());
      rec.set(ClarificationRequestTable.Fields.Status, ClarificationStatus.AwaitingResponse);
      await rec.save();
    } catch (e) {
      console.error('Failed to save problem report record:', e);
    }

    const adminChatId = process.env.TELEGRAM_ADMIN_CHAT_ID || '';
    if (adminChatId) {
      const text =
        `🆘 <b>Проблема по замовленню №${params.orderId}</b>\n\n` +
        `Виконавець: <code>${params.executorId}</code>\n` +
        `Причина: <b>${params.reason}</b>\n` +
        `Коментар: ${params.comment ?? '—'}\n` +
        `Статус замовлення: <b>${order.status}</b> (не змінено)`;
      try {
        await this.adminBot.telegram.sendMessage(adminChatId, text, { parse_mode: 'HTML' });
        for (const fileId of params.photoFileIds ?? []) {
          try {
            await this.adminBot.telegram.sendPhoto(adminChatId, fileId);
          } catch (e) {
            console.error('Failed to forward problem photo:', e);
          }
        }
      } catch (e) {
        console.error('Failed to notify admin about problem:', e);
      }
    }
    return { ok: true };
  }

  // ==================== Req 41-47: Cancellation ====================

  /**
   * Надсилає сповіщення всім активним виконавцям про нове замовлення.
   * Повідомлення містить повні деталі (послуга, місце, покійний, роки життя, коментар)
   * та кнопки «Підтвердити» / «Відказуюсь».
   * Message ID зберігається для подальшого оновлення/видалення, коли замовлення хтось візьме.
   */
  private async notifyPerformersAboutOrder(orderId: string, order: any) {
    let performers;
    try {
      performers = await this.performersService.findAllActive();
    } catch (error) {
      console.error('Не вдалося завантажити список виконавців:', error);
      return;
    }

    if (!performers || performers.length === 0) return;

    // Дані місця поховання (memory place): кладовище, сектор, GPS, ПІБ, роки життя
    const burialId = order?.details?.burialId as string | undefined;
    let burial: any = undefined;
    if (burialId) {
      try {
        burial = await this.burialsService.findBurialById(burialId);
      } catch {
        burial = undefined;
      }
    }

    const serviceName = order?.service?.name ?? ExecutorConst.NewOrderDash;
    const additionalServices = this.formatAdditionalServices(order?.additionalServices);
    const clientComment = order?.clientComment?.trim()
      ? this.escapeHtml(order.clientComment.trim())
      : ExecutorConst.NewOrderNoComment;
    const serviceDate = this.formatDate(order?.deadlines?.serviceDateFrom);
    const deadline =
      order?.deadlineDisplay?.executionDeadline ?? ExecutorConst.NewOrderDash;

    const fullName = burial
      ? `${burial.burialLastName ?? ''} ${burial.burialName ?? ''} ${burial.burialFatherName ?? ''}`.trim()
      : '';
    const lifeYears = this.formatLifeYears(burial?.birthDate, burial?.deathDate);

    const text =
      `${ExecutorConst.NewOrderTitle(orderId)}\n\n` +
      `${ExecutorConst.NewOrderServiceLabel} <b>${this.escapeHtml(serviceName)}</b>\n` +
      `${ExecutorConst.NewOrderAdditionalServicesLabel} ${additionalServices}\n` +
      `${ExecutorConst.NewOrderDateLabel} ${serviceDate}\n` +
      `${ExecutorConst.NewOrderDeadlineLabel} ${this.escapeHtml(deadline)}\n\n` +
      `${ExecutorConst.NewOrderDeceasedLabel} ${this.escapeHtml(fullName) || ExecutorConst.NewOrderDash}\n` +
      `${ExecutorConst.NewOrderLifeYearsLabel} ${lifeYears}\n\n` +
      `${ExecutorConst.NewOrderPlaceLabel}\n` +
      `${ExecutorConst.NewOrderCemeteryLabel} ${this.escapeHtml(burial?.cemetery) || ExecutorConst.NewOrderDash}\n` +
      `${ExecutorConst.NewOrderSectorLabel} ${this.escapeHtml(burial?.notes) || ExecutorConst.NewOrderDash}\n` +
      `${ExecutorConst.NewOrderGpsLabel} ${this.escapeHtml(burial?.coordinates) || ExecutorConst.NewOrderDash}\n\n` +
      `${ExecutorConst.NewOrderCommentLabel} ${clientComment}`;

    const notifications: Array<{ telegramId: string; messageId: number }> = [];

    for (const performer of performers) {
      if (!performer.telegramId) continue;
      try {
        const message = await this.executorBot.telegram.sendMessage(
          performer.telegramId,
          text,
          {
            parse_mode: 'HTML',
            reply_markup: {
              inline_keyboard: [
                [
                  {
                    text: ExecutorConst.NewOrderConfirmButton,
                    callback_data: `executor_confirm_order_${orderId}`,
                  },
                  {
                    text: ExecutorConst.NewOrderDeclineButton,
                    callback_data: `executor_decline_order_${orderId}`,
                  },
                ],
              ],
            },
          },
        );
        notifications.push({
          telegramId: performer.telegramId,
          messageId: message.message_id,
        });
      } catch (error) {
        console.error(
          `Не вдалося надіслати сповіщення виконавцю ${performer.telegramId}:`,
          error,
        );
      }
    }

    if (notifications.length > 0) {
      this.orderNotifications.set(orderId, notifications);
    }
  }

  /** Екранує HTML-спецсимволи, щоб динамічний контент не ламав розмітку Telegram */
  private escapeHtml(value?: string | null): string {
    if (value == null) return '';
    return String(value)
      .replace(/&/g, '&')
      .replace(/</g, '<')
      .replace(/>/g, '>');
  }

  /** Форматує дату у uk-UA або повертає «—» */
  private formatDate(value?: Date | string | null): string {
    if (!value) return ExecutorConst.NewOrderDash;
    const date = value instanceof Date ? value : new Date(value);
    if (Number.isNaN(date.getTime())) return ExecutorConst.NewOrderDash;
    return date.toLocaleDateString('uk-UA');
  }

  /** Форматує роки життя (дата народження — дата смерті) */
  private formatLifeYears(
    birth?: string | Date | null,
    death?: string | Date | null,
  ): string {
    const b = birth ? new Date(birth) : null;
    const d = death ? new Date(death) : null;
    const bOk = !!b && !Number.isNaN(b.getTime());
    const dOk = !!d && !Number.isNaN(d.getTime());
    if (bOk && dOk) {
      return `${b!.toLocaleDateString('uk-UA')} — ${d!.toLocaleDateString('uk-UA')}`;
    }
    if (dOk) return `— ${d!.toLocaleDateString('uk-UA')}`;
    if (bOk) return `${b!.toLocaleDateString('uk-UA')} —`;
    return ExecutorConst.NewOrderDash;
  }

  /** Форматує список додаткових послуг у рядок */
  private formatAdditionalServices(services?: string[]): string {
    const list = (services ?? []).map((s) => String(s).trim()).filter(Boolean);
    if (list.length === 0) return ExecutorConst.NewOrderNoAdditionalServices;
    return list.map((s) => this.escapeHtml(s)).join(', ');
  }

  private async recordAssignmentHistory(params: {
    orderId: string;
    executorId: string;
    assignedBy: string;
    reason?: string;
    comment?: string;
  }): Promise<void> {
    const history = new Parse.Object(this.assignmentHistoryClassName);
    history.set(OrderAssignmentHistoryTable.Fields.OrderId, params.orderId);
    history.set(OrderAssignmentHistoryTable.Fields.ExecutorId, params.executorId);
    history.set(OrderAssignmentHistoryTable.Fields.AssignedAt, new Date());
    history.set(OrderAssignmentHistoryTable.Fields.AssignedBy, params.assignedBy);
    if (params.reason) history.set(OrderAssignmentHistoryTable.Fields.Reason, params.reason);
    if (params.comment) history.set(OrderAssignmentHistoryTable.Fields.Comment, params.comment);
    await history.save();
  }

  private async closeLatestAssignmentHistory(params: {
    orderId: string;
    executorId: string;
    unassignedBy: string;
    reason: string;
    comment?: string;
  }): Promise<void> {
    const query = new Parse.Query(this.assignmentHistoryClassName);
    query.equalTo(OrderAssignmentHistoryTable.Fields.OrderId, params.orderId);
    query.equalTo(OrderAssignmentHistoryTable.Fields.ExecutorId, params.executorId);
    query.doesNotExist(OrderAssignmentHistoryTable.Fields.UnassignedAt);
    query.descending(OrderAssignmentHistoryTable.Fields.AssignedAt);
    query.limit(1);
    const record = await query.first();
    if (record) {
      record.set(OrderAssignmentHistoryTable.Fields.UnassignedAt, new Date());
      record.set(OrderAssignmentHistoryTable.Fields.UnassignedBy, params.unassignedBy);
      record.set(OrderAssignmentHistoryTable.Fields.Reason, params.reason);
      if (params.comment) record.set(OrderAssignmentHistoryTable.Fields.Comment, params.comment);
      await record.save();
    }
  }

  // ==================== Req 49: Order Status History ====================
  private async recordStatusHistory(params: {
    orderId: string;
    fromStatus: OrderStatus | string | null;
    toStatus: OrderStatus | string;
    changedBy: string;
    reason?: string;
    comment?: string;
  }): Promise<void> {
    try {
      const rec = new Parse.Object(this.statusHistoryClassName);
      rec.set(OrderStatusHistoryTable.Fields.OrderId, params.orderId);
      rec.set(OrderStatusHistoryTable.Fields.FromStatus, params.fromStatus ?? 'none');
      rec.set(OrderStatusHistoryTable.Fields.ToStatus, params.toStatus);
      rec.set(OrderStatusHistoryTable.Fields.ChangedBy, params.changedBy);
      rec.set(OrderStatusHistoryTable.Fields.ChangedAt, new Date());
      if (params.reason) rec.set(OrderStatusHistoryTable.Fields.Reason, params.reason);
      if (params.comment) rec.set(OrderStatusHistoryTable.Fields.Comment, params.comment);
      await rec.save();
    } catch (e) {
      console.error('Failed to record status history:', e);
    }
  }

  private async applyCancellation(
    order: Parse.Object,
    canceledBy: string,
    reason: string,
    comment: string | null,
    previousStatus: OrderStatus,
    cancellationRequestId: string | null,
  ) {
    order.set(OrderTable.Fields.Status, OrderStatus.Canceled);
    order.set(OrderTable.Fields.PreviousStatus, previousStatus);
    order.set(OrderTable.Fields.CanceledAt, new Date());
    order.set(OrderTable.Fields.CanceledBy, canceledBy);
    order.set(OrderTable.Fields.CancellationReason, reason);
    if (comment) order.set(OrderTable.Fields.CancellationComment, comment);
    if (cancellationRequestId) order.set(OrderTable.Fields.CancellationRequestId, cancellationRequestId);
    // Clear active executor assignment on cancel
    const executorId = order.get(OrderTable.Fields.AssignedExecutorId) as string | null;
    if (executorId) {
      await this.closeLatestAssignmentHistory({
        orderId: order.id!,
        executorId,
        unassignedBy: canceledBy,
        reason: 'order_canceled',
        comment: comment ?? undefined,
      });
      order.set(OrderTable.Fields.AssignedExecutorId, null);
    }
    const saved = await order.save();
    await this.recordStatusHistory({
      orderId: saved.id!,
      fromStatus: previousStatus,
      toStatus: OrderStatus.Canceled,
      changedBy: canceledBy,
      reason,
      comment: comment ?? undefined,
    });
    return this.mapOrderFields(saved);
  }

  private mapOrderFields(order: Parse.Object) {
    const service = order.get(OrderTable.Fields.Service) as
      | Parse.Object
      | undefined;

    const getUrls = (filesArray: (Parse.File | string)[] | undefined): string[] => {
      if (!filesArray) return [];
      return filesArray.map((file) => {
        if (typeof file === 'string') {
          return file; // Already a URL or path string
        }
        return file.url(); // Parse.File object
      });
    };

    const status = order.get(OrderTable.Fields.Status) as OrderStatus;
    const executionDeadline = order.get(OrderTable.Fields.ExecutionDeadline) as Date | null;
    const mapped = {
      id: order.id,
      status,
      createdAt: order.createdAt,
      updatedAt: order.updatedAt,
      burialName: order.get('name') as string,
      client: {
        name: order.get(OrderTable.Fields.ClientName) as string,
        phone: order.get(OrderTable.Fields.ClientPhone) as string,
        email: order.get(OrderTable.Fields.ClientEmail) as string | null,
        telegramId: order.get(OrderTable.Fields.TelegramId) as string,
      },
      service: service
        ? {
          id: service.id,
          name: service.get('name') as string,
          price: service.get('price') as number,
        }
        : null,
      details: {
        burialId: order.get(OrderTable.Fields.BurialId) as string,
      },
      additionalServices:
        (order.get(OrderTable.Fields.AdditionalServices) as string[] | undefined) ??
        [],
      clientComment:
        (order.get(OrderTable.Fields.ClientComment) as string | undefined) ?? '',
      report: {
        clientPhotos: getUrls(
          order.get(OrderTable.Fields.ClientPhotos) as Parse.File[] | undefined,
        ),
        photosBefore: getUrls(
          order.get(OrderTable.Fields.ReportPhotosBefore) as Parse.File[] | undefined,
        ),
        photosAfter: getUrls(
          order.get(OrderTable.Fields.ReportPhotosAfter) as Parse.File[] | undefined,
        ),
        adminComment: order.get(OrderTable.Fields.AdminComment) as string,
      },
      assignment: {
        executorId: order.get(OrderTable.Fields.AssignedExecutorId) as string | null,
        assignedBy: order.get(OrderTable.Fields.AssignedBy) as string | null,
        assignedAt: order.get(OrderTable.Fields.AssignedAt) as Date | null,
      },
      deadlines: {
        serviceDateFrom: order.get(OrderTable.Fields.ServiceDateFrom) as Date | null,
        serviceDateTo: order.get(OrderTable.Fields.ServiceDateTo) as Date | null,
        executionDeadline,
      },
      executorComment: order.get(OrderTable.Fields.ExecutorComment) as string | null,
      cancellation: {
        canceledAt: order.get(OrderTable.Fields.CanceledAt) as Date | null,
        canceledBy: order.get(OrderTable.Fields.CanceledBy) as string | null,
        reason: order.get(OrderTable.Fields.CancellationReason) as string | null,
        comment: order.get(OrderTable.Fields.CancellationComment) as string | null,
        previousStatus: order.get(OrderTable.Fields.PreviousStatus) as OrderStatus | null,
        cancellationRequestId: order.get(OrderTable.Fields.CancellationRequestId) as string | null,
      },
      // Req 39
      isOverdue: this.isOverdue({ status, deadlines: { executionDeadline } }),
      deadlineDisplay: {
        executionDeadline: this.formatDeadline(executionDeadline),
        remaining: this.formatDeadlineRemaining(executionDeadline),
      },
    };
    return mapped;
  }
}
