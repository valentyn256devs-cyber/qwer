import { Module } from '@nestjs/common';
import { ServicesService } from './services.service';
import { ServicesController } from './services.controller';
import { Back4appService } from '../back4app/back4app.service';

@Module({
  providers: [ServicesService, Back4appService],
  controllers: [ServicesController],
  exports: [ServicesService],
})
export class ServicesModule {}
