import { Controller, Post, Get, Body, Param } from '@nestjs/common';
import { BurialsService } from './burials.service';
import { CreateBurialDto } from './dto/create-burial.dto';

@Controller('burials')
export class BurialsController {
  constructor(private readonly burialsService: BurialsService) {}

  @Post()
  async create(@Body() dto: CreateBurialDto) {
    return this.burialsService.create(dto);
  }

  @Get('user/:telegramId')
  async getByUser(@Param('telegramId') telegramId: string) {
    return this.burialsService.findByTelegramId(telegramId);
  }

  @Get(':id')
  async getOne(@Param('id') id: string) {
    return this.burialsService.findOne(id);
  }
}