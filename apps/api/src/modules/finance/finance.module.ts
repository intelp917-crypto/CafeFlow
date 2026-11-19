import { Module } from '@nestjs/common';
import { AuditModule } from '../audit/audit.module';
import { CashSessionsController } from './finance.controller';
import { FinanceService } from './finance.service';

@Module({
  imports: [AuditModule],
  controllers: [CashSessionsController],
  providers: [FinanceService],
})
export class FinanceModule {}
