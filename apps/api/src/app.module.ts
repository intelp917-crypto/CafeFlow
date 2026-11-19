import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { DatabaseModule } from './db/database.module';
import { ModuleGuard } from './common/guards/module.guard';
import { PermissionsGuard } from './common/guards/permissions.guard';
import { SessionGuard } from './common/guards/session.guard';
import { ApprovalsModule } from './modules/approvals/approvals.module';
import { AuditModule } from './modules/audit/audit.module';
import { AuthModule } from './modules/auth/auth.module';
import { CrmModule } from './modules/crm/crm.module';
import { DashboardModule } from './modules/dashboard/dashboard.module';
import { FinanceModule } from './modules/finance/finance.module';
import { HealthModule } from './modules/health/health.module';
import { InventoryModule } from './modules/inventory/inventory.module';
import { NotificationsModule } from './modules/notifications/notifications.module';
import { OrdersModule } from './modules/orders/orders.module';
import { PaymentsModule } from './modules/payments/payments.module';
import { PrintModule } from './modules/print/print.module';
import { ReservationsModule } from './modules/reservations/reservations.module';
import { ReportsModule } from './modules/reports/reports.module';
import { PublicModule } from './modules/public/public.module';
import { SettingsModule } from './modules/settings/settings.module';
import { UsersModule } from './modules/users/users.module';

@Module({
  imports: [
    DatabaseModule,
    AuditModule,
    AuthModule,
    HealthModule,
    DashboardModule,
    SettingsModule,
    UsersModule,
    ApprovalsModule,
    InventoryModule,
    PublicModule,
    OrdersModule,
    PaymentsModule,
    NotificationsModule,
    PrintModule,
    ReportsModule,
    ReservationsModule,
    FinanceModule,
    CrmModule,
  ],
  providers: [
    // Order matters: authenticate, then authorize permissions, then module gate.
    { provide: APP_GUARD, useClass: SessionGuard },
    { provide: APP_GUARD, useClass: PermissionsGuard },
    { provide: APP_GUARD, useClass: ModuleGuard },
  ],
})
export class AppModule {}
