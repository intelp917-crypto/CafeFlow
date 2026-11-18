import { Module } from '@nestjs/common';
import { AuditModule } from '../audit/audit.module';
import { OrdersModule } from '../orders/orders.module';
import { PaymentsRepository } from './payments.repository';
import { PaymentsService } from './payments.service';
import { OrderPaymentsController, TerminalSettlementController } from './payments.controller';

/**
 * Bills, payments and terminal settlement. Depends on the orders module for the
 * status machine so a payment cannot move an order outside its legal path.
 */
@Module({
  imports: [AuditModule, OrdersModule],
  controllers: [OrderPaymentsController, TerminalSettlementController],
  providers: [PaymentsRepository, PaymentsService],
  exports: [PaymentsService],
})
export class PaymentsModule {}
