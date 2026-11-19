import { Module } from '@nestjs/common';
import { AuditModule } from '../audit/audit.module';
import { LayoutController } from './layout.controller';
import { LayoutRepository } from './layout.repository';
import { LayoutService } from './layout.service';

@Module({
  imports: [AuditModule],
  controllers: [LayoutController],
  providers: [LayoutRepository, LayoutService],
})
export class LayoutModule {}
