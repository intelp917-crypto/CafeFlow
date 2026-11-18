import { Controller, Get, Inject } from '@nestjs/common';
import { DB_SERVICE, type RequestAuth } from '../../common/tokens';
import { CurrentAuth, Permissions, RequireModule } from '../../common/decorators';
import { DatabaseService } from '../../db/database.service';

/**
 * Inventory is an optional module and OFF by default. This endpoint exists in
 * Phase 1 to prove the module gate end to end: it answers 403 with a Persian
 * explanation while the module is disabled and returns real (currently empty)
 * stock counters once it is enabled.
 */
@Controller('inventory')
@RequireModule('inventory')
export class InventoryController {
  constructor(@Inject(DB_SERVICE) private readonly database: DatabaseService) {}

  @Get('overview')
  @Permissions('inventory.read')
  overview(@CurrentAuth() _auth: RequestAuth) {
    return {
      ingredients: this.database.count('SELECT COUNT(*) AS n FROM ingredients WHERE is_active = 1'),
      lowStock: this.database.count(
        'SELECT COUNT(*) AS n FROM ingredients WHERE is_active = 1 AND current_qty <= min_qty',
      ),
      suppliers: this.database.count('SELECT COUNT(*) AS n FROM suppliers WHERE is_active = 1'),
      movementsToday: this.database.count(
        `SELECT COUNT(*) AS n FROM stock_movements
          WHERE created_at >= strftime('%Y-%m-%dT00:00:00.000Z', 'now')`,
      ),
    };
  }
}
