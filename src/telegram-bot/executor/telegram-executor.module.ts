import { Module } from '@nestjs/common';
import { TelegramExecutorListener } from './telegram-executor-listener';
import { OrdersModule } from '../../orders/orders.module';
import { ServicesModule } from '../../services/services.module';
import { BurialsModule } from '../../burials/burials.module';
import { PerformersModule } from '../../performers/performers.module';
import { OpenOrdersScene } from './scenes/open-orders.scene';
import { MyOrdersScene } from './scenes/my-orders.scene';
import { DoneOrdersScene } from './scenes/done-orders.scene';
import { AcceptOrderScene } from './scenes/accept-order.scene';
import { OrderDetailsScene } from './scenes/order-details.scene';
import { SearchVerifyScene } from './scenes/search-verify.scene';
import { BeforePhotosScene } from './scenes/before-photos.scene';
import { ServiceChecklistScene } from './scenes/service-checklist.scene';
import { FinalSelfcheckScene } from './scenes/final-selfcheck.scene';
import { AfterPhotosScene } from './scenes/after-photos.scene';
import { SubmitScene } from './scenes/submit.scene';
import { RevisionScene } from './scenes/revision.scene';
import { CreatePerformerScene } from '../performer/scene/create-performer.scene';

@Module({
  imports: [OrdersModule, ServicesModule, BurialsModule, PerformersModule],
  providers: [
    TelegramExecutorListener,
    OpenOrdersScene,
    MyOrdersScene,
    DoneOrdersScene,
    AcceptOrderScene,
    OrderDetailsScene,
    SearchVerifyScene,
    BeforePhotosScene,
    ServiceChecklistScene,
    FinalSelfcheckScene,
    AfterPhotosScene,
    SubmitScene,
    RevisionScene,
    CreatePerformerScene,
  ],
})
export class TelegramExecutorModule {}
