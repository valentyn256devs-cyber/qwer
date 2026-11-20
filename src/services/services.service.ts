import { Injectable, OnApplicationBootstrap, Logger } from '@nestjs/common';
import { Back4appService } from '../back4app/back4app.service';
import * as Parse from 'parse/node';
import { ServiceTable } from './models/service-table';
import { MockServices } from './models/mock-services';
import { ServiceResponseDto } from './dto/service-response.dto';

@Injectable()
export class ServicesService implements OnApplicationBootstrap {
  private readonly logger = new Logger(ServicesService.name);
  private readonly serviceClassName = ServiceTable.TableName;

  constructor(private readonly _back4app: Back4appService) {
    // Ініціалізація Back4appService відбувається глобально для модуля Parse
  }

  // Автоматичне заповнення тестовими даними при старті додатка
  async onApplicationBootstrap() {
    this.logger.log(`[ServicesService] onApplicationBootstrap`);
    try {
      const query = new Parse.Query(this.serviceClassName);
      const count = await query.count();

      if (count === 0) {
        this.logger.log(
          'База даних послуг порожня. Заповнюємо тестовими даними...',
        );

        for (const item of MockServices) {
          const service = new Parse.Object(this.serviceClassName);
          service.set(ServiceTable.Fields.Name, item.name);
          service.set(ServiceTable.Fields.Description, item.description);
          service.set(ServiceTable.Fields.Price, item.price);
          await service.save();
        }
        this.logger.log('✅ 5 тестових послуг успішно додано в Back4app!');
      }
    } catch (error) {
      this.logger.error('Помилка під час бутстрапу послуг:', error);
    }
  }

  // REST API: Отримати всі послуги
  async findAll() {
    this.logger.log(`[ServicesService] findAll`);
    try {
      const query = new Parse.Query(this.serviceClassName);
      query.ascending('price');

      const results = await query.find();
      return results.map((s) => this.mapServiceFields(s));
    } catch (error) {
      this.logger.error('Не вдалося отримати список послуг:', error);
      throw error;
    }
  }

  // REST API: Отримати одну послугу за ID
  async findOne(id: string) {
    this.logger.log(`[ServicesService] findOne`, { id });
    const query = new Parse.Query(this.serviceClassName);
    try {
      const service = await query.get(id);
      return this.mapServiceFields(service);
    } catch (error) {
      this.logger.error(error);
      throw new Error(`Послугу з ID ${id} не знайдено`);
    }
  }

  /**
   * Допоміжний метод для строгої типізації та мапінгу Parse.Object
   */
  private mapServiceFields(service: Parse.Object) {
    this.logger.log(`[ServicesService] mapServiceFields`, { serviceId: service.id });
    return ServiceResponseDto.fromParse(service);
  }
}
