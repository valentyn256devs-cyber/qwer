import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Back4appService } from '../back4app/back4app.service';
import * as Parse from 'parse/node';
import { OrderTable } from './models/order-table';
import { OrderStatus } from './models/order-status';
import { CreateOrderDto } from './dto/create-order.dto';

@Injectable()
export class OrdersService {
  private readonly orderClassName = OrderTable.TableName;
  private readonly serviceClassName = 'Service';

  constructor(private back4app: Back4appService) {}

  async create(createOrderDto: CreateOrderDto) {
    const {
      clientName,
      clientPhone,
      clientEmail,
      telegramId,
      serviceId,
      customComment,
      locationType,
      locationData,
      cemeteryDetails,
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
    order.set(OrderTable.Fields.CustomComment, customComment ?? '');
    order.set(OrderTable.Fields.LocationType, locationType);
    order.set(OrderTable.Fields.LocationData, locationData);
    order.set(OrderTable.Fields.CemeteryDetails, cemeteryDetails ?? '');

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
        order.set(OrderTable.Fields.Status, OrderStatus.AwaitingConfirmation); // Очікує підтвердження від клієнта
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

  private mapOrderFields(order: Parse.Object) {
    // const service = order.get(OrderTable.Fields.Service);
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
        customComment: order.get(OrderTable.Fields.CustomComment) as string,
        locationType: order.get(OrderTable.Fields.LocationType) as string,
        locationData: order.get(OrderTable.Fields.LocationData) as string,
        cemeteryDetails: order.get(OrderTable.Fields.CemeteryDetails) as string,
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
    };
  }
}
