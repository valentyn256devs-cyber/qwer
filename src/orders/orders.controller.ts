import { Controller, Get, Body, Post, Param, Patch, Query } from '@nestjs/common';
import { OrdersService } from './orders.service';
import {
  ApiBody,
  ApiOperation,
  ApiParam,
  ApiQuery,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import { CreateOrderDto } from './dto/create-order.dto';
import { UpdateOrderStatusDto } from './dto/update-order-status.dto';
import { UploadReportPhotosDto } from './dto/upload-report-photos.dto';
import {
  CancelOrderDto,
  RequestCancellationDto,
  ReportExecutorInabilityDto,
  ReviewCancellationRequestDto,
} from './dto/cancel-order.dto';

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

  // ==================== Req 41-47: Cancellation ====================

  @Post(':id/client-cancel')
  @ApiOperation({ summary: 'Скасування замовлення клієнтом (напряму або через запит залежно від етапу)' })
  @ApiParam({ name: 'id', description: 'ID замовлення' })
  @ApiQuery({ name: 'telegramId', required: true, description: 'Telegram ID клієнта' })
  @ApiBody({ type: CancelOrderDto })
  clientCancel(
    @Param('id') id: string,
    @Query('telegramId') telegramId: string,
    @Body() dto: CancelOrderDto,
  ) {
    return this.ordersService.clientCancelOrder(id, telegramId, dto.reason, dto.comment);
  }

  @Post(':id/cancellation-request')
  @ApiOperation({ summary: 'Створити запит на скасування (після призначення виконавця)' })
  @ApiParam({ name: 'id', description: 'ID замовлення' })
  @ApiQuery({ name: 'requestedBy', required: true, description: 'Хто створює запит (наприклад client:<telegramId>)' })
  @ApiBody({ type: RequestCancellationDto })
  requestCancellation(
    @Param('id') id: string,
    @Query('requestedBy') requestedBy: string,
    @Body() dto: RequestCancellationDto,
  ) {
    return this.ordersService.createCancellationRequest(id, requestedBy, dto.reason, dto.comment);
  }

  @Post(':id/executor-inability')
  @ApiOperation({ summary: 'Виконавець повідомляє, що не може виконати замовлення (Req 43)' })
  @ApiParam({ name: 'id', description: 'ID замовлення' })
  @ApiQuery({ name: 'executorId', required: true, description: 'ID виконавця' })
  @ApiBody({ type: ReportExecutorInabilityDto })
  reportExecutorInability(
    @Param('id') id: string,
    @Query('executorId') executorId: string,
    @Body() dto: ReportExecutorInabilityDto,
  ) {
    return this.ordersService.reportExecutorInability(id, executorId, dto.reason, dto.comment);
  }

  @Post(':id/admin-cancel')
  @ApiOperation({ summary: 'Скасування замовлення адміністратором (Req 44,46)' })
  @ApiParam({ name: 'id', description: 'ID замовлення' })
  @ApiQuery({ name: 'adminId', required: true, description: 'ID адміністратора' })
  @ApiBody({ type: CancelOrderDto })
  adminCancel(
    @Param('id') id: string,
    @Query('adminId') adminId: string,
    @Body() dto: CancelOrderDto,
  ) {
    return this.ordersService.adminCancelOrder(id, adminId, dto.reason, dto.comment, dto.commentForClient);
  }

  @Patch('cancellation-requests/:requestId/review')
  @ApiOperation({ summary: 'Розгляд запиту на скасування адміністратором (Req 45)' })
  @ApiParam({ name: 'requestId', description: 'ID запиту на скасування' })
  @ApiQuery({ name: 'adminId', required: true, description: 'ID адміністратора' })
  @ApiBody({ type: ReviewCancellationRequestDto })
  reviewCancellationRequest(
    @Param('requestId') requestId: string,
    @Query('adminId') adminId: string,
    @Body() dto: ReviewCancellationRequestDto,
  ) {
    return this.ordersService.reviewCancellationRequest(requestId, adminId, dto.decision, dto.decisionComment);
  }
}
