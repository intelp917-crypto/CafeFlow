import { Module } from '@nestjs/common';
import { AuditModule } from '../audit/audit.module';
import { InventoryModule } from '../inventory/inventory.module';
import { PublicModule } from '../public/public.module';
import { OrdersRepository } from './orders.repository';
import { OrdersService } from './orders.service';
import { OrdersController, PrepController } from './orders.controller';
import { ServiceRequestsController, TablesController, TerminalRequestsController } from './operations.controller';

/**
 * Staff operations: order queue, preparation queue, live tables and customer
 * requests. Every route is permission-gated; the customer QR surface lives in
 * the public module instead. Inventory is imported so a cancellation can put
 * deducted ingredients back in the same transaction.
 */
@Module({
  imports: [AuditModule, InventoryModule, PublicModule],
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
