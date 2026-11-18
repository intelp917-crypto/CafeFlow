import { Module } from '@nestjs/common';
import { AuditModule } from '../audit/audit.module';
import { OrdersRepository } from './orders.repository';
import { OrdersService } from './orders.service';
import { OrdersController, PrepController } from './orders.controller';
import { ServiceRequestsController, TablesController, TerminalRequestsController } from './operations.controller';

/**
 * Staff operations: order queue, preparation queue, live tables and customer
 * requests. Every route is permission-gated; the customer QR surface lives in
 * the public module instead.
 */
@Module({
  imports: [AuditModule],
  controllers: [
    OrdersController,
    PrepController,
    TablesController,
    ServiceRequestsController,
    TerminalRequestsController,
  ],
  providers: [OrdersRepository, OrdersService],
  exports: [OrdersService, OrdersRepository],
})
export class OrdersModule {}
