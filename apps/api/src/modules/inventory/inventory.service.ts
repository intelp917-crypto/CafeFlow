import { randomUUID } from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';
import {
  STOCK_MOVEMENT_LABELS_FA,
  type AdjustStockInput,
  type CreateIngredientInput,
  type CreatePurchaseInput,
  type CreateSupplierInput,
  type CreateWasteInput,
  type IngredientRow,
  type IngredientsResponse,
  type PurchaseRow,
  type RecipeView,
  type SetRecipeInput,
  type SupplierRow,
  type StockMovementRow,
  type WasteRow,
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

  /* ------------------------------ suppliers ------------------------------ */

  suppliers(): { items: SupplierRow[] } {
    return {
      items: this.repository.suppliers().map((row) => ({
        id: row.id,
        nameFa: row.name_fa,
        phone: row.phone,
        address: row.address,
        isActive: row.is_active === 1,
        purchaseCount: row.purchase_count,
        lastPurchaseAt: row.last_purchase_at,
      })),
    };
  }

  createSupplier(input: CreateSupplierInput, actor: ActingUser): SupplierRow {
    const id = randomUUID();
    this.repository.insertSupplier({
      id,
      nameFa: input.nameFa,
      phone: input.phone ?? null,
      address: input.address ?? null,
    });

    this.audit.record({
      actorUserId: actor.userId,
      actorUsername: actor.username,
      action: 'inventory.supplier_created',
      entityType: 'supplier',
      entityId: id,
      after: { nameFa: input.nameFa, phone: input.phone ?? null },
    });

    const created = this.repository.findSupplier(id);
    if (!created) throw notFound('تأمین‌کننده ثبت نشد.', 'SUPPLIER_NOT_CREATED');
    return {
      id: created.id,
      nameFa: created.name_fa,
      phone: input.phone ?? null,
      address: input.address ?? null,
      isActive: created.is_active === 1,
      purchaseCount: 0,
      lastPurchaseAt: null,
    };
  }

  /* ------------------------------- purchases ----------------------------- */

  purchases(limit: number): { items: PurchaseRow[] } {
    return {
      items: this.repository.purchases(limit).map((row) => ({
        id: row.id,
        supplierId: row.supplier_id,
        supplierNameFa: row.supplier_name_fa,
        invoiceNo: row.invoice_no,
        total: row.total,
        purchasedAt: row.purchased_at,
        itemCount: row.item_count,
        createdByName: row.created_by_name,
      })),
    };
  }

  createPurchase(input: CreatePurchaseInput, actor: ActingUser): PurchaseRow {
    if (input.supplierId) {
      const supplier = this.repository.findSupplier(input.supplierId);
      if (!supplier) throw notFound('تأمین‌کننده یافت نشد.', 'SUPPLIER_NOT_FOUND');
      if (supplier.is_active !== 1) throw badRequest('این تأمین‌کننده غیرفعال است.', 'SUPPLIER_INACTIVE');
    }

    for (const item of input.items) {
      if (!this.repository.findIngredient(item.ingredientId)) {
        throw badRequest('یکی از مواد اولیه انتخاب‌شده یافت نشد.', 'INGREDIENT_NOT_FOUND');
      }
    }

    const purchasedAt = input.purchasedAt ? new Date(input.purchasedAt).toISOString() : new Date().toISOString();
    const total = input.items.reduce((sum, item) => sum + Math.round(item.qty * item.unitCost), 0);
    const id = randomUUID();

    this.database.transaction(() => {
      this.repository.insertPurchase({
        id,
        supplierId: input.supplierId ?? null,
        invoiceNo: input.invoiceNo ?? null,
        total,
        purchasedAt,
        createdByUserId: actor.userId,
      });

      for (const item of input.items) {
        const qty = round3(item.qty);
        this.repository.insertPurchaseItem({
          id: randomUUID(),
          purchaseId: id,
          ingredientId: item.ingredientId,
          qty,
          unitCost: item.unitCost,
        });
        this.repository.addStock(item.ingredientId, qty);
        this.repository.updateIngredientCost(item.ingredientId, item.unitCost);
        this.repository.insertMovement({
          id: randomUUID(),
          ingredientId: item.ingredientId,
          type: 'purchase',
          qty,
          refType: 'purchase',
          refId: id,
          note: input.invoiceNo ? `خرید — فاکتور ${input.invoiceNo}` : 'خرید کالا',
          createdByUserId: actor.userId,
        });
      }
    });

    this.audit.record({
      actorUserId: actor.userId,
      actorUsername: actor.username,
      action: 'inventory.purchase_created',
      entityType: 'purchase',
      entityId: id,
      after: { supplierId: input.supplierId ?? null, total, itemCount: input.items.length },
    });

    const created = this.repository.purchases(200).find((row) => row.id === id);
    return {
      id,
      supplierId: created?.supplier_id ?? input.supplierId ?? null,
      supplierNameFa: created?.supplier_name_fa ?? null,
      invoiceNo: input.invoiceNo ?? null,
      total,
      purchasedAt,
      itemCount: input.items.length,
      createdByName: actor.username,
    };
  }

  /* --------------------------------- waste ------------------------------- */

  waste(limit: number): { items: WasteRow[] } {
    return {
      items: this.repository.waste(limit).map((row) => ({
        id: row.id,
        ingredientId: row.ingredient_id,
        ingredientNameFa: row.ingredient_name_fa,
        qty: round3(row.qty),
        unitSymbol: row.unit_symbol,
        reason: row.reason,
        recordedByName: row.recorded_by_name,
        createdAt: row.created_at,
      })),
    };
  }

  createWaste(input: CreateWasteInput, actor: ActingUser): WasteRow {
    const ingredient = this.repository.findIngredient(input.ingredientId);
    if (!ingredient) throw notFound('ماده اولیه یافت نشد.', 'INGREDIENT_NOT_FOUND');

    const qty = round3(input.qty);
    if (ingredient.current_qty < qty) {
      throw badRequest(
        `موجودی «${ingredient.name_fa}» برای ثبت این ضایعات کافی نیست؛ موجودی فعلی ${round3(ingredient.current_qty)} است.`,
        'INSUFFICIENT_STOCK',
        { currentQty: round3(ingredient.current_qty), qty },
      );
    }

    const id = randomUUID();
    this.database.transaction(() => {
      this.repository.insertWaste({
        id,
        ingredientId: input.ingredientId,
        qty,
        reason: input.reason,
        recordedByUserId: actor.userId,
      });
      this.repository.addStock(input.ingredientId, -qty);
      this.repository.insertMovement({
        id: randomUUID(),
        ingredientId: input.ingredientId,
        type: 'waste',
        qty: -qty,
        refType: 'waste',
        refId: id,
        note: input.reason,
        createdByUserId: actor.userId,
      });
    });

    this.audit.record({
      actorUserId: actor.userId,
      actorUsername: actor.username,
      action: 'inventory.waste_recorded',
      entityType: 'waste_record',
      entityId: id,
      after: { ingredientId: input.ingredientId, qty, reason: input.reason },
    });

    return {
      id,
      ingredientId: input.ingredientId,
      ingredientNameFa: ingredient.name_fa,
      qty,
      unitSymbol: ingredient.unit_symbol,
      reason: input.reason,
      recordedByName: actor.username,
      createdAt: new Date().toISOString(),
    };
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
