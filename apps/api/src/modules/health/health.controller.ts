import { Controller, Get } from '@nestjs/common';
import { Public } from '../../common/decorators';
import { DB_SERVICE } from '../../common/tokens';
import { Inject } from '@nestjs/common';
import { DatabaseService } from '../../db/database.service';

@Controller()
export class HealthController {
  constructor(@Inject(DB_SERVICE) private readonly database: DatabaseService) {}

  @Public()
  @Get('health')
  health() {
    const databaseOk = this.database.ping();
    return {
      status: databaseOk ? 'ok' : 'degraded',
      database: databaseOk ? 'ok' : 'down',
      time: new Date().toISOString(),
      version: '0.1.0-phase1',
    };
  }
}
