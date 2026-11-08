import { Module } from '@nestjs/common';
import { BurialsService } from './burials.service';
import { BurialsController } from './burials.controller';
import { MemoryPlaceUpdateRequestService } from './memory-place-update-request.service';
import { MemoryPlaceUpdateRequestController } from './memory-place-update-request.controller';
import {Back4appService} from "../back4app/back4app.service";

@Module({
  controllers: [BurialsController, MemoryPlaceUpdateRequestController],
  providers: [Back4appService, BurialsService, MemoryPlaceUpdateRequestService],
  exports: [BurialsService, MemoryPlaceUpdateRequestService],
})
export class BurialsModule {}