import { Module } from '@nestjs/common';
import { OrdersModule } from '../orders/orders.module';
import { PrintRepository } from './print.repository';
import { PrintService } from './print.service';
import { OrderReceiptController, PrintJobsController } from './print.controller';

@Module({
  imports: [OrdersModule],
  controllers: [OrderReceiptController, PrintJobsController],
  providers: [PrintRepository, PrintService],
  exports: [PrintService],
})
export class PrintModule {}
