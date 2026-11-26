import { BadRequestException, ForbiddenException, Injectable, Logger, NotFoundException, } from '@nestjs/common';
import { Back4appService } from '../back4app/back4app.service';
import * as Parse from 'parse/node';
import { OrderTable } from './models/order-table';
import { OrderRevisionTable } from './models/order-revision-table';
import { OrderAssignmentHistoryTable } from './models/order-assignment-history-table';
import { OrderStatusHistoryTable } from './models/order-status-history-table';
import { OrderServiceChecklistTable } from './models/order-service-checklist-table';
import { ServiceChecklistTable } from '../services/models/service-checklist-table';
import { CancellationRequestStatus, CancellationRequestTable, } from './models/cancellation-request-table';
import { ClarificationRequestTable, ClarificationStatus, } from './models/clarification-request-table';
import { MemoryPlaceUpdateRequestTable } from '../burials/models/memory-place-update-request-table';
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
import { ImageModelTable } from '../images/models/image-model-table';
import { AdminService } from '../telegram-bot/admin/admin.service';

export interface ChecklistStep {
  id: string;
  title: string;
  description?: string;
  type: string;
  required: boolean;
  order: number;
}

@Injectable()
export class OrdersService {
  private readonly logger = new Logger(OrdersService.name);
  private readonly orderClassName = OrderTable.TableName;
  private readonly serviceClassName = 'Service';
  private readonly orderServiceChecklistClassName = OrderServiceChecklistTable.TableName;
  private readonly serviceChecklistClassName = ServiceChecklistTable.TableName;
  private readonly assignmentHistoryClassName = OrderAssignmentHistoryTable.TableName;
  private readonly cancellationRequestClassName = CancellationRequestTable.TableName;
  private readonly statusHistoryClassName = OrderStatusHistoryTable.TableName;

  /** Req 40: deadline notification intervals (hours) — configurable */
  /*private readonly deadlineNotificationConfig = {
    executorAfterAssignment: true,
    executor24h: 24,
    executor3h: 3,
    notifyOnOverdue: true,
  };*/

  /**
   * In-memory tracking of order-notification messages sent to performers.
   * Key: orderId → list of { telegramId, messageId } so we can delete
   * the notification from each performer's chat once the order is taken.
   */
  private readonly orderNotifications = new Map<
    string,
    Array<{ telegramId: string; messageId: number }>
  >();
  /**
   * Tracking of admin order messages (with confirm/reject/etc. buttons).
   * Key: orderId → list of { chatId, messageId } so we can remove buttons
   * and update the text in every admin's chat once one admin acts on the order.
   */
  private readonly adminOrderMessages = new Map<
    string,
    Array<{ chatId: string | number; messageId: number }>
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
  /**
   * Зберігає сесію уточнення клієнта: зв'язує telegramId клієнта з chatId адміна та orderId.
   * Коли клієнт надішле текст, його буде переслано цьому адміну.
   */
  private readonly clientClarificationSessions = new Map<
    string,
    { adminChatId: string; orderId: string }
  >();
  /**
   * Зберігає повідомлення від клієнта, яке адмін має переслати виконавцю.
   * Ключ: chatId адміна.
   */
  private readonly clientMessagesForAdmin = new Map<
    string,
    { orderId: string; messageText: string; clientTelegramId: string }
  >();

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
    private readonly adminService: AdminService,
  ) {
  }

  /**
   * Повертає всіх активних адмінів.
   */
  /*public async getAllActiveAdmins() {
    return this.adminService.findAllActive();
  }*/

  /**
   * Надсилає сповіщення всім адмінам про те, що виконавець не знайшов місце поховання.
   * Повідомлення містить номер замовлення, дані виконавця та кнопки дії.
   */
  public async sendNotFoundToAdmins(
    orderId: string,
    executorName: string,
    executorPhone: string,
    executorTelegramId: string,
  ): Promise<void> {
    this.logger.log(`[OrdersService] sendNotFoundToAdmins`, { orderId, executorTelegramId });

    const order = await this.findById(orderId);
    if (!order) return;

    const text = ExecutorConst.NotFoundAdminTitle(orderId, executorName, executorPhone);

    const admins = await this.adminService.findAllActive();
    for (const admin of admins) {
      if (!admin.telegramId) continue;
      try {
        await this.adminBot.telegram.sendMessage(admin.telegramId, text, {
          parse_mode: 'HTML',
          reply_markup: {
            inline_keyboard: [
              [
                {
                  text: ExecutorConst.AdminClarifyClientButton,
                  callback_data: `admin_notfound_clarify_client_${orderId}`
                },
                { text: ExecutorConst.AdminWriteMessageButton, callback_data: `admin_write_message_${orderId}` },
              ],
            ],
          },
        });
      } catch (error) {
        console.error(`Не вдалося надіслати повідомлення адміну ${admin.telegramId}:`, error);
      }
    }
  }

  /**
   * Надсилає повідомлення клієнту з проханням уточнити інформацію про місце поховання.
   */
  public async sendClarificationToClient(
    clientTelegramId: string,
    orderId: string,
  ): Promise<void> {
    this.logger.log(`[OrdersService] sendClarificationToClient`, { clientTelegramId, orderId });

    try {
      await this.clientBot.telegram.sendMessage(
        clientTelegramId,
        ExecutorConst.NotFoundClientTitle(orderId),
        { parse_mode: 'HTML' },
      );
    } catch (error) {
      console.error(`Не вдалося надіслати повідомлення клієнту ${clientTelegramId}:`, error);
    }
  }

  /**
   * Надсилає повідомлення виконавцю (текст від адміна або переслане від клієнта)
   * з кнопками "Знайшов" / "Не знайдено".
   */
  public async sendMessageToExecutorWithButtons(
    executorTelegramId: string,
    orderId: string,
    senderName: string,
    messageText: string,
  ): Promise<void> {
    this.logger.log(`[OrdersService] sendMessageToExecutorWithButtons`, { executorTelegramId, orderId });

    const text = ExecutorConst.NotFoundExecutorTitle(orderId, senderName, messageText);

    try {
      await this.executorBot.telegram.sendMessage(
        executorTelegramId,
        text,
        {
          parse_mode: 'HTML',
          reply_markup: {
            inline_keyboard: [
              [
                { text: ExecutorConst.FoundButton, callback_data: `executor_msg_found_${orderId}` },
                { text: ExecutorConst.NotFoundButton, callback_data: `executor_msg_not_found_${orderId}` },
              ],
            ],
          },
        },
      );
    } catch (error) {
      console.error(`Не вдалося надіслати повідомлення виконавцю ${executorTelegramId}:`, error);
    }
  }

  /**
   * Отримує telegramId виконавця за його executorId.
   */
  public async getExecutorTelegramId(executorId: string): Promise<string | null> {
    try {
      const performer = await this.performersService.findById(executorId);
      return performer?.telegramId ?? null;
    } catch {
      return null;
    }
  }

  /**
   * Реєструє сесію уточнення для клієнта.
   */
  public registerClientClarificationSession(
    clientTelegramId: string,
    adminChatId: string,
    orderId: string,
  ): void {
    this.clientClarificationSessions.set(clientTelegramId, { adminChatId, orderId });
  }

  /**
   * Отримує та видаляє сесію уточнення для клієнта.
   */
  public popClientClarificationSession(clientTelegramId: string): { adminChatId: string; orderId: string } | undefined {
    const session = this.clientClarificationSessions.get(clientTelegramId);
    if (session) {
      this.clientClarificationSessions.delete(clientTelegramId);
    }
    return session;
  }

  /**
   * Зберігає повідомлення клієнта для адміна (для подальшого пересилання виконавцю).
   */
  public storeClientMessageForAdmin(
    adminChatId: string,
    orderId: string,
    messageText: string,
    clientTelegramId: string,
  ): void {
    this.clientMessagesForAdmin.set(adminChatId, { orderId, messageText, clientTelegramId });
  }

  /**
   * Отримує та видаляє повідомлення клієнта для адміна.
   */
  public popClientMessageForAdmin(adminChatId: string): {
    orderId: string;
    messageText: string;
    clientTelegramId: string
  } | undefined {
    const msg = this.clientMessagesForAdmin.get(adminChatId);
    if (msg) {
      this.clientMessagesForAdmin.delete(adminChatId);
    }
    return msg;
  }

  /**
   * Реєструє повідомлення адміна про замовлення (з кнопками дії),
   * щоб пізніше оновити/прибрати кнопки у всіх адмінів, коли один з них
   * підтвердить/відхилить/уточнить замовлення.
   */
  registerAdminOrderMessage(
    orderId: string,
    chatId: string | number,
    messageId: number,
  ): void {
    let messages = this.adminOrderMessages.get(orderId);
    if (!messages) {
      messages = [];
      this.adminOrderMessages.set(orderId, messages);
    }
    messages.push({ chatId, messageId });
  }

  /**
   * Прибирає кнопки дії та оновлює текст у повідомлень ВСІХ інших адмінів
   * для цього замовлення (крім того, хто виконав дію), щоб у всіх відображалося
   * однаково і кнопки більше не можна було натиснути повторно.
   */
  async notifyAdminsOrderResolved(
    orderId: string,
    actedByChatId: string | number,
    text: string,
  ): Promise<void> {
    const messages = this.adminOrderMessages.get(orderId);
    if (!messages || messages.length === 0) return;

    const actedBy = String(actedByChatId);
    for (const { chatId, messageId } of messages) {
      if (String(chatId) === actedBy) continue;
      try {
        // Прибираємо кнопки (працює і для тексту, і для фото)
        await this.adminBot.telegram.editMessageReplyMarkup(chatId, messageId, undefined, {
          inline_keyboard: [],
        });
        // Оновлюємо текст/підпис, щоб відображався поточний стан
        try {
          await this.adminBot.telegram.editMessageText(chatId, messageId, undefined, text, {
            parse_mode: 'HTML',
          });
        } catch {
          // Якщо це повідомлення з фото — редагуємо підпис
          try {
            await this.adminBot.telegram.editMessageCaption(chatId, messageId, undefined, text, {
              parse_mode: 'HTML',
            });
          } catch {
            // ігноруємо — повідомлення вже видалене/нередаговане
          }
        }
      } catch {
        // ігноруємо — повідомлення видалене або бот не має прав
      }
    }

    this.adminOrderMessages.delete(orderId);
  }

  async create(createOrderDto: CreateOrderDto) {
    this.logger.log(`[OrdersService] create`, { createOrderDto });
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

    // Req 16: Snapshot the service checklist at order creation
    await this.snapshotServiceChecklist(savedOrder.id!, serviceId);

    return this.mapOrderFields(savedOrder);
  }

  async findAll() {
    this.logger.log(`[OrdersService] findAll`, {});
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
    this.logger.log(`[OrdersService] findByTelegramId`, { telegramId });
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
    this.logger.log(`[OrdersService] updateStatus`, { id, status, meta });
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
    this.logger.log(`[OrdersService] uploadReportPhotos`, { id, type, base64Files, adminComment });

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
        // Req 12: After before photos, wait for client confirmation
        order.set(OrderTable.Fields.Status, OrderStatus.AwaitingClientConfirmation);
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
        order.set(OrderTable.Fields.Status, OrderStatus.InProgress); // Виконавець ще в роботі — очікуємо відправки на перевірку
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
   * Додає ОДИН шлях до локального зображення у фото звіту за слотом.
   *
   * Використовується виконавцем (Telegram-бот): фото спершу зберігається
   * на диск через ImageStorageService, а в БД (Back4app) потрапляє лише шлях.
   * Фото зберігаються як плоский масив (для сумісності зі схемою) та
   * окремо за слотами для валідації.
   *
   * @param id       Order objectId
   * @param type     'before' | 'after'
   * @param slotKey  Ключ слота (напр. 'front', 'left', 'right', 'monument')
   * @param filePath відносний шлях (напр. `orders/<id>/before/169...-ab.jpg`)
   */
  async addReportPhotoPath(
    id: string,
    type: 'before' | 'after',
    slotKey: string,
    filePath: string,
  ): Promise<void> {
    this.logger.log(`[OrdersService] addReportPhotoPath`, { id, type, slotKey, filePath });
    const order = await this.getOrderObject(id);

    const flatField =
      type === 'before'
        ? OrderTable.Fields.ReportPhotosBefore
        : OrderTable.Fields.ReportPhotosAfter;
    const slotField =
      type === 'before'
        ? OrderTable.Fields.ReportPhotosBeforeBySlot
        : OrderTable.Fields.ReportPhotosAfterBySlot;

    // Плоский масив для сумісності зі схемою Back4app
    const currentFlat =
      (order.get(flatField) as string[] | undefined) ?? [];
    order.set(flatField, [...currentFlat, filePath]);

    // Перслотне відслідковування для валідації
    const currentBySlot =
      (order.get(slotField) as Record<string, string[]> | undefined) ?? {};
    const slotPhotos = currentBySlot[slotKey] ?? [];
    const updatedBySlot = { ...currentBySlot, [slotKey]: [...slotPhotos, filePath] };
    order.set(slotField, updatedBySlot);

    if (type === 'before') {
      // Req 12: After before photos, wait for client confirmation
      order.set(OrderTable.Fields.Status, OrderStatus.AwaitingClientConfirmation);
    } else {
      // Фото «після» — виконавець ще в роботі, статус не змінюємо на очікування клієнта
      order.set(OrderTable.Fields.Status, OrderStatus.InProgress);
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
    this.logger.log(`[OrdersService] addChecklistPhoto`, { id, stepId, filePath });
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
   * Зберігає відповідь виконавця на крок чек-листа.
   *
   * @param id       Order objectId
   * @param stepId   id кроку чек-листа
   * @param answer   відповідь (напр. 'confirmed', 'yes', 'no', 'photo', 'text:...')
   * @param executorId id виконавця
   * @returns оновлений об'єкт відповідей
   */
  async saveChecklistAnswer(
    id: string,
    stepId: string,
    answer: string,
    executorId: string,
  ): Promise<Record<string, { answer: string; answeredAt: Date; answeredBy: string }>> {
    this.logger.log(`[OrdersService] saveChecklistAnswer`, { id, stepId, answer, executorId });
    const order = await this.getOrderObject(id);

    const current =
      (order.get(OrderTable.Fields.ChecklistAnswers) as
        | Record<string, { answer: string; answeredAt: Date; answeredBy: string }>
        | undefined) ?? {};

    current[stepId] = {
      answer,
      answeredAt: new Date(),
      answeredBy: executorId,
    };

    order.set(OrderTable.Fields.ChecklistAnswers, current);
    await order.save();

    return current;
  }

  /**
   * Отримує всі відповіді на чек-лист для замовлення.
   *
   * @param id Order objectId
   * @returns об'єкт відповідей { [stepId]: { answer, answeredAt, answeredBy } }
   */
  /*async getChecklistAnswers(
    id: string,
  ): Promise<Record<string, { answer: string; answeredAt: Date; answeredBy: string }>> {
    this.logger.log(`[OrdersService] getChecklistAnswers`, { id });
    const order = await this.getOrderObject(id);
    return (
      (order.get(OrderTable.Fields.ChecklistAnswers) as
        | Record<string, { answer: string; answeredAt: Date; answeredBy: string }>
        | undefined) ?? {}
    );
  }*/

  /**
   * ✅ Метод ПІДТВЕРДЖЕННЯ заявки адміном + сповіщення клієнта
   */
  async confirmAndNotify(orderId: string, clientId: string) {
    this.logger.log(`[OrdersService] confirmAndNotify`, { orderId, clientId });

    // Ідемпотентність: якщо замовлення вже підтверджено/оброблено іншим адміном,
    // не надсилаємо повторні сповіщення клієнту та виконавцям.
    const existing = await this.findById(orderId);
    if (!existing) {
      throw new NotFoundException(`Заявку з ID ${orderId} не знайдено`);
    }
    const currentStatus = existing.status as OrderStatus;
    if (currentStatus !== OrderStatus.New && currentStatus !== OrderStatus.AwaitingAdminReview) {
      this.logger.log(
        `[OrdersService] confirmAndNotify: замовлення №${orderId} вже має статус ${currentStatus}, пропускаємо повторне підтвердження`,
        {},
      );
      return existing;
    }

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

  /**
   * Оновлює сповіщення про замовлення в чатах інших виконавців на «вже підтверджено»
   * (прибирає кнопки), окрім того, хто підтвердив. Якщо редагування неможливе — видаляє.
   * Викликається одразу після assignExecutor.
   */
  async notifyPerformersOrderTaken(orderId: string, takenByExecutorId: string) {
    this.logger.log(`[OrdersService] notifyPerformersOrderTaken`, { orderId, takenByExecutorId });
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
   * Сповіщає адміністратора, що виконавець підтвердив замовлення.
   * Надсилає ФІО, телефон виконавця та номер замовлення.
   */
  async notifyAdminAboutExecutorConfirm(orderId: string, executorTelegramId: string) {
    this.logger.log(`[OrdersService] notifyAdminAboutExecutorConfirm`, { orderId, executorTelegramId });

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

    await this.notifyAllAdmins(text);
  }

  /**
   * Spовіщає адміністратора про те, що виконавець взяв замовлення.
   * Надсилає номер замовлення, дані виконавця, телефон, фото «до» та кнопки підтвердження/уточнення.
   */
  /*async notifyAdminExecutorAssigned(
    orderId: string,
    executorTelegramId: string,
  ): Promise<void> {
    this.logger.log(`[OrdersService] notifyAdminExecutorAssigned`, { orderId, executorTelegramId });

    const order = await this.findById(orderId);
    if (!order) return;

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

    const photosBefore = order.report?.photosBefore ?? [];
    const photosText = photosBefore.length > 0
      ? `\n📸 Фото «до» (${photosBefore.length}): ${photosBefore.join(', ')}`
      : '\n📸 Фото «до»: ще не завантажено';

    const text =
      `👷 <b>Виконавець взяв замовлення №${orderId}</b>\n\n` +
      `📌 Послуга: ${order.service?.name ?? '—'}\n` +
      `👤 Виконавець: ${this.escapeHtml(fullName) || '—'}\n` +
      `📞 Телефон: ${this.escapeHtml(phone) || '—'}\n` +
      `🪦 Місце поховання: ${order.details?.burialId ?? '—'}\n` +
      `💬 Коментар клієнта: ${order.clientComment || '—'}` +
      photosText +
      `\n\nПідтвердьте виконавця або запросіть уточнення:`;

    const options = {
      parse_mode: 'HTML',
      reply_markup: {
        inline_keyboard: [
          [
            { text: '✅ Підтвердити виконавця', callback_data: `admin_confirm_executor_${orderId}` },
            { text: '❓ Уточнити', callback_data: `admin_clarify_executor_${orderId}` },
          ],
        ],
      },
    };

    await this.notifyAllAdmins(text, options);
  }*/

  // ==================== Хелпери для форматування сповіщень ====================

  /**
   * Адміністратор підтверджує виконавця. Виконавець може приступати до виконання.
   */
  async confirmExecutorAssignment(
    orderId: string,
    adminId: string,
  ): Promise<void> {
    this.logger.log(`[OrdersService] confirmExecutorAssignment`, { orderId, adminId });
    const order = await this.getOrderObject(orderId);
    const currentStatus = order.get(OrderTable.Fields.Status) as OrderStatus;
    if (currentStatus !== OrderStatus.Assigned) {
      throw new BadRequestException('Замовлення не в статусі Assigned');
    }

    order.set(OrderTable.Fields.AdminConfirmedAt, new Date());
    order.set(OrderTable.Fields.AdminConfirmedBy, adminId);
    order.set(OrderTable.Fields.AdminConfirmationResponse, 'yes');
    // Allow executor to start execution
    order.set(OrderTable.Fields.Status, OrderStatus.Assigned);
    await order.save();

    await this.recordStatusHistory({
      orderId,
      fromStatus: currentStatus,
      toStatus: OrderStatus.Assigned,
      changedBy: `admin:${adminId}`,
      reason: 'admin_confirmed_executor',
    });

    // Notify executor that they can proceed
    const executorId = order.get(OrderTable.Fields.AssignedExecutorId) as string | null;
    if (executorId) {
      try {
        await this.executorBot.telegram.sendMessage(
          executorId,
          `✅ Адміністратор підтвердив ваше призначення на замовлення №${orderId}.\n\nТепер ви можете приступати до виконання робіт. Перейдіть до «Мої замовлення» та оберіть замовлення для початку роботи.`,
          { parse_mode: 'HTML' },
        );
      } catch (error) {
        console.error('Не вдалося надіслати повідомлення виконавцю:', error);
      }
    }
  }

  /**
   * Адміністратор запитує уточнення від виконавця.
   */
  async clarifyExecutorAssignment(
    orderId: string,
    adminId: string,
    comment: string,
  ): Promise<void> {
    this.logger.log(`[OrdersService] clarifyExecutorAssignment`, { orderId, adminId, comment });
    const order = await this.getOrderObject(orderId);
    const currentStatus = order.get(OrderTable.Fields.Status) as OrderStatus;
    if (currentStatus !== OrderStatus.Assigned) {
      throw new BadRequestException('Замовлення не в статусі Assigned');
    }

    order.set(OrderTable.Fields.AdminConfirmedAt, new Date());
    order.set(OrderTable.Fields.AdminConfirmedBy, adminId);
    order.set(OrderTable.Fields.AdminConfirmationResponse, 'clarification');
    order.set(OrderTable.Fields.AdminComment, comment);
    await order.save();

    await this.recordStatusHistory({
      orderId,
      fromStatus: currentStatus,
      toStatus: currentStatus,
      changedBy: `admin:${adminId}`,
      reason: 'admin_clarified_executor',
      comment,
    });

    // Notify executor that clarification is needed
    const executorId = order.get(OrderTable.Fields.AssignedExecutorId) as string | null;
    if (executorId) {
      try {
        await this.executorBot.telegram.sendMessage(
          executorId,
          `❓ Адміністратор запросив уточнення по замовленню №${orderId}.\n\nКоментар адміністратора: ${comment}\n\nБудь ласка, надішліть відповідь (фото та/або коментар).`,
          { parse_mode: 'HTML' },
        );
      } catch (error) {
        console.error('Не вдалося надіслати повідомлення виконавцю:', error);
      }
    }
  }

  /**
   * Виконавець відповідає на уточнення адміністратора (фото та/або коментар).
   */
  async respondToAdminClarification(
    orderId: string,
    executorId: string,
    comment?: string,
    photoFileIds?: string[],
  ): Promise<void> {
    this.logger.log(`[OrdersService] respondToAdminClarification`, { orderId, executorId, comment, photoFileIds });
    const order = await this.getOrderObject(orderId);
    const currentExecutor = order.get(OrderTable.Fields.AssignedExecutorId) as string | null;
    if (currentExecutor !== executorId) {
      throw new ForbiddenException('Ви не є виконавцем цього замовлення');
    }

    if (comment) {
      order.set(OrderTable.Fields.ExecutorComment, comment);
    }
    await order.save();

    // Notify admin about executor's response
    const text =
      `🔄 <b>Відповідь виконавця на уточнення (замовлення №${orderId})</b>\n\n` +
      `💬 Коментар: ${comment || '—'}\n` +
      `📸 Фото: ${photoFileIds?.length ?? 0} шт.`;
    try {
      await this.notifyAllAdmins(text, { parse_mode: 'HTML' });
      for (const fileId of photoFileIds ?? []) {
        const admins = await this.adminService.findAllActive();
        for (const admin of admins) {
          if (!admin.telegramId) continue;
          try {
            await this.adminBot.telegram.sendPhoto(admin.telegramId, fileId);
          } catch {
            // ignore
          }
        }
      }
    } catch (error) {
      console.error('Не вдалося надіслати відповідь адміністратору:', error);
    }
  }

  // ==================== Admin confirmation of executor assignment ====================

  /**
   * Spовіщає адміністратора про завантажені фото «до» для перевірки.
   * Надсилає фото «до» та кнопки підтвердження/уточнення.
   */
  async notifyAdminBeforePhotos(
    orderId: string,
    executorTelegramId: string,
  ): Promise<void> {
    this.logger.log(`[OrdersService] notifyAdminBeforePhotos`, { orderId, executorTelegramId });

    const order = await this.findById(orderId);
    if (!order) return;

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

    // Дані місця поховання (померлий): ПІБ, дати
    const burialId = order?.details?.burialId as string | undefined;
    let burial: any = undefined;
    if (burialId) {
      try {
        burial = await this.burialsService.findBurialById(burialId);
      } catch {
        burial = undefined;
      }
    }

    const deceasedFullName = burial
      ? `${burial.burialLastName ?? ''} ${burial.burialName ?? ''} ${burial.burialFatherName ?? ''}`.trim()
      : '';
    const lifeYears = this.formatLifeYears(burial?.birthDate, burial?.deathDate);

    const photosBeforeBySlot: Record<string, string[]> =
      ((order.report?.photosBeforeBySlot as any) ?? {});
    const totalPhotos = Object.values(photosBeforeBySlot).flat().length;

    // Надсилаємо всі фото адміну (організовано по слотах)
    const slotOrder = ['front', 'left', 'right', 'monument'];
    const slotNames: Record<string, string> = {
      front: 'Загальний вигляд спереду',
      left: 'Вигляд зліва',
      right: 'Вигляд справа',
      monument: 'Памʼятник крупним планом',
    };

    // Збираємо всі фото в один масив для відправки одним повідомленням (media group)
    const mediaGroup: any[] = [];
    for (const slotKey of slotOrder) {
      const photos = photosBeforeBySlot[slotKey] ?? [];
      for (const filePath of photos) {
        try {
          const buffer = await this.getImageBuffer(filePath);
          if (!buffer) continue;
          mediaGroup.push({
            type: 'photo',
            media: { source: buffer },
            caption: `📸 ${slotNames[slotKey] ?? slotKey}`,
          });
        } catch (e) {
          console.error(`Не вдалося підготувати фото ${filePath} для адміну:`, e);
        }
      }
    }

    // Надсилаємо фото кожному адміну з бази
    const admins = await this.adminService.findAllActive();
    const CHUNK_SIZE = 10;
    for (const admin of admins) {
      if (!admin.telegramId) continue;
      for (let i = 0; i < mediaGroup.length; i += CHUNK_SIZE) {
        const chunk = mediaGroup.slice(i, i + CHUNK_SIZE);
        try {
          await this.adminBot.telegram.sendMediaGroup(admin.telegramId, chunk);
        } catch (e) {
          console.error(`Не вдалося надіслати групу фото адміну ${admin.telegramId}:`, e);
        }
      }
    }

    const text =
      `📸 <b>Фото «до» на перевірку (замовлення №${orderId})</b>\n\n` +
      `📌 Послуга: ${order.service?.name ?? '—'}\n` +
      `👤 Виконавець: ${this.escapeHtml(fullName) || '—'}\n` +
      `📞 Телефон: ${this.escapeHtml(phone) || '—'}\n` +
      `🪦 Місце поховання: ${order.details?.burialId ?? '—'}\n` +
      `💀 Померлий: ${this.escapeHtml(deceasedFullName) || '—'}\n` +
      `📅 Дати: ${lifeYears || '—'}\n` +
      `💬 Коментар клієнта: ${order.clientComment || '—'}\n` +
      `📸 Всього фото: ${totalPhotos}` +
      `\n\nПідтвердьте фото «до» або запросіть уточнення:`;

    const options = {
      parse_mode: 'HTML',
      reply_markup: {
        inline_keyboard: [
          [
            { text: '✅ Підтвердити фото «до»', callback_data: `admin_confirm_before_photos_${orderId}` },
            { text: '❓ Уточнити', callback_data: `admin_clarify_before_photos_${orderId}` },
          ],
        ],
      },
    };

    await this.notifyAllAdmins(text, options);
  }

  /**
   * Адміністратор підтверджує фото «до». Виконавець може приступати до подальших кроків.
   */
  async confirmBeforePhotos(
    orderId: string,
    adminId: string,
  ): Promise<void> {
    this.logger.log(`[OrdersService] confirmBeforePhotos`, { orderId, adminId });
    const order = await this.getOrderObject(orderId);
    const currentStatus = order.get(OrderTable.Fields.Status) as OrderStatus;
    if (currentStatus !== OrderStatus.AwaitingClientConfirmation) {
      throw new BadRequestException('Замовлення не в статусі AwaitingClientConfirmation -> ' + currentStatus);
    }

    order.set(OrderTable.Fields.BeforePhotosConfirmedAt, new Date());
    order.set(OrderTable.Fields.BeforePhotosConfirmedBy, adminId);
    order.set(OrderTable.Fields.BeforePhotosConfirmationResponse, 'yes');
    // order.set(OrderTable.Fields.Status, OrderStatus.InProgress);
    await order.save();

    await this.recordStatusHistory({
      orderId,
      fromStatus: currentStatus,
      toStatus: currentStatus,
      changedBy: `admin:${adminId}`,
      reason: 'admin_confirmed_before_photos',
    });

    // Notify executor that before photos are confirmed
    const executorId = order.get(OrderTable.Fields.AssignedExecutorId) as string | null;
    if (executorId) {
      try {
        await this.executorBot.telegram.sendMessage(
          executorId,
          `✅ Адміністратор підтвердив фото «до» для замовлення №${orderId}.\n\nТепер ви можете приступати до виконання робіт.`,
          {
            parse_mode: 'HTML',
            reply_markup: {
              inline_keyboard: [
                [
                  { text: '➡️ Далі — Service Checklist', callback_data: `executor_go_checklist_${orderId}` },
                ],
              ],
            },
          },
        );
      } catch (error) {
        console.error('Не вдалося надіслати повідомлення виконавцю:', error);
      }
    }

    // Notify client about before photos for verification (Req 12)
    // await this.notifyClientBeforePhotos(orderId, order);
  }

  /**
   * Адміністратор запитує уточнення щодо фото «до».
   */
  async clarifyBeforePhotos(
    orderId: string,
    adminId: string,
    comment: string,
  ): Promise<void> {
    this.logger.log(`[OrdersService] clarifyBeforePhotos`, { orderId, adminId, comment });
    const order = await this.getOrderObject(orderId);
    const currentStatus = order.get(OrderTable.Fields.Status) as OrderStatus;
    if (currentStatus !== OrderStatus.AwaitingClientConfirmation) {
      throw new BadRequestException('Замовлення не в статусі AwaitingClientConfirmation');
    }

    order.set(OrderTable.Fields.BeforePhotosConfirmedAt, new Date());
    order.set(OrderTable.Fields.BeforePhotosConfirmedBy, adminId);
    order.set(OrderTable.Fields.BeforePhotosConfirmationResponse, 'clarification');
    order.set(OrderTable.Fields.AdminComment, comment);
    await order.save();

    await this.recordStatusHistory({
      orderId,
      fromStatus: currentStatus,
      toStatus: currentStatus,
      changedBy: `admin:${adminId}`,
      reason: 'admin_clarified_before_photos',
      comment,
    });

    // Notify executor that clarification is needed
    const executorId = order.get(OrderTable.Fields.AssignedExecutorId) as string | null;
    if (executorId) {
      try {
        await this.executorBot.telegram.sendMessage(
          executorId,
          `❓ Адміністратор запросив уточнення щодо фото «до» (замовлення №${orderId}).\n\nКоментар адміністратора: ${comment}\n\nБудь ласка, завантажте оновлені фото «до».`,
          { parse_mode: 'HTML' },
        );
      } catch (error) {
        console.error('Не вдалося надіслати повідомлення виконавцю:', error);
      }
    }
  }

  /**
   * Виконавець відправляє роботу на перевірку адміністратору.
   * Статус: InProgress → AwaitingCompletionReview.
   */
  async submitForCompletionReview(
    orderId: string,
    executorId: string,
    comment?: string,
  ): Promise<void> {
    this.logger.log(`[OrdersService] submitForCompletionReview`, { orderId, executorId, comment });
    const order = await this.getOrderObject(orderId);
    const currentStatus = order.get(OrderTable.Fields.Status) as OrderStatus;
    const currentExecutor = order.get(OrderTable.Fields.AssignedExecutorId) as string | null;
    if (/*currentStatus !== OrderStatus.InProgress ||*/ currentExecutor !== executorId) {
      throw new BadRequestException('Замовлення не доступне для відправки на перевірку');
    }

    if (comment) {
      order.set(OrderTable.Fields.SubmissionComment, comment);
    }
    order.set(OrderTable.Fields.Status, OrderStatus.AwaitingCompletionReview);
    order.set(OrderTable.Fields.SubmittedAt, new Date());
    await order.save();

    await this.recordStatusHistory({
      orderId,
      fromStatus: currentStatus,
      toStatus: OrderStatus.AwaitingCompletionReview,
      changedBy: `executor:${executorId}`,
      reason: 'executor_submitted_for_review',
      comment,
    });

    // Notify admin about completion review — send before photos, then after photos, then final message
    const orderReport = order.get('report') as any;
    /*const photosBeforeBySlot: Record<string, string[]> =
      ((orderReport?.photosBeforeBySlot as any) ?? {});
    const photosAfterBySlot: Record<string, string[]> =
      ((orderReport?.photosAfterBySlot as any) ?? {});*/

    /*const slotOrder = ['front', 'left', 'right', 'monument'];
    const slotNames: Record<string, string> = {
      front: 'Загальний вигляд спереду',
      left: 'Вигляд зліва',
      right: 'Вигляд справа',
      monument: 'Памʼятник крупним планом',
    };*/

    // 1) Спочатку надсилаємо фото «ДО»
    /*for (const slotKey of slotOrder) {
      const photos = photosBeforeBySlot[slotKey] ?? [];
      for (const filePath of photos) {
        try {
          const buffer = await this.getImageBuffer(filePath);
          if (!buffer) continue;
          await this.adminBot.telegram.sendPhoto(adminChatId, { source: buffer }, {
            caption: `📸 «До»: ${slotNames[slotKey] ?? slotKey}`,
          });
        } catch (e) {
          console.error(`Не вдалося надіслати фото ${filePath} адміну:`, e);
        }
      }
    }*/

    // 2) Потім надсилаємо фото «ПІСЛЯ»
    /*for (const slotKey of slotOrder) {
      const photos = photosAfterBySlot[slotKey] ?? [];
      for (const filePath of photos) {
        try {
          const buffer = await this.getImageBuffer(filePath);
          if (!buffer) continue;
          await this.adminBot.telegram.sendPhoto(adminChatId, { source: buffer }, {
            caption: `📸 «Після»: ${slotNames[slotKey] ?? slotKey}`,
          });
        } catch (e) {
          console.error(`Не вдалося надіслати фото ${filePath} адміну:`, e);
        }
      }
    }*/

    // Збираємо додаткові дані про замовлення для фінального повідомлення
    const clientName = order.get(OrderTable.Fields.ClientName) as string | undefined;
    const clientTelegramId = order.get(OrderTable.Fields.TelegramId) as string | undefined;
    const serviceObj = order.get(OrderTable.Fields.Service) as Parse.Object | undefined;
    const serviceName = serviceObj?.get('name') as string | undefined;
    const checklist = order.get(OrderTable.Fields.Checklist) as
      | { steps: Array<{ title: string; required: boolean }> }
      | undefined;
    const executorComment = order.get(OrderTable.Fields.ExecutorComment) as string | undefined;
    // const totalBeforePhotos = Object.values(photosBeforeBySlot).flat().length;

    // Отримуємо історію уточнень для замовлення
    let clarificationHistory = 'немає';
    try {
      const clarificationQuery = new this.back4app.parse.Query(ClarificationRequestTable.TableName);
      clarificationQuery.equalTo(ClarificationRequestTable.Fields.OrderId, orderId);
      const clarifications = await clarificationQuery.find();
      if (clarifications.length > 0) {
        clarificationHistory = clarifications
          .map((c) => {
            const q = c.get(ClarificationRequestTable.Fields.Question) as string;
            const a = c.get(ClarificationRequestTable.Fields.Answer) as string | undefined;
            const s = c.get(ClarificationRequestTable.Fields.Status) as string;
            return `• ${q}${a ? ` → відповідь: ${a}` : ''} (${s})`;
          })
          .join('\n');
      }
    } catch {
      clarificationHistory = 'помилка завантаження';
    }

    // Отримуємо історію оновлень «Місця пам'яті» для замовлення
    let memoryPlaceHistory = 'немає';
    try {
      const mpQuery = new this.back4app.parse.Query(MemoryPlaceUpdateRequestTable.TableName);
      mpQuery.equalTo(MemoryPlaceUpdateRequestTable.Fields.OrderId, orderId);
      const mpRequests = await mpQuery.find();
      if (mpRequests.length > 0) {
        memoryPlaceHistory = mpRequests
          .map((r) => {
            const s = r.get(MemoryPlaceUpdateRequestTable.Fields.Status) as string;
            return `• статус: ${s}`;
          })
          .join('\n');
      }
    } catch {
      memoryPlaceHistory = 'помилка завантаження';
    }

    // const totalPhotos = Object.values(photosAfterBySlot).flat().length;
    const text =
      `🔍 <b>Робота на перевірку (замовлення №${orderId})</b>\n\n` +
      `👤 Клієнт: ${clientName || '—'} (<code>${clientTelegramId || '—'}</code>)\n` +
      `👷 Виконавець: <code>${executorId}</code>\n` +
      `🛠 Послуга: ${serviceName || '—'}\n` +
      `📋 Статус: ${currentStatus}\n` +
      `💬 Коментар виконавця: ${executorComment || '—'}\n` +
      `💬 Коментар при відправці: ${comment || '—'}\n` +
      // `📸 Фото «до»: ${totalBeforePhotos} шт.\n` +
      // `📸 Фото «після»: ${totalPhotos} шт.\n` +
      `📝 Чек-лист: ${checklist?.steps?.length ?? 0} кроків\n\n` +
      `❓ Уточнення:\n${clarificationHistory}\n\n` +
      `🏛 Оновлення «Місця пам'яті»:\n${memoryPlaceHistory}\n\n` +
      `Перегляньте фото «до»/«після» та чек-лист, потім підтвердьте або поверніть на доопрацювання.`;
    try {
      await this.notifyAllAdmins(text, {
        parse_mode: 'HTML',
        reply_markup: {
          inline_keyboard: [
            [
              { text: '✅ Підтвердити виконання', callback_data: `admin_confirm_completion_${orderId}` },
              { text: '🔄 Повернути на доопрацювання', callback_data: `admin_request_revision_${orderId}` },
            ],
          ],
        },
      });
    } catch (error) {
      console.error('Не вдалося надіслати сповіщення адміністратору про перевірку:', error);
    }
  }

  // ==================== Admin review of before photos ====================

  /**
   * Адміністратор підтверджує виконання робіт.
   * Статус: AwaitingCompletionReview → Done.
   */
  async confirmCompletion(
    orderId: string,
    adminId: string,
  ): Promise<void> {
    this.logger.log(`[OrdersService] confirmCompletion`, { orderId, adminId });
    const order = await this.getOrderObject(orderId);
    const currentStatus = order.get(OrderTable.Fields.Status) as OrderStatus;
    if (currentStatus !== OrderStatus.AwaitingCompletionReview) {
      throw new BadRequestException('Замовлення не очікує на перевірку виконання');
    }

    order.set(OrderTable.Fields.Status, OrderStatus.Done);
    order.set(OrderTable.Fields.CompletedAt, new Date());
    order.set(OrderTable.Fields.CompletedBy, adminId);
    await order.save();

    await this.recordStatusHistory({
      orderId,
      fromStatus: currentStatus,
      toStatus: OrderStatus.Done,
      changedBy: `admin:${adminId}`,
      reason: 'admin_confirmed_completion',
    });

    // Send client report
    try {
      await this.sendClientReport(orderId);
    } catch (error) {
      console.error('Не вдалося надіслати звіт клієнту:', error);
    }
  }

  /**
   * Адміністратор повертає роботу на доопрацювання.
   * Статус: AwaitingCompletionReview → RevisionRequired.
   */
  async requestRevision(
    orderId: string,
    adminId: string,
    description: string,
  ): Promise<void> {
    this.logger.log(`[OrdersService] requestRevision`, { orderId, adminId, description });
    const order = await this.getOrderObject(orderId);
    const currentStatus = order.get(OrderTable.Fields.Status) as OrderStatus;
    if (currentStatus !== OrderStatus.AwaitingCompletionReview) {
      throw new BadRequestException('Замовлення не очікує на перевірку виконання');
    }

    order.set(OrderTable.Fields.Status, OrderStatus.RevisionRequired);
    await order.save();

    await this.recordStatusHistory({
      orderId,
      fromStatus: currentStatus,
      toStatus: OrderStatus.RevisionRequired,
      changedBy: `admin:${adminId}`,
      reason: 'admin_requested_revision',
      comment: description,
    });

    // Notify executor about revision
    const executorId = order.get(OrderTable.Fields.AssignedExecutorId) as string | null;
    if (executorId) {
      try {
        await this.executorBot.telegram.sendMessage(
          executorId,
          `🔄 <b>Роботу повернено на доопрацювання (замовлення №${orderId})</b>\n\nКоментар адміністратора: ${description}\n\nВиправте зауваження та знову надішліть роботу на перевірку.`,
          { parse_mode: 'HTML' },
        );
      } catch (error) {
        console.error('Не вдалося надіслати повідомлення виконавцю:', error);
      }
    }
  }

  /**
   * ❌ Метод ВІДХИЛЕННЯ заявки адміном + сповіщення клієнта
   */
  async rejectAndNotify(orderId: string, clientId: string) {
    this.logger.log(`[OrdersService] rejectAndNotify`, { orderId, clientId });

    // Ідемпотентність: якщо замовлення вже відхилено іншим адміном,
    // не надсилаємо повторне сповіщення клієнту.
    const existing = await this.findById(orderId);
    if (!existing) {
      throw new NotFoundException(`Заявку з ID ${orderId} не знайдено`);
    }
    if (existing.status === OrderStatus.Rejected) {
      this.logger.log(
        `[OrdersService] rejectAndNotify: замовлення №${orderId} вже має статус ${OrderStatus.Rejected}, пропускаємо повторне відхилення`,
        {},
      );
      return existing;
    }

    const updatedOrder = await this.updateStatus(orderId, OrderStatus.Rejected);

    await this.clientBot.telegram.sendMessage(
      clientId,
      `🔴 <b>На жаль, вашу заявку №${orderId} було відхилено.</b>\n\n` +
      `Для уточнення деталей або якщо виникла помилка, будь ласка, зв'яжіться з нашою підтримкою або натисніть /help.`,
      { parse_mode: 'HTML', reply_markup: mainMenuButtons }
    );

    return updatedOrder;
  }

  // =======

  async notifyMessageAllAdmins(text: string, options?: any): Promise<void> {
    await this.notifyAllAdmins(text, options)
  }

  // ==================== Submission for completion review ====================

  /**
   * 🔍 Метод запиту на УТОЧНЕННЯ даних + сповіщення клієнта
   */
  async clarifyAndNotify(orderId: string, clientId: string) {
    this.logger.log(`[OrdersService] clarifyAndNotify`, { orderId, clientId });

    // Ідемпотентність: якщо замовлення вже знаходиться у стані уточнення,
    // не надсилаємо повторне сповіщення клієнту.
    const existing = await this.findById(orderId);
    if (!existing) {
      throw new NotFoundException(`Заявку з ID ${orderId} не знайдено`);
    }
    if (existing.status === OrderStatus.PendingClarification) {
      this.logger.log(
        `[OrdersService] clarifyAndNotify: замовлення №${orderId} вже має статус ${OrderStatus.PendingClarification}, пропускаємо повторне уточнення`,
        {},
      );
      return existing;
    }

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
    this.logger.log(`[OrdersService] findAvailable`, {});
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
    // this.logger.log(`[OrdersService] findByExecutorId`, { executorId });
    const query = new this.back4app.parse.Query(this.orderClassName);
    query.equalTo(OrderTable.Fields.AssignedExecutorId, executorId);
    query.include('service');
    query.descending('createdAt');

    const results = await query.find();
    return results.map((order) => this.mapOrderFields(order));
  }

  async startExecution(orderId: string, executorId: string) {
    this.logger.log(`[OrdersService] startExecution`, { orderId, executorId });

    try {
      const order = await this.getOrderObject(orderId);
      const currentStatus = order.get(OrderTable.Fields.Status) as OrderStatus;
      const currentExecutor = order.get(OrderTable.Fields.AssignedExecutorId) as string | null;
      if (currentStatus !== OrderStatus.Assigned || currentExecutor !== executorId) {
        throw new BadRequestException('Замовлення не доступне для запуску');
      }
      // Статус залишається Assigned — перехід до InProgress відбувається після підтвердження клієнтом (Етап 12)
      // Адмін підтверджує фото «до» після того, як виконавець завантажить їх (Етап 11), а не на старті
      const updated = await order.save();
      return this.mapOrderFields(updated);
    } catch (error) {
      throw new BadRequestException(`Помилка запуску виконання: ${(error as Error).message}`);
    }
  }

  async submitForReview(orderId: string, executorId: string, comment?: string) {
    this.logger.log(`[OrdersService] submitForReview`, { orderId, executorId, comment });
    try {
      const order = await this.getOrderObject(orderId);
      // const currentStatus = order.get(OrderTable.Fields.Status) as OrderStatus;
      const currentExecutor = order.get(OrderTable.Fields.AssignedExecutorId) as string | null;
      if (/*currentStatus !== OrderStatus.InProgress ||*/ currentExecutor !== executorId) {
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
    this.logger.log(`[OrdersService] assignExecutor`, { orderId, executorId, assignedBy });
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
    this.logger.log(`[OrdersService] unassignExecutor`, { orderId, adminId, reason, comment });
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
  /*async changeExecutor(orderId: string, newExecutorId: string, adminId: string, reason?: string) {
    this.logger.log(`[OrdersService] changeExecutor`, { orderId, newExecutorId, adminId, reason });
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
  }*/

  /**
   * 👑 Take Over
   * Адміністратор стає виконавцем замовлення.
   * Один користувач може мати декілька ролей: Admin + Executor.
   */
  async takeOverExecutor(orderId: string, adminId: string) {
    this.logger.log(`[OrdersService] takeOverExecutor`, { orderId, adminId });
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
    this.logger.log(`[OrdersService] revisionRequired`, { orderId, adminId, description, checklistSteps, photoIds });
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

  /*async resubmitForReview(orderId: string, executorId: string, comment?: string) {
    this.logger.log(`[OrdersService] resubmitForReview`, { orderId, executorId, comment });
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
  }*/

  async approveCompletion(orderId: string, adminId: string) {
    this.logger.log(`[OrdersService] approveCompletion`, { orderId, adminId });
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
    this.logger.log(`[OrdersService] sendClientReport`, { orderId });
    const order = await this.findById(orderId);
    if (!order) {
      throw new NotFoundException('Замовлення не знайдено');
    }

    const telegramId = order.client.telegramId;
    const photosBefore = order.report.photosBefore ?? [];
    const photosAfter = order.report.photosAfter ?? [];

    // Отримуємо дані про місце поховання для звіту (ТЗ §23: місце)
    let burialPlace = '—';
    try {
      if (order.details?.burialId) {
        const burial = await this.burialsService.findBurialById(order.details.burialId);
        if (burial) {
          const parts = [
            burial.cemetery ?? '',
            burial.notes ?? '',
          ].filter(Boolean);
          burialPlace = parts.length > 0 ? parts.join(', ') : '—';
        }
      }
    } catch {
      burialPlace = '—';
    }

    const text = `🎉 <b>Вашу роботу №${orderId} виконано!</b>

` +
      `📌 <b>Послуга:</b> ${order.service?.name ?? 'Не вказано'}
` +
      `📍 <b>Місце:</b> ${burialPlace}
` +
      `📅 <b>Дата виконання:</b> ${new Date().toLocaleDateString('uk-UA')}
` +
      `💬 <b>Коментар виконавця:</b> ${order.executorComment ?? 'Немає коментаря'}
` +
      `✅ <b>Результат виконання:</b> Робота виконана та підтверджена адміністратором.

` +
      `Дякуємо, що обрали наш сервіс!`;

    // Send before photos as a single media group with caption "ДО"
    const beforeMedia: any[] = [];
    for (const filePath of photosBefore) {
      const buffer = await this.getImageBuffer(filePath);
      if (!buffer) continue;
      beforeMedia.push({ type: 'photo', media: { source: buffer } });
    }
    if (beforeMedia.length > 0) {
      beforeMedia[0].caption = 'фото "ДО"';
      try {
        await this.clientBot.telegram.sendMediaGroup(telegramId, beforeMedia);
      } catch (e) {
        console.error('Failed to send before photos:', e);
      }
    }

    // Send after photos as a single media group with caption "ПІСЛЯ"
    const afterMedia: any[] = [];
    for (const filePath of photosAfter) {
      const buffer = await this.getImageBuffer(filePath);
      if (!buffer) continue;
      afterMedia.push({ type: 'photo', media: { source: buffer } });
    }
    if (afterMedia.length > 0) {
      afterMedia[0].caption = 'фото "ПІСЛЯ"';
      try {
        await this.clientBot.telegram.sendMediaGroup(telegramId, afterMedia);
      } catch (e) {
        console.error('Failed to send after photos:', e);
      }
    }

    await this.clientBot.telegram.sendMessage(telegramId, text, { parse_mode: 'HTML' });

    return order;
  }

  /**
   * Надсилає виконавцю повідомлення про успішне закінчення роботи
   * (викликається адміном після схвалення та відправки звіту клієнту).
   */
  public async notifyExecutorCompletion(orderId: string): Promise<void> {
    this.logger.log(`[OrdersService] notifyExecutorCompletion`, { orderId });
    const order = await this.findById(orderId);
    if (!order) return;

    const executorId = order.assignment?.executorId;
    if (!executorId) return;

    let performer: any;
    try {
      performer = await this.performersService.findById(executorId);
    } catch {
      performer = null;
    }
    const executorTelegramId = performer?.telegramId ?? executorId;
    if (!executorTelegramId) return;

    await this.executorBot.telegram.sendMessage(
      executorTelegramId,
      `✅ <b>Вашу роботу №${orderId} схвалено адміністратором!</b>\n\n` +
      `Замовлення завершено. Дякуємо за виконання.`,
      { parse_mode: 'HTML' },
    );
  }

  async findById(id: string) {
    // this.logger.log(`[OrdersService] findById`, { id });
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
    // this.logger.log(`[OrdersService] isOverdue`, { order });
    const deadline = order.deadlines?.executionDeadline;
    if (!deadline) return false;
    const dl = deadline instanceof Date ? deadline : new Date(deadline);
    if (Number.isNaN(dl.getTime())) return false;
    const terminal = [OrderStatus.Done, OrderStatus.Canceled, OrderStatus.Rejected];
    return Date.now() > dl.getTime() && !terminal.includes(order.status);
  }

  /** Req 38: Human-readable time remaining until deadline */
  formatDeadlineRemaining(deadline?: Date | string | null): string {
    // this.logger.log(`[OrdersService] formatDeadlineRemaining`, { deadline });
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
    // this.logger.log(`[OrdersService] formatDeadline`, { deadline });
    if (!deadline) return '—';
    const dl = deadline instanceof Date ? deadline : new Date(deadline);
    if (Number.isNaN(dl.getTime())) return '—';
    return dl.toLocaleString('uk-UA', { dateStyle: 'short', timeStyle: 'short' });
  }

  async clientCancelOrder(orderId: string, telegramId: string, reason?: string, comment?: string) {
    this.logger.log(`[OrdersService] clientCancelOrder`, { orderId, telegramId, reason, comment });
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
    this.logger.log(`[OrdersService] createCancellationRequest`, { orderId, requestedBy, reason, comment });
    if (!reason?.trim()) throw new BadRequestException('Причина скасування обовʼязкова');
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
    this.logger.log(`[OrdersService] reportExecutorInability`, { orderId, executorId, reason, comment });
    if (!reason) throw new BadRequestException('Причина обовʼязкова');
    if (ExecutorInabilityReasonsRequiringComment.includes(reason) && !comment?.trim()) {
      throw new BadRequestException('Для обраної причини коментар обовʼязковий');
    }
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

  /** Req 44,46: Admin cancels order with audit */
  async adminCancelOrder(
    orderId: string,
    adminId: string,
    reason: string,
    comment?: string,
    commentForClient?: string,
  ) {
    this.logger.log(`[OrdersService] adminCancelOrder`, { orderId, adminId, reason, comment, commentForClient });
    if (!reason?.trim()) throw new BadRequestException('Причина скасування обовʼязкова');
    const order = await this.getOrderObject(orderId);
    const status = order.get(OrderTable.Fields.Status) as OrderStatus;
    if (status === OrderStatus.Done) throw new BadRequestException('Виконане замовлення не можна скасувати');
    if (status === OrderStatus.Canceled) throw new BadRequestException('Замовлення вже скасоване');
    const cancellationRequestId = order.get(OrderTable.Fields.CancellationRequestId) as string | null;
    return this.applyCancellation(order, `admin:${adminId}`, reason, comment ?? commentForClient ?? null, status, cancellationRequestId);
  }

  // ==================== Req 38-39: Deadline & Overdue helpers ====================

  /** Req 42,45: Admin reviews a cancellation request */
  async reviewCancellationRequest(
    requestId: string,
    adminId: string,
    decision: 'approve' | 'reject',
    decisionComment?: string,
  ) {
    this.logger.log(`[OrdersService] reviewCancellationRequest`, { requestId, adminId, decision, decisionComment });
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
    this.logger.log(`[OrdersService] reportExecutorProblem`, { params });
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

    const text =
      `🆘 <b>Проблема по замовленню №${params.orderId}</b>\n\n` +
      `Виконавець: <code>${params.executorId}</code>\n` +
      `Причина: <b>${params.reason}</b>\n` +
      `Коментар: ${params.comment ?? '—'}\n` +
      `Статус замовлення: <b>${order.status}</b> (не змінено)`;
    try {
      await this.notifyAllAdmins(text, { parse_mode: 'HTML' });
      for (const fileId of params.photoFileIds ?? []) {
        const admins = await this.adminService.findAllActive();
        for (const admin of admins) {
          if (!admin.telegramId) continue;
          try {
            await this.adminBot.telegram.sendPhoto(admin.telegramId, fileId);
          } catch (e) {
            console.error(`Failed to forward problem photo to admin ${admin.telegramId}:`, e);
          }
        }
      }
    } catch (e) {
      console.error('Failed to notify admin about problem:', e);
    }
    return { ok: true };
  }

  /**
   * Зберігає копію актуальної версії чек-листа послуги у OrderServiceChecklist
   * та встановлює посилання на замовленні. Редагування master чек-листа не
   * впливає на вже створене замовлення.
   */
  async snapshotServiceChecklist(orderId: string, serviceId: string): Promise<void> {
    this.logger.log(`[OrdersService] snapshotServiceChecklist`, { orderId, serviceId });
    try {
      // Отримуємо чек-лист послуги
      const query = new this.back4app.parse.Query(this.serviceChecklistClassName);
      query.equalTo('serviceId', serviceId);
      const results = await query.find();

      let version = 1;
      let steps: any[] = [];

      if (results.length > 0) {
        const sc = results[0];
        version = sc.get('version') as number ?? 1;
        steps = sc.get('steps') as any[] ?? [];
      }

      // const snapshot = new this.back4app.parse.Query(this.orderServiceChecklistClassName);
      // Create new OrderServiceChecklist object
      const osc = new this.back4app.parse.Object(this.orderServiceChecklistClassName);
      osc.set(OrderServiceChecklistTable.Fields.OrderId, orderId);
      osc.set(OrderServiceChecklistTable.Fields.ServiceChecklistId, serviceId);
      osc.set(OrderServiceChecklistTable.Fields.Version, version);
      osc.set(OrderServiceChecklistTable.Fields.Snapshot, { version, steps });
      osc.set(OrderServiceChecklistTable.Fields.CreatedAt, new Date());
      await osc.save();

      // Оновлюємо замовлення: посилання на чек-лист та версію
      const order = await this.getOrderObject(orderId);
      order.set(OrderTable.Fields.ServiceChecklistId, serviceId);
      order.set(OrderTable.Fields.ChecklistVersion, version);
      order.set(OrderTable.Fields.Checklist, { version, steps });
      await order.save();
    } catch (error) {
      console.error('Помилка створення сніпшоту чек-листа:', error);
    }
  }

  // ==================== Req 36: Assignment History ====================

  /**
   * Клієнт підтверджує, що поховання знайдено правильно.
   * Статус: AwaitingClientConfirmation → InProgress.
   */
  async confirmClientConfirmation(
    orderId: string,
    clientTelegramId: string,
    response: 'yes' | 'clarification' | 'add_service',
  ): Promise<void> {
    this.logger.log(`[OrdersService] confirmClientConfirmation`, { orderId, clientTelegramId, response });
    const order = await this.getOrderObject(orderId);
    const currentStatus = order.get(OrderTable.Fields.Status) as OrderStatus;
    const ownerTg = order.get(OrderTable.Fields.TelegramId) as string;
    if (ownerTg !== clientTelegramId) {
      throw new ForbiddenException('Це не ваше замовлення');
    }
    if (currentStatus !== OrderStatus.AwaitingClientConfirmation) {
      throw new BadRequestException('Замовлення не очікує на підтвердження клієнтом');
    }

    order.set(OrderTable.Fields.ClientConfirmationResponse, response);
    order.set(OrderTable.Fields.ClientConfirmedAt, new Date());
    order.set(OrderTable.Fields.ClientConfirmedBy, clientTelegramId);

    if (response === 'yes') {
      order.set(OrderTable.Fields.Status, OrderStatus.InProgress);
    } else if (response === 'clarification') {
      order.set(OrderTable.Fields.Status, OrderStatus.PendingClarification);
    } else if (response === 'add_service') {
      // Залишаємо в AwaitingClientConfirmation, клієнт обере додаткову послугу
      order.set(OrderTable.Fields.Status, OrderStatus.AwaitingClientConfirmation);
    }

    await order.save();
    await this.recordStatusHistory({
      orderId,
      fromStatus: currentStatus,
      toStatus: order.get(OrderTable.Fields.Status) as OrderStatus,
      changedBy: `client:${clientTelegramId}`,
      reason: 'client_confirmation',
      comment: response,
    });
  }

  /**
   * Додає додаткову послугу до поточного замовлення.
   */
  async addAdditionalService(
    orderId: string,
    clientTelegramId: string,
    serviceName: string,
  ): Promise<void> {
    this.logger.log(`[OrdersService] addAdditionalService`, { orderId, clientTelegramId, serviceName });
    const order = await this.getOrderObject(orderId);
    const ownerTg = order.get(OrderTable.Fields.TelegramId) as string;
    if (ownerTg !== clientTelegramId) {
      throw new ForbiddenException('Це не ваше замовлення');
    }

    const current =
      (order.get(OrderTable.Fields.AdditionalServices) as string[] | undefined) ?? [];
    if (!current.includes(serviceName)) {
      order.set(OrderTable.Fields.AdditionalServices, [...current, serviceName]);
      await order.save();
    }
  }

  /**
   * Надсилає фото «до» та «після» адміністратору як медіа-групи:
   * спочатку фото «до» (одним повідомленням), потім фото «після» (наступним повідомленням).
   * Використовується сценою after-photos перед submitForCompletionReview.
   */
  public async sendPhotosToAdmin(orderId: string): Promise<void> {
    this.logger.log(`[OrdersService] sendPhotosToAdmin`, { orderId });

    const order = await this.findById(orderId);
    if (!order) return;

    const orderReport = (order as any)?.report as any;
    const photosBeforeBySlot: Record<string, string[]> =
      ((orderReport?.photosBeforeBySlot as any) ?? {});
    const photosAfterBySlot: Record<string, string[]> =
      ((orderReport?.photosAfterBySlot as any) ?? {});

    const slotOrder = ['front', 'left', 'right', 'monument'];
    const slotNames: Record<string, string> = {
      front: 'Загальний вигляд спереду',
      left: 'Вигляд зліва',
      right: 'Вигляд справа',
      monument: 'Памʼятник крупним планом',
    };

    // 1) Надсилаємо фото «ДО» як медіа-групу
    const beforeMedia: any[] = [];
    for (const slotKey of slotOrder) {
      const photos = photosBeforeBySlot[slotKey] ?? [];
      for (const filePath of photos) {
        try {
          const buffer = await this.getImageBuffer(filePath);
          if (!buffer) continue;
          beforeMedia.push({
            type: 'photo',
            media: { source: buffer },
            caption: `📸 «До»: ${slotNames[slotKey] ?? slotKey}`,
          });
        } catch (e) {
          console.error(`Не вдалося підготувати фото ${filePath} для адміну:`, e);
        }
      }
    }
    const CHUNK_SIZE = 10;

    // Надсилаємо фото кожному адміну з бази
    const admins = await this.adminService.findAllActive();
    for (const admin of admins) {
      if (!admin.telegramId) continue;
      for (let i = 0; i < beforeMedia.length; i += CHUNK_SIZE) {
        const chunk = beforeMedia.slice(i, i + CHUNK_SIZE);
        try {
          await this.adminBot.telegram.sendMediaGroup(admin.telegramId, chunk);
        } catch (e) {
          console.error(`Не вдалося надіслати групу фото «до» адміну ${admin.telegramId}:`, e);
        }
      }
    }

    // 2) Надсилаємо фото «ПІСЛЯ» як медіа-групу
    const afterMedia: any[] = [];
    for (const slotKey of slotOrder) {
      const photos = photosAfterBySlot[slotKey] ?? [];
      for (const filePath of photos) {
        try {
          const buffer = await this.getImageBuffer(filePath);
          if (!buffer) continue;
          afterMedia.push({
            type: 'photo',
            media: { source: buffer },
            caption: `📸 «Після»: ${slotNames[slotKey] ?? slotKey}`,
          });
        } catch (e) {
          console.error(`Не вдалося підготувати фото ${filePath} для адміну:`, e);
        }
      }
    }
    for (const admin of admins) {
      if (!admin.telegramId) continue;
      for (let i = 0; i < afterMedia.length; i += CHUNK_SIZE) {
        const chunk = afterMedia.slice(i, i + CHUNK_SIZE);
        try {
          await this.adminBot.telegram.sendMediaGroup(admin.telegramId, chunk);
        } catch (e) {
          console.error(`Не вдалося надіслати групу фото «після» адміну ${admin.telegramId}:`, e);
        }
      }
    }
  }

  // ==================== Req 41-47: Cancellation ====================

  /**
   * Надсилає повідомлення всім активним адмінам з бази даних.
   * Замість використання одного TELEGRAM_ADMIN_CHAT_ID з .env.
   */
  private async notifyAllAdmins(text: string, options?: any): Promise<void> {
    const admins = await this.adminService.findAllActive();
    if (admins.length === 0) {
      this.logger.warn('[OrdersService] notifyAllAdmins: немає активних адмінів у базі');
      return;
    }
    for (const admin of admins) {
      if (!admin.telegramId) continue;
      try {
        await this.adminBot.telegram.sendMessage(admin.telegramId, text, {
          parse_mode: 'HTML',
          ...options,
        });
      } catch (error) {
        console.error(`Не вдалося надіслати повідомлення адміну ${admin.telegramId}:`, error);
      }
    }
  }

  /**
   * Публічний метод для отримання буфера зображення за шляхом/оригінальною назвою файлу.
   * Використовується сценами телеграм-бота для відправки фото користувачеві.
   */

  /*public async getImageBufferByPath(filePath: string): Promise<Buffer | null> {
    return this.getImageBuffer(filePath);
  }*/

  /**
   * Отримує буфер зображення за ім'ям файлу (OriginalName), збереженим у таблиці ImageModel.
   * Зображення зберігаються як Base64 рядок (data:image/jpeg;base64,...).
   */
  private async getImageBuffer(filePath: string): Promise<Buffer | null> {
    this.logger.log(`[OrdersService] getImageBuffer`, { filePath });
    if (!filePath) return null;
    try {
      const Parse = this.back4app.parse;
      const query = new Parse.Query(ImageModelTable.TableName);
      query.equalTo(ImageModelTable.Fields.OriginalName, filePath);
      const result = await query.first(); //{ useMasterKey: true });
      if (!result) {
        console.error(`Зображення не знайдено в ImageModel: ${filePath}`);
        return null;
      }
      const base64String = result.get(ImageModelTable.Fields.Base64Data) as string;
      if (!base64String) {
        console.error(`Base64 дані відсутні для: ${filePath}`);
        return null;
      }
      const base64Data = base64String.split(',')[1] || base64String;
      return Buffer.from(base64Data, 'base64');
    } catch (e) {
      console.error(`Не вдалося отримати зображення ${filePath}:`, e);
      return null;
    }
  }

  /**
   * Отримує Order за ID через find (бо action «get» заборонений CLP на Back4app).
   * Кидає NotFoundException, якщо замовлення не існує.
   */
  private async getOrderObject(id: string): Promise<Parse.Object> {
    // this.logger.log(`[OrdersService] getOrderObject`, { id });
    const query = new this.back4app.parse.Query(this.orderClassName);
    query.equalTo('objectId', id);
    query.include('service');
    const results = await query.find();
    if (!results || results.length === 0) {
      throw new NotFoundException(`Заявку з ID ${id} не знайдено`);
    }
    return results[0];
  }

  /**
   * Надсилає замовнику (клієнту) коротке текстове повідомлення,
   * що його замовлення прийнято виконавцем. Без додаткових даних.
   */
  private async notifyClientOrderTaken(
    clientTelegramId: string,
    orderId: string,
  ): Promise<void> {
    this.logger.log(`[OrdersService] notifyClientOrderTaken`, { clientTelegramId, orderId });
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
   * Надсилає сповіщення всім активним виконавцям про нове замовлення.
   * Повідомлення містить повні деталі (послуга, місце, покійний, роки життя, коментар)
   * та кнопки «Підтвердити» / «Відказуюсь».
   * Message ID зберігається для подальшого оновлення/видалення, коли замовлення хтось візьме.
   */
  private async notifyPerformersAboutOrder(orderId: string, order: any) {
    this.logger.log(`[OrdersService] notifyPerformersAboutOrder`, { orderId, order });
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
    // this.logger.log(`[OrdersService] escapeHtml`, { value });
    if (value == null) return '';
    return String(value)
      .replace(/&/g, '&')
      .replace(/</g, '<')
      .replace(/>/g, '>');
  }

  /** Форматує дату у uk-UA або повертає «—» */
  private formatDate(value?: Date | string | null): string {
    this.logger.log(`[OrdersService] formatDate`, { value });
    if (!value) return ExecutorConst.NewOrderDash;
    const date = value instanceof Date ? value : new Date(value);
    if (Number.isNaN(date.getTime())) return ExecutorConst.NewOrderDash;
    return date.toLocaleDateString('uk-UA');
  }

  /** Форматує роки життя (дата народження — дата смерті) */
  private formatLifeYears(
    birth?: string | null,
    death?: string | null,
  ): string {
    this.logger.log(`[OrdersService] formatLifeYears`, { birth, death });
    const b = birth;
    const d = death;
    const bOk = !!b;
    const dOk = !!d;
    if (bOk && dOk) {
      return `${b!} — ${d!}`;
    }
    if (dOk) return `— ${d!}`;
    if (bOk) return `${b!} —`;
    return ExecutorConst.NewOrderDash;
  }

  /** Форматує список додаткових послуг у рядок */
  private formatAdditionalServices(services?: string[]): string {
    this.logger.log(`[OrdersService] formatAdditionalServices`, { services });
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
    this.logger.log(`[OrdersService] recordAssignmentHistory`, { params });
    const history = new Parse.Object(this.assignmentHistoryClassName);
    history.set(OrderAssignmentHistoryTable.Fields.OrderId, params.orderId);
    history.set(OrderAssignmentHistoryTable.Fields.ExecutorId, params.executorId);
    history.set(OrderAssignmentHistoryTable.Fields.AssignedAt, new Date());
    history.set(OrderAssignmentHistoryTable.Fields.AssignedBy, params.assignedBy);
    if (params.reason) history.set(OrderAssignmentHistoryTable.Fields.Reason, params.reason);
    if (params.comment) history.set(OrderAssignmentHistoryTable.Fields.Comment, params.comment);
    await history.save();
  }

  // ==================== Req 16: Snapshot checklist ====================

  private async closeLatestAssignmentHistory(params: {
    orderId: string;
    executorId: string;
    unassignedBy: string;
    reason: string;
    comment?: string;
  }): Promise<void> {
    this.logger.log(`[OrdersService] closeLatestAssignmentHistory`, { params });
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

  // ==================== Req 12: Client confirmation ====================

  // ==================== Req 49: Order Status History ====================
  private async recordStatusHistory(params: {
    orderId: string;
    fromStatus: OrderStatus | string | null;
    toStatus: OrderStatus | string;
    changedBy: string;
    reason?: string;
    comment?: string;
  }): Promise<void> {
    this.logger.log(`[OrdersService] recordStatusHistory`, { params });
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
    this.logger.log(`[OrdersService] applyCancellation`, {
      orderId: order.id,
      canceledBy,
      reason,
      comment,
      previousStatus,
      cancellationRequestId
    });
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

  /**
   * Сповіщає клієнта про завантажені фото «до» та просить підтвердити поховання.
   */
  /*private async notifyClientBeforePhotos(orderId: string, order: Parse.Object): Promise<void> {
    this.logger.log(`[OrdersService] notifyClientBeforePhotos`, { orderId });
    const clientTelegramId = order.get(OrderTable.Fields.TelegramId) as string | null;
    if (!clientTelegramId) return;

    const service = order.get(OrderTable.Fields.Service) as
      | { id: string; name: string; price: number }
      | undefined;
    const burialId = order.get(OrderTable.Fields.BurialId) as string | undefined;
    const photosBeforeBySlot: Record<string, string[]> =
      (order.get(OrderTable.Fields.ReportPhotosBeforeBySlot) as any) ?? {};

    // Надсилаємо всі 4 фото клієнту (організовано по слотах)
    const slotOrder = ['front', 'left', 'right', 'monument'];
    const slotNames: Record<string, string> = {
      front: 'Загальний вигляд спереду',
      left: 'Вигляд зліва',
      right: 'Вигляд справа',
      monument: 'Памʼятник крупним планом',
    };

    // Збираємо всі фото в один масив для відправки одним повідомленням (media group)
    const clientMediaGroup: any[] = [];
    for (const slotKey of slotOrder) {
      const photos = photosBeforeBySlot[slotKey] ?? [];
      for (const filePath of photos) {
        try {
          const buffer = await this.getImageBuffer(filePath);
          if (!buffer) continue;
          clientMediaGroup.push({
            type: 'photo',
            media: { source: buffer },
            caption: `📸 ${slotNames[slotKey] ?? slotKey}`,
          });
        } catch (e) {
          console.error(`Не вдалося підготувати фото ${filePath} для клієнта:`, e);
        }
      }
    }

    const CHUNK_SIZE = 10;
    for (let i = 0; i < clientMediaGroup.length; i += CHUNK_SIZE) {
      const chunk = clientMediaGroup.slice(i, i + CHUNK_SIZE);
      try {
        await this.clientBot.telegram.sendMediaGroup(clientTelegramId, chunk);
      } catch (e) {
        console.error('Не вдалося надіслати групу фото клієнту:', e);
      }
    }

    const text =
      `📸 <b>Фото «до» завантажено за замовленням №${orderId}</b>\n\n` +
      `📌 Послуга: ${service?.name ?? '—'}\n` +
      `🪦 Місце поховання: ${burialId ?? '—'}\n\n` +
      `Виконавець знайшов поховання та завантажив фото.\n` +
      `Будь ласка, підтвердьте, що це правильне поховання:`;

    const options = {
      parse_mode: 'HTML',
      reply_markup: {
        inline_keyboard: [
          [
            { text: 'Так, це правильне поховання', callback_data: `client_confirm_yes_${orderId}` },
            { text: 'Потрібне уточнення', callback_data: `client_confirm_clarify_${orderId}` },
          ],
          [
            { text: 'Додати послугу', callback_data: `client_confirm_addservice_${orderId}` },
          ],
        ],
      },
    };

    try {
      await this.clientBot.telegram.sendMessage(clientTelegramId, text, options as any);
    } catch (error) {
      console.error(`Не вдалося надіслати сповіщення клієнту ${clientTelegramId}:`, error);
    }
  }*/

  private mapOrderFields(order: Parse.Object) {
    // this.logger.log(`[OrdersService] mapOrderFields`, { orderId: order.id });
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
    return {
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
        photosBeforeBySlot: order.get(OrderTable.Fields.ReportPhotosBeforeBySlot) as
          | Record<string, string[]>
          | null,
        photosAfterBySlot: order.get(OrderTable.Fields.ReportPhotosAfterBySlot) as
          | Record<string, string[]>
          | null,
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
      checklist: order.get(OrderTable.Fields.Checklist) as { steps: ChecklistStep[] } | null,
      serviceChecklistId: order.get(OrderTable.Fields.ServiceChecklistId) as string | null,
      checklistVersion: order.get(OrderTable.Fields.ChecklistVersion) as number | null,
      clientConfirmedAt: order.get(OrderTable.Fields.ClientConfirmedAt) as Date | null,
      clientConfirmedBy: order.get(OrderTable.Fields.ClientConfirmedBy) as string | null,
      clientConfirmationResponse: order.get(OrderTable.Fields.ClientConfirmationResponse) as
        | string
        | null,
      beforePhotosConfirmedAt: order.get(OrderTable.Fields.BeforePhotosConfirmedAt) as Date | null,
      beforePhotosConfirmedBy: order.get(OrderTable.Fields.BeforePhotosConfirmedBy) as string | null,
      beforePhotosConfirmationResponse: order.get(OrderTable.Fields.BeforePhotosConfirmationResponse) as
        | string
        | null,
      checklistAnswers: order.get(OrderTable.Fields.ChecklistAnswers) as
        | Record<string, { answer: string; answeredAt: Date; answeredBy: string }>
        | null,
      checklistPhotos: order.get(OrderTable.Fields.ChecklistPhotos) as
        | Record<string, string[]>
        | null,
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
  }
}
