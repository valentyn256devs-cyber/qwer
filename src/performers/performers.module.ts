import { Module } from '@nestjs/common';
import { PerformersService } from './performers.service';
import { Back4appService } from '../back4app/back4app.service';

@Module({
  providers: [PerformersService, Back4appService],
  exports: [PerformersService],
})
export class PerformersModule {}