import { Module } from '@nestjs/common';
import { BurialsService } from './burials.service';
import { BurialsController } from './burials.controller';
import {Back4appService} from "../back4app/back4app.service";

@Module({
  controllers: [BurialsController],
  providers: [Back4appService, BurialsService],
  exports: [BurialsService],
})
export class BurialsModule {}