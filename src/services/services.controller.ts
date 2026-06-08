import { Controller, Get, Param } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiParam } from '@nestjs/swagger';
import { ServicesService } from './services.service';

@ApiTags('Services (Послуги)')
@Controller('services')
export class ServicesController {
  constructor(private readonly servicesService: ServicesService) {}

  @Get()
  @ApiOperation({ summary: 'Отримати список усіх доступних послуг' })
  @ApiResponse({ status: 200, description: 'Список послуг успішно отримано.' })
  findAll() {
    return this.servicesService.findAll();
  }

  @Get(':id')
  @ApiOperation({
    summary: 'Отримати детальну інформацію про послугу за її ID',
  })
  @ApiParam({
    name: 'id',
    description: 'ID послуги в системі Back4app (objectId)',
    example: 'a1B2c3D4eF',
  })
  @ApiResponse({ status: 200, description: 'Послугу успішно знайдено.' })
  @ApiResponse({ status: 404, description: 'Послугу з таким ID не знайдено.' })
  findOne(@Param('id') id: string) {
    return this.servicesService.findOne(id);
  }
}
