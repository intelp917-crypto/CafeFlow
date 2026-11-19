import { Module } from '@nestjs/common';
import { AuditModule } from '../audit/audit.module';
import { ReservationsRepository } from './reservations.repository';
import { ReservationsService } from './reservations.service';
import { ReservationsController } from './reservations.controller';

@Module({
  imports: [AuditModule],
  controllers: [ReservationsController],
  providers: [ReservationsRepository, ReservationsService],
})
export class ReservationsModule {}
