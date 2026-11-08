import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Back4appService } from '../back4app/back4app.service';
import * as Parse from 'parse/node';
import { OrderTable } from './models/order-table';
import { OrderRevisionTable } from './models/order-revision-table';
import { OrderStatus, UnassignReason } from './models/order-status';
import { CreateOrderDto } from './dto/create-order.dto';
import {InjectBot} from "nestjs-telegraf";
import {mainMenuButtons, TelegramBot} from "../telegram-bot/telegram-constants";
import {Context, Telegraf} from "telegraf";

@Injectable()
export class OrdersService {
  private readonly orderClassName = OrderTable.TableName;
  private readonly serviceClassName = 'Service';

  constructor(
    private back4app: Back4appService,
              @InjectBot(TelegramBot.ClientBot)
              private readonly clientBot: Telegraf<Context>
  ) {}

  async create(createOrderDto: CreateOrderDto) {
    const {
      clientName,
      clientPhone,
      clientEmail,
      telegramId,
      serviceId,
      // customComment,
      // locationType,
      // locationData,
      // cemeteryDetails,
      burialId,
    } = createOrderDto;

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
    // order.set(OrderTable.Fields.CustomComment, customComment ?? '');
    // order.set(OrderTable.Fields.LocationType, locationType);
    // order.set(OrderTable.Fields.LocationData, locationData);
    // order.set(OrderTable.Fields.CemeteryDetails, cemeteryDetails ?? '');
    order.set(OrderTable.Fields.BurialId, burialId ?? '');

    // Ініціалізуємо порожні масиви для майбутніх фотозвітів
    order.set(OrderTable.Fields.ClientPhotos, []);
    order.set(OrderTable.Fields.ReportPhotosBefore, []);
    order.set(OrderTable.Fields.ReportPhotosAfter, []);
    order.set(OrderTable.Fields.AdminComment, '');

    const savedOrder = await order.save();

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

  async updateStatus(id: string, status: OrderStatus) {
    const query = new this.back4app.parse.Query(this.orderClassName);
    try {
      const order = await query.get(id);
      order.set(OrderTable.Fields.Status, status);
      const updatedOrder = await order.save();
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
      const order = await query.get(id);
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

    return updatedOrder;
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
    query.descending('createdAt');

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
      const order = await query.get(orderId);
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
      const order = await query.get(orderId);
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
    const query = new Parse.Query(this.orderClassName);
    try {
      const order = await query.get(orderId);
      const currentStatus = order.get(OrderTable.Fields.Status) as OrderStatus;
      const currentExecutor = order.get(OrderTable.Fields.AssignedExecutorId) as string | null;
      if (currentStatus !== OrderStatus.AvailableForExecutor || currentExecutor) {
        throw new BadRequestException('Замовлення вже прийняте іншим виконавцем');
      }
      order.set(OrderTable.Fields.AssignedExecutorId, executorId);
      order.set(OrderTable.Fields.AssignedBy, assignedBy);
      order.set(OrderTable.Fields.AssignedAt, new Date());
      order.set(OrderTable.Fields.Status, OrderStatus.Assigned);
      const updated = await order.save();
      return this.mapOrderFields(updated);
    } catch (error) {
      throw new BadRequestException(`Помилка призначення: ${(error as Error).message}`);
    }
  }

  /**
   * ➖ Unassign Executor
   * Причина обов'язкова. Після Unassign: assignedExecutorId = null, status = AvailableForExecutor.
   */
  async unassignExecutor(orderId: string, adminId: string, reason: UnassignReason) {
    const query = new Parse.Query(this.orderClassName);
    try {
      const order = await query.get(orderId);
      const currentExecutor = order.get(OrderTable.Fields.AssignedExecutorId) as string | null;
      if (!currentExecutor) {
        throw new BadRequestException('На замовленні немає призначеного виконавця');
      }
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
  async changeExecutor(orderId: string, newExecutorId: string, adminId: string) {
    const query = new Parse.Query(this.orderClassName);
    try {
      const order = await query.get(orderId);
      const currentExecutor = order.get(OrderTable.Fields.AssignedExecutorId) as string | null;
      if (!currentExecutor) {
        throw new BadRequestException('На замовленні немає призначеного виконавця для заміни');
      }
      if (currentExecutor === newExecutorId) {
        throw new BadRequestException('Новий виконавець співпадає з поточним');
      }
      order.set(OrderTable.Fields.AssignedExecutorId, newExecutorId);
      order.set(OrderTable.Fields.AssignedBy, adminId);
      order.set(OrderTable.Fields.AssignedAt, new Date());
      const updated = await order.save();
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
      const order = await query.get(orderId);
      const currentExecutor = order.get(OrderTable.Fields.AssignedExecutorId) as string | null;
      if (currentExecutor === adminId) {
        throw new BadRequestException('Ви вже є виконавцем цього замовлення');
      }
      order.set(OrderTable.Fields.AssignedExecutorId, adminId);
      order.set(OrderTable.Fields.AssignedBy, adminId);
      order.set(OrderTable.Fields.AssignedAt, new Date());
      const currentStatus = order.get(OrderTable.Fields.Status) as OrderStatus;
      if (currentStatus === OrderStatus.AvailableForExecutor) {
        order.set(OrderTable.Fields.Status, OrderStatus.Assigned);
      }
      const updated = await order.save();
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
      const order = await query.get(orderId);
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
      const order = await query.get(orderId);
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
      const order = await query.get(orderId);
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
      const order = await query.get(id);
      return this.mapOrderFields(order);
    } catch {
      return null;
    }
  }

  private mapOrderFields(order: Parse.Object) {
    const service = order.get(OrderTable.Fields.Service) as
      | Parse.Object
      | undefined;

    // Функція для отримання прямих посилань на фото з хмари
    const getUrls = (filesArray: Parse.File[] | undefined): string[] => {
      if (!filesArray) return [];
      return filesArray.map((file) => file.url());
    };

    return {
      id: order.id,
      status: order.get(OrderTable.Fields.Status) as OrderStatus,
      createdAt: order.createdAt,
      updatedAt: order.updatedAt,
      burialName: order.get('name') as string, // burialName
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
        // customComment: order.get(OrderTable.Fields.CustomComment) as string,
        // locationType: order.get(OrderTable.Fields.LocationType) as string,
        // locationData: order.get(OrderTable.Fields.LocationData) as string,
        // cemeteryDetails: order.get(OrderTable.Fields.CemeteryDetails) as string,
        burialId: order.get(OrderTable.Fields.BurialId) as string,
      },
      report: {
        clientPhotos: getUrls(
          order.get(OrderTable.Fields.ClientPhotos) as Parse.File[] | undefined,
        ),
        photosBefore: getUrls(
          order.get(OrderTable.Fields.ReportPhotosBefore) as
            | Parse.File[]
            | undefined,
        ),
        photosAfter: getUrls(
          order.get(OrderTable.Fields.ReportPhotosAfter) as
            | Parse.File[]
            | undefined,
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
        executionDeadline: order.get(OrderTable.Fields.ExecutionDeadline) as Date | null,
      },
      executorComment: order.get(OrderTable.Fields.ExecutorComment) as string | null,
    };
  }
}
