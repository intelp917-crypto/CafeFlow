import { Module } from '@nestjs/common';
import { AuditModule } from '../audit/audit.module';
import { CashSessionsController } from './finance.controller';
import { FinanceAdminController } from './finance-admin.controller';
import { FinanceService } from './finance.service';

@Module({
  imports: [AuditModule],
  controllers: [CashSessionsController, FinanceAdminController],
  providers: [FinanceService],
})
export class FinanceModule {}
