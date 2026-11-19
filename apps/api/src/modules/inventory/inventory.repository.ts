import { Inject, Injectable } from '@nestjs/common';
import type {
  IngredientRow,
  RecipeItemRow,
  StockMovementRow,
  StockMovementType,
} from '@cafeflow/shared';
import { DB_SERVICE } from '../../common/tokens';
import { DatabaseService } from '../../db/database.service';

interface IngredientDbRow {
  id: string;
  name_fa: string;
  unit_symbol: string | null;
  current_qty: number;
  min_qty: number;
  cost_per_unit: number;
  is_active: number;
}

interface MovementDbRow {
  id: string;
  ingredient_id: string;
  ingredient_name_fa: string;
  type: StockMovementType;
  qty: number;
  unit_symbol: string | null;
  ref_type: string | null;
  ref_id: string | null;
  order_code: string | null;
  note: string | null;
  created_by_name: string | null;
  created_at: string;
}

export interface RecipeDbRow {
  product_id: string;
  product_name_fa: string;
  yield_qty: number;
  recipe_id: string;
}

/** Data access for the optional inventory module. */
@Injectable()
export class InventoryRepository {
  constructor(@Inject(DB_SERVICE) private readonly database: DatabaseService) {}

  ingredients(): IngredientRow[] {
    const rows = this.database.all<IngredientDbRow>(
      `SELECT i.id, i.name_fa, u.symbol AS unit_symbol, i.current_qty, i.min_qty, i.cost_per_unit, i.is_active
         FROM ingredients i
         LEFT JOIN measurement_units u ON u.id = i.unit_id
        WHERE i.is_active = 1
        ORDER BY i.name_fa ASC`,
    );

    return rows.map((row) => ({
      id: row.id,
      nameFa: row.name_fa,
      unitSymbol: row.unit_symbol,
      currentQty: Math.round(row.current_qty * 1000) / 1000,
      minQty: row.min_qty,
      costPerUnit: row.cost_per_unit,
      isActive: row.is_active === 1,
      isLow: row.current_qty <= row.min_qty,
    }));
  }

  findIngredient(id: string): IngredientDbRow | undefined {
    return this.database.get<IngredientDbRow>(
      `SELECT i.id, i.name_fa, u.symbol AS unit_symbol, i.current_qty, i.min_qty, i.cost_per_unit, i.is_active
         FROM ingredients i
         LEFT JOIN measurement_units u ON u.id = i.unit_id
        WHERE i.id = ?`,
      [id],
    );
  }

  insertIngredient(input: {
    id: string;
    nameFa: string;
    unitId: string | null;
    currentQty: number;
    minQty: number;
    costPerUnit: number;
  }): void {
    this.database.run(
      `INSERT INTO ingredients (id, name_fa, unit_id, current_qty, min_qty, cost_per_unit)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [input.id, input.nameFa, input.unitId, input.currentQty, input.minQty, input.costPerUnit],
    );
  }

  findUnitBySymbol(symbol: string): { id: string } | undefined {
    return this.database.get<{ id: string }>('SELECT id FROM measurement_units WHERE symbol = ?', [symbol]);
  }

  insertUnit(id: string, symbol: string): void {
    this.database.run('INSERT INTO measurement_units (id, name_fa, symbol) VALUES (?, ?, ?)', [id, symbol, symbol]);
  }

  addStock(ingredientId: string, delta: number): void {
    this.database.run('UPDATE ingredients SET current_qty = current_qty + ? WHERE id = ?', [delta, ingredientId]);
  }

  insertMovement(input: {
    id: string;
    ingredientId: string;
    type: StockMovementType;
    qty: number;
    refType?: string | null;
    refId?: string | null;
    note?: string | null;
    createdByUserId?: string | null;
  }): void {
    this.database.run(
      `INSERT INTO stock_movements
        (id, ingredient_id, type, qty, ref_type, ref_id, note, created_by_user_id)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        input.id,
        input.ingredientId,
        input.type,
        input.qty,
        input.refType ?? null,
        input.refId ?? null,
        input.note ?? null,
        input.createdByUserId ?? null,
      ],
    );
  }

  movements(limit: number): StockMovementRow[] {
    const rows = this.database.all<MovementDbRow>(
      `SELECT m.id, m.ingredient_id, i.name_fa AS ingredient_name_fa, m.type, m.qty,
              u.symbol AS unit_symbol, m.ref_type, m.ref_id, o.code AS order_code,
              m.note, us.full_name AS created_by_name, m.created_at
         FROM stock_movements m
         JOIN ingredients i ON i.id = m.ingredient_id
         LEFT JOIN measurement_units u ON u.id = i.unit_id
         LEFT JOIN orders o ON m.ref_type = 'order' AND o.id = m.ref_id
         LEFT JOIN users us ON us.id = m.created_by_user_id
        ORDER BY m.created_at DESC
        LIMIT ?`,
      [limit],
    );

    return rows.map((row) => ({
      id: row.id,
      ingredientId: row.ingredient_id,
      ingredientNameFa: row.ingredient_name_fa,
      type: row.type,
      typeLabelFa: row.type,
      qty: Math.round(row.qty * 1000) / 1000,
      unitSymbol: row.unit_symbol,
      refType: row.ref_type,
      refId: row.ref_id,
      orderCode: row.order_code,
      note: row.note,
      createdByName: row.created_by_name,
      createdAt: row.created_at,
    }));
  }

  recipes(): RecipeDbRow[] {
    return this.database.all<RecipeDbRow>(
      `SELECT r.product_id, p.name_fa AS product_name_fa, r.yield_qty, r.id AS recipe_id
         FROM recipes r
         JOIN products p ON p.id = r.product_id
        ORDER BY p.name_fa ASC`,
    );
  }

  recipeItems(recipeId: string): RecipeItemRow[] {
    const rows = this.database.all<{
      ingredient_id: string;
      ingredient_name_fa: string;
      unit_symbol: string | null;
      qty: number;
    }>(
      `SELECT ri.ingredient_id, i.name_fa AS ingredient_name_fa, u.symbol AS unit_symbol, ri.qty
         FROM recipe_items ri
         JOIN ingredients i ON i.id = ri.ingredient_id
         LEFT JOIN measurement_units u ON u.id = i.unit_id
        WHERE ri.recipe_id = ?
        ORDER BY i.name_fa ASC`,
      [recipeId],
    );

    return rows.map((row) => ({
      ingredientId: row.ingredient_id,
      ingredientNameFa: row.ingredient_name_fa,
      unitSymbol: row.unit_symbol,
      qty: Math.round(row.qty * 1000) / 1000,
    }));
  }

  findRecipeByProduct(productId: string): { id: string; yield_qty: number } | undefined {
    return this.database.get<{ id: string; yield_qty: number }>(
      'SELECT id, yield_qty FROM recipes WHERE product_id = ?',
      [productId],
    );
  }

  upsertRecipe(id: string, productId: string, yieldQty: number): void {
    this.database.run(
      `INSERT INTO recipes (id, product_id, yield_qty) VALUES (?, ?, ?)
       ON CONFLICT (product_id) DO UPDATE SET yield_qty = excluded.yield_qty`,
      [id, productId, yieldQty],
    );
  }

  deleteRecipeItems(recipeId: string): void {
    this.database.run('DELETE FROM recipe_items WHERE recipe_id = ?', [recipeId]);
  }

  insertRecipeItem(id: string, recipeId: string, ingredientId: string, qty: number): void {
    this.database.run(
      'INSERT INTO recipe_items (id, recipe_id, ingredient_id, qty) VALUES (?, ?, ?, ?)',
      [id, recipeId, ingredientId, qty],
    );
  }

  productExists(productId: string): boolean {
    return this.database.count('SELECT COUNT(*) AS n FROM products WHERE id = ?', [productId]) > 0;
  }

  orderItems(orderId: string): Array<{ product_id: string | null; quantity: number }> {
    return this.database.all<{ product_id: string | null; quantity: number }>(
      `SELECT product_id, quantity FROM order_items WHERE order_id = ? AND status <> 'cancelled'`,
      [orderId],
    );
  }

  productRecipe(productId: string): Array<{ ingredient_id: string; qty: number; yield_qty: number }> {
    return this.database.all<{ ingredient_id: string; qty: number; yield_qty: number }>(
      `SELECT ri.ingredient_id, ri.qty, r.yield_qty
         FROM recipe_items ri
         JOIN recipes r ON r.id = ri.recipe_id
        WHERE r.product_id = ?`,
      [productId],
    );
  }

  deductionCount(orderId: string): number {
    return this.database.count(
      `SELECT COUNT(*) AS n FROM stock_movements
        WHERE ref_type = 'order' AND ref_id = ? AND type = 'sale_deduction'`,
      [orderId],
    );
  }

  /** Net movement per ingredient for an order (−deducted, +restored). */
  orderNetMovements(orderId: string): Array<{ ingredient_id: string; net: number }> {
    return this.database.all<{ ingredient_id: string; net: number }>(
      `SELECT ingredient_id, SUM(qty) AS net
         FROM stock_movements
        WHERE ref_type = 'order' AND ref_id = ? AND type IN ('sale_deduction', 'restore')
        GROUP BY ingredient_id`,
      [orderId],
    );
  }

  isModuleEnabled(): boolean {
    const row = this.database.get<{ is_enabled: number }>(
      "SELECT is_enabled FROM module_settings WHERE key = 'inventory'",
      [],
    );
    return row ? row.is_enabled === 1 : false;
  }
}
