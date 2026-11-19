import { Body, Controller, Get, HttpCode, Inject, Param, Post, Query } from '@nestjs/common';
import {
  adjustStockSchema,
  createIngredientSchema,
  setRecipeSchema,
} from '@cafeflow/shared';
import { CurrentAuth, Permissions, RequireModule } from '../../common/decorators';
import { parseWith } from '../../common/errors';
import type { RequestAuth } from '../../common/tokens';
import { InventoryService } from './inventory.service';

/**
 * Inventory is an optional module and OFF by default. The module guard answers
 * 403 with a Persian explanation while it is disabled; enabling it never
 * re-creates or deletes data.
 */
@Controller('inventory')
@RequireModule('inventory')
export class InventoryController {
  constructor(@Inject(InventoryService) private readonly inventory: InventoryService) {}

  @Get('overview')
  @Permissions('inventory.read')
  overview() {
    return this.inventory.overview();
  }

  @Get('ingredients')
  @Permissions('inventory.read')
  ingredients() {
    return this.inventory.ingredients();
  }

  @Post('ingredients')
  @Permissions('inventory.write')
  createIngredient(@Body() body: unknown, @CurrentAuth() auth: RequestAuth) {
    return this.inventory.createIngredient(parseWith(createIngredientSchema, body), {
      userId: auth.userId,
      username: auth.username,
      permissions: auth.permissions,
    });
  }

  @Post('ingredients/:id/adjustments')
  @HttpCode(200)
  @Permissions('inventory.write')
  adjust(@Param('id') id: string, @Body() body: unknown, @CurrentAuth() auth: RequestAuth) {
    return this.inventory.adjust(id, parseWith(adjustStockSchema, body), {
      userId: auth.userId,
      username: auth.username,
      permissions: auth.permissions,
    });
  }

  @Get('movements')
  @Permissions('inventory.read')
  movements(@Query('limit') limit?: string) {
    const parsed = Number(limit);
    const safe = Number.isFinite(parsed) ? Math.min(Math.max(Math.trunc(parsed), 1), 200) : 60;
    return this.inventory.movements(safe);
  }

  @Get('recipes')
  @Permissions('inventory.read')
  recipes() {
    return this.inventory.recipes();
  }

  @Post('recipes/:productId')
  @HttpCode(200)
  @Permissions('inventory.write')
  setRecipe(@Param('productId') productId: string, @Body() body: unknown, @CurrentAuth() auth: RequestAuth) {
    return this.inventory.setRecipe(productId, parseWith(setRecipeSchema, body), {
      userId: auth.userId,
      username: auth.username,
      permissions: auth.permissions,
    });
  }
}
