import { Controller, Get, Inject } from '@nestjs/common';
import { Permissions } from '../../common/decorators';
import { DashboardService } from './dashboard.service';

@Controller('dashboard')
export class DashboardController {
  constructor(@Inject(DashboardService) private readonly dashboard: DashboardService) {}

  @Get('overview')
  @Permissions('dashboard.read')
  overview() {
    return this.dashboard.overview();
  }
}
