import {
  Controller,
  Post,
  Get,
  Body,
  Param,
  Query,
  Headers,
  NotFoundException,
} from '@nestjs/common';
import { MemoryPlaceUpdateRequestService } from './memory-place-update-request.service';
import { ProposeMemoryPlaceUpdateDto } from './dto/propose-memory-place-update.dto';
import { ReviewMemoryPlaceUpdateDto } from './dto/review-memory-place-update.dto';
import { MemoryPlaceUpdateStatus } from './models/memory-place-update-request-table';

@Controller('memory-place-update-requests')
export class MemoryPlaceUpdateRequestController {
  constructor(
    private readonly service: MemoryPlaceUpdateRequestService,
  ) {}

  /**
   * Виконавець пропонує оновлення Memory Place.
   * Статус запиту стає AwaitingAdminApproval.
   */
  @Post('propose')
  async propose(
    @Body() dto: ProposeMemoryPlaceUpdateDto,
    @Headers('x-user-id') executorId: string,
  ) {
    if (!executorId) {
      throw new NotFoundException('Не вказано ідентифікатора виконавця (x-user-id)');
    }
    return this.service.proposeUpdate(dto, executorId);
  }

  /**
   * Адмін переглядає запит і приймає рішення:
   * Погодити (AwaitingClientApproval) / Відхилити (RejectedByAdmin) / Запросити уточнення (PendingClarification).
   * Адмін бачить diff: поточне vs пропоноване.
   */
  @Post(':id/admin-review')
  async adminReview(
    @Param('id') id: string,
    @Body() dto: ReviewMemoryPlaceUpdateDto,
    @Headers('x-user-id') adminId: string,
  ) {
    if (!adminId) {
      throw new NotFoundException('Не вказано ідентифікатора адміністратора (x-user-id)');
    }
    return this.service.adminReview(id, dto, adminId);
  }

  /**
   * Клієнт переглядає лише запропоновані зміни і приймає рішення:
   * Підтвердити зміни (Approved) / Відхилити (RejectedByClient) / Уточнити (PendingClarification).
   * Тільки після Client Approval основна Memory Place змінюється.
   */
  @Post(':id/client-review')
  async clientReview(
    @Param('id') id: string,
    @Body() dto: ReviewMemoryPlaceUpdateDto,
    @Headers('x-user-id') clientId: string,
  ) {
    if (!clientId) {
      throw new NotFoundException('Не вказано ідентифікатора клієнта (x-user-id)');
    }
    return this.service.clientReview(id, dto, clientId);
  }

  /**
   * Diff для адміністратора: поле / поточне / пропоноване.
   */
  @Get(':id/diff')
  async getDiff(@Param('id') id: string) {
    return this.service.getDiff(id);
  }

  /**
   * Отримати один запит на оновлення за ID.
   */
  @Get(':id')
  async getOne(@Param('id') id: string) {
    return this.service.getRequestViewById(id);
  }

  /**
   * Список запитів з опціональними фільтрами:
   * ?memoryPlaceId=...&status=...&proposedBy=...
   */
  @Get()
  async list(
    @Query('memoryPlaceId') memoryPlaceId?: string,
    @Query('status') status?: MemoryPlaceUpdateStatus,
    @Query('proposedBy') proposedBy?: string,
  ) {
    return this.service.listRequests({ memoryPlaceId, status, proposedBy });
  }

  /**
   * Історія версій Memory Place (попередня / нова версія, виконавець, адмін, клієнт, Order ID, час).
   */
  @Get('memory-place/:memoryPlaceId/versions')
  async listVersions(@Param('memoryPlaceId') memoryPlaceId: string) {
    return this.service.listVersions(memoryPlaceId);
  }
}
