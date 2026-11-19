import { randomUUID } from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';
import {
  STOCK_MOVEMENT_LABELS_FA,
  type AdjustStockInput,
  type CreateIngredientInput,
  type IngredientRow,
  type IngredientsResponse,
  type RecipeView,
  type SetRecipeInput,
  type StockMovementRow,
} from '@cafeflow/shared';
import { DB_SERVICE } from '../../common/tokens';
import { DatabaseService } from '../../db/database.service';
import { AuditService } from '../audit/audit.service';
import { badRequest, notFound } from '../../common/errors';
import { InventoryRepository } from './inventory.repository';
import type { ActingUser } from '../orders/orders.service';

const round3 = (value: number) => Math.round(value * 1000) / 1000;

/**
 * Inventory is an optional module (OFF by default).
 *
 * While it is disabled every stock write is a no-op, so the core ordering path
 * keeps working unchanged and existing stock rows are never deleted. Enabling
 * it later starts deducting again from the quantities recorded so far.
 */
@Injectable()
export class InventoryService {
  constructor(
    @Inject(DB_SERVICE) private readonly database: DatabaseService,
    @Inject(InventoryRepository) private readonly repository: InventoryRepository,
    @Inject(AuditService) private readonly audit: AuditService,
  ) {}

  isEnabled(): boolean {
    return this.repository.isModuleEnabled();
  }

  overview() {
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

  ingredients(): IngredientsResponse {
    const items = this.repository.ingredients();
    return {
      items,
      summary: {
        total: items.length,
        low: items.filter((item) => item.isLow && item.currentQty > 0).length,
        out: items.filter((item) => item.currentQty <= 0).length,
      },
    };
  }

  createIngredient(input: CreateIngredientInput, actor: ActingUser): IngredientRow {
    const id = randomUUID();
    let unitId: string | null = null;

    this.database.transaction(() => {
      if (input.unitSymbol) {
        const existing = this.repository.findUnitBySymbol(input.unitSymbol);
        if (existing) {
          unitId = existing.id;
        } else {
          unitId = randomUUID();
          this.repository.insertUnit(unitId, input.unitSymbol);
        }
      }

      this.repository.insertIngredient({
        id,
        nameFa: input.nameFa,
        unitId,
        currentQty: input.currentQty,
        minQty: input.minQty,
        costPerUnit: input.costPerUnit,
      });

      if (input.currentQty > 0) {
        this.repository.insertMovement({
          id: randomUUID(),
          ingredientId: id,
          type: 'adjustment',
          qty: input.currentQty,
          note: 'موجودی اولیه',
          createdByUserId: actor.userId,
        });
      }
    });

    this.audit.record({
      actorUserId: actor.userId,
      actorUsername: actor.username,
      action: 'inventory.ingredient_created',
      entityType: 'ingredient',
      entityId: id,
      after: { nameFa: input.nameFa, currentQty: input.currentQty, unitSymbol: input.unitSymbol ?? null },
    });

    const created = this.repository.findIngredient(id);
    if (!created) throw notFound('ماده اولیه ثبت نشد.', 'INGREDIENT_NOT_CREATED');
    return {
      id: created.id,
      nameFa: created.name_fa,
      unitSymbol: created.unit_symbol,
      currentQty: round3(created.current_qty),
      minQty: created.min_qty,
      costPerUnit: created.cost_per_unit,
      isActive: created.is_active === 1,
      isLow: created.current_qty <= created.min_qty,
    };
  }

  adjust(ingredientId: string, input: AdjustStockInput, actor: ActingUser): IngredientRow {
    const ingredient = this.repository.findIngredient(ingredientId);
    if (!ingredient) throw notFound('ماده اولیه یافت نشد.', 'INGREDIENT_NOT_FOUND');

    const next = round3(ingredient.current_qty + input.delta);
    if (next < 0) {
      throw badRequest(
        `موجودی «${ingredient.name_fa}» کافی نیست؛ موجودی فعلی ${round3(ingredient.current_qty)} است.`,
        'INSUFFICIENT_STOCK',
        { currentQty: round3(ingredient.current_qty), delta: input.delta },
      );
    }

    this.database.transaction(() => {
      this.repository.addStock(ingredientId, input.delta);
      this.repository.insertMovement({
        id: randomUUID(),
        ingredientId,
        type: 'adjustment',
        qty: input.delta,
        note: input.reason,
        createdByUserId: actor.userId,
      });
    });

    this.audit.record({
      actorUserId: actor.userId,
      actorUsername: actor.username,
      action: 'inventory.stock_adjusted',
      entityType: 'ingredient',
      entityId: ingredientId,
      before: { currentQty: round3(ingredient.current_qty) },
      after: { currentQty: next, delta: input.delta, reason: input.reason },
    });

    const updated = this.repository.findIngredient(ingredientId);
    if (!updated) throw notFound('ماده اولیه یافت نشد.', 'INGREDIENT_NOT_FOUND');
    return {
      id: updated.id,
      nameFa: updated.name_fa,
      unitSymbol: updated.unit_symbol,
      currentQty: round3(updated.current_qty),
      minQty: updated.min_qty,
      costPerUnit: updated.cost_per_unit,
      isActive: updated.is_active === 1,
      isLow: updated.current_qty <= updated.min_qty,
    };
  }

  movements(limit: number): { items: StockMovementRow[] } {
    return {
      items: this.repository.movements(limit).map((item) => ({
        ...item,
        typeLabelFa: STOCK_MOVEMENT_LABELS_FA[item.type] ?? item.type,
      })),
    };
  }

  recipes(): { items: RecipeView[] } {
    const items = this.repository.recipes().map((recipe) => ({
      productId: recipe.product_id,
      productNameFa: recipe.product_name_fa,
      yieldQty: recipe.yield_qty,
      items: this.repository.recipeItems(recipe.recipe_id),
    }));
    return { items };
  }

  setRecipe(productId: string, input: SetRecipeInput, actor: ActingUser): RecipeView {
    if (!this.repository.productExists(productId)) {
      throw notFound('محصول یافت نشد.', 'PRODUCT_NOT_FOUND');
    }

    for (const item of input.items) {
      if (!this.repository.findIngredient(item.ingredientId)) {
        throw badRequest('یکی از مواد اولیه انتخاب‌شده یافت نشد.', 'INGREDIENT_NOT_FOUND');
      }
    }

    const existing = this.repository.findRecipeByProduct(productId);
    const recipeId = existing?.id ?? randomUUID();

    this.database.transaction(() => {
      this.repository.upsertRecipe(recipeId, productId, input.yieldQty);
      const stored = this.repository.findRecipeByProduct(productId);
      const id = stored?.id ?? recipeId;
      this.repository.deleteRecipeItems(id);
      for (const item of input.items) {
        this.repository.insertRecipeItem(randomUUID(), id, item.ingredientId, item.qty);
      }
    });

    this.audit.record({
      actorUserId: actor.userId,
      actorUsername: actor.username,
      action: 'inventory.recipe_updated',
      entityType: 'product',
      entityId: productId,
      after: { yieldQty: input.yieldQty, itemCount: input.items.length },
    });

    const stored = this.repository.findRecipeByProduct(productId);
    const id = stored?.id ?? recipeId;
    const product = this.database.get<{ name_fa: string }>('SELECT name_fa FROM products WHERE id = ?', [productId]);
    return {
      productId,
      productNameFa: product?.name_fa ?? productId,
      yieldQty: stored?.yield_qty ?? input.yieldQty,
      items: this.repository.recipeItems(id),
    };
  }

  /**
   * Deducts every recipe ingredient for an order's items. Called from inside
   * the order-creation transaction; a repeated call for the same order is a
   * no-op because a `sale_deduction` row already exists.
   */
  deductForOrder(orderId: string): number {
    if (!this.isEnabled()) return 0;
    if (this.repository.deductionCount(orderId) > 0) return 0;

    let deductible = 0;
    for (const item of this.repository.orderItems(orderId)) {
      if (!item.product_id) continue;
      for (const ingredient of this.repository.productRecipe(item.product_id)) {
        const yieldQty = ingredient.yield_qty > 0 ? ingredient.yield_qty : 1;
        const qty = round3((ingredient.qty / yieldQty) * item.quantity);
        if (qty <= 0) continue;

        this.repository.addStock(ingredient.ingredient_id, -qty);
        this.repository.insertMovement({
          id: randomUUID(),
          ingredientId: ingredient.ingredient_id,
          type: 'sale_deduction',
          qty: -qty,
          refType: 'order',
          refId: orderId,
          note: 'کسر خودکار بابت فروش',
        });
        deductible += 1;
      }
    }
    return deductible;
  }

  /**
   * Restores stock that was deducted for an order (cancellation). Only the net
   * deducted amount is returned, so calling this twice cannot inflate stock.
   */
  restoreForOrder(orderId: string): number {
    if (!this.isEnabled()) return 0;

    let restored = 0;
    for (const row of this.repository.orderNetMovements(orderId)) {
      if (row.net >= 0) continue;
      const qty = round3(-row.net);

      this.repository.addStock(row.ingredient_id, qty);
      this.repository.insertMovement({
        id: randomUUID(),
        ingredientId: row.ingredient_id,
        type: 'restore',
        qty,
        refType: 'order',
        refId: orderId,
        note: 'بازگردانی بابت لغو سفارش',
      });
      restored += 1;
    }
    return restored;
  }
}
