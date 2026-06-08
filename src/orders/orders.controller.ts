import { Controller, Get, Body, Post, Param, Patch } from '@nestjs/common';
import { OrdersService } from './orders.service';
import {
  ApiBody,
  ApiOperation,
  ApiParam,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import { CreateOrderDto } from './dto/create-order.dto';
import { UpdateOrderStatusDto } from './dto/update-order-status.dto';
import { UploadReportPhotosDto } from './dto/upload-report-photos.dto';

@ApiTags('Orders (Заявки)')
@Controller('orders')
export class OrdersController {
  constructor(private readonly ordersService: OrdersService) {}

  @Post()
  @ApiOperation({ summary: 'Створити нову заявку на догляд' })
  @ApiBody({ type: CreateOrderDto })
  @ApiResponse({ status: 201, description: 'Заявку успішно створено.' })
  @ApiResponse({ status: 400, description: 'Невалідні вхідні дані.' })
  create(@Body() createOrderDto: CreateOrderDto) {
    return this.ordersService.create(createOrderDto);
  }

  @Get()
  @ApiOperation({ summary: 'Отримати список усіх заявок' })
  @ApiResponse({ status: 200, description: 'Список заявок успішно отримано.' })
  findAll() {
    return this.ordersService.findAll();
  }

  @Get('telegram/:telegramId')
  @ApiOperation({
    summary: 'Отримати всі заявки конкретного користувача за його Telegram ID',
  })
  @ApiParam({
    name: 'telegramId',
    description: 'Унікальний ID користувача в Telegram',
    example: '423156789',
  })
  @ApiResponse({
    status: 200,
    description: 'Історію заявок користувача успішно отримано.',
  })
  findByTelegramId(@Param('telegramId') telegramId: string) {
    return this.ordersService.findByTelegramId(telegramId);
  }

  @Patch(':id/status')
  @ApiOperation({ summary: 'Змінити статус заявки (Адмін / Чат адмінів)' })
  @ApiParam({
    name: 'id',
    description: 'ID заявки в системі Back4app (objectId)',
    example: 'bpTq2hGMrI',
  })
  @ApiBody({ type: UpdateOrderStatusDto })
  @ApiResponse({ status: 200, description: 'Статус заявки успішно оновлено.' })
  @ApiResponse({ status: 404, description: 'Заявку з таким ID не знайдено.' })
  updateStatus(
    @Param('id') id: string,
    @Body() updateOrderStatusDto: UpdateOrderStatusDto,
  ) {
    return this.ordersService.updateStatus(id, updateOrderStatusDto.status);
  }

  @Post(':id/report')
  @ApiOperation({
    summary:
      'Завантажити фотозвіт "ДО" або "ПІСЛЯ" разом із коментарем (Виконавець)',
  })
  @ApiParam({
    name: 'id',
    description: 'ID заявки в системі Back4app (objectId)',
    example: 'bpTq2hGMrI',
  })
  @ApiBody({ type: UploadReportPhotosDto })
  @ApiResponse({
    status: 201,
    description:
      'Фотозвіт успішно завантажено в хмару Back4app, статус заявки змінено.',
  })
  @ApiResponse({
    status: 400,
    description: 'Помилка під час обробки або завантаження файлів.',
  })
  uploadReportPhotos(
    @Param('id') id: string,
    @Body() uploadReportPhotosDto: UploadReportPhotosDto,
  ) {
    return this.ordersService.uploadReportPhotos(
      id,
      uploadReportPhotosDto.type,
      uploadReportPhotosDto.files,
      uploadReportPhotosDto.adminComment,
    );
  }
}
