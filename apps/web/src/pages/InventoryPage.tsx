import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Alert,
  Badge,
  Button,
  Card,
  CardBody,
  CardHeader,
  DataTable,
  EmptyState,
  ErrorState,
  Field,
  Input,
  Modal,
  PageHeader,
  Spinner,
  StatCard,
  type Column,
} from '@cafeflow/ui';
import type {
  IngredientRow,
  IngredientsResponse,
  PurchaseRow,
  RecipeView,
  StockMovementRow,
  SupplierRow,
  WasteRow,
} from '@cafeflow/shared';
import { api, errorMessage } from '../lib/api';
import { formatDateTimeFa, formatCountFa, formatRial } from '../lib/format';

interface MenuProduct {
  id: string;
  nameFa: string;
}

interface RecipeItemForm {
  ingredientId: string;
  qty: string;
}

const MOVEMENT_TONES: Record<string, 'brand' | 'success' | 'warning' | 'danger' | 'neutral'> = {
  purchase: 'success',
  sale_deduction: 'brand',
  adjustment: 'warning',
  waste: 'danger',
  restore: 'success',
};

function quantity(value: number): string {
  return value.toLocaleString('fa-IR', { maximumFractionDigits: 3 });
}

export function InventoryPage() {
  const [ingredients, setIngredients] = useState<IngredientRow[]>([]);
  const [summary, setSummary] = useState({ total: 0, low: 0, out: 0 });
  const [movements, setMovements] = useState<StockMovementRow[]>([]);
  const [recipes, setRecipes] = useState<RecipeView[]>([]);
  const [products, setProducts] = useState<MenuProduct[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const [ingredientModal, setIngredientModal] = useState(false);
  const [ingredientForm, setIngredientForm] = useState({
    nameFa: '',
    unitSymbol: 'گرم',
    currentQty: '0',
    minQty: '0',
    costPerUnit: '0',
  });

  const [adjusting, setAdjusting] = useState<IngredientRow | null>(null);
  const [adjustForm, setAdjustForm] = useState({ delta: '', reason: '' });

  const [recipeProductId, setRecipeProductId] = useState('');
  const [recipeItems, setRecipeItems] = useState<RecipeItemForm[]>([{ ingredientId: '', qty: '' }]);

  const [suppliers, setSuppliers] = useState<SupplierRow[]>([]);
  const [purchases, setPurchases] = useState<PurchaseRow[]>([]);
  const [wasteRecords, setWasteRecords] = useState<WasteRow[]>([]);
  const [supplierModal, setSupplierModal] = useState(false);
  const [supplierForm, setSupplierForm] = useState({ nameFa: '', phone: '', address: '' });
  const [purchaseForm, setPurchaseForm] = useState({
    supplierId: '',
    invoiceNo: '',
    items: [{ ingredientId: '', qty: '', unitCost: '' }],
  });
  const [wasteForm, setWasteForm] = useState({ ingredientId: '', qty: '', reason: '' });

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [ingredientResponse, movementResponse, recipeResponse, menuResponse, supplierResponse, purchaseResponse, wasteResponse] =
        await Promise.all([
          api.get<IngredientsResponse>('/inventory/ingredients'),
          api.get<{ items: StockMovementRow[] }>('/inventory/movements?limit=60'),
          api.get<{ items: RecipeView[] }>('/inventory/recipes'),
          api.get<{ categories: Array<{ products: MenuProduct[] }> }>('/public/menu'),
          api.get<{ items: SupplierRow[] }>('/inventory/suppliers'),
          api.get<{ items: PurchaseRow[] }>('/inventory/purchases?limit=20'),
          api.get<{ items: WasteRow[] }>('/inventory/waste?limit=15'),
        ]);
      setIngredients(ingredientResponse.items);
      setSummary(ingredientResponse.summary);
      setMovements(movementResponse.items);
      setRecipes(recipeResponse.items);
      setProducts(menuResponse.categories.flatMap((category) => category.products));
      setSuppliers(supplierResponse.items);
      setPurchases(purchaseResponse.items);
      setWasteRecords(wasteResponse.items);
    } catch (caught) {
      setError(errorMessage(caught));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const recipeByProduct = useMemo(() => {
    const map = new Map<string, RecipeView>();
    for (const recipe of recipes) map.set(recipe.productId, recipe);
    return map;
  }, [recipes]);

  const selectRecipeProduct = (productId: string) => {
    setRecipeProductId(productId);
    const existing = recipeByProduct.get(productId);
    setRecipeItems(
      existing && existing.items.length > 0
        ? existing.items.map((item) => ({ ingredientId: item.ingredientId, qty: String(item.qty) }))
        : [{ ingredientId: '', qty: '' }],
    );
  };

  const createIngredient = async () => {
    setBusy(true);
    try {
      await api.post('/inventory/ingredients', {
        nameFa: ingredientForm.nameFa,
        unitSymbol: ingredientForm.unitSymbol || undefined,
        currentQty: Number(ingredientForm.currentQty || 0),
        minQty: Number(ingredientForm.minQty || 0),
        costPerUnit: Number(ingredientForm.costPerUnit || 0),
      });
      setIngredientModal(false);
      setIngredientForm({ nameFa: '', unitSymbol: 'گرم', currentQty: '0', minQty: '0', costPerUnit: '0' });
      setNotice('ماده اولیه ثبت شد.');
      await load();
    } catch (caught) {
      setError(errorMessage(caught));
    } finally {
      setBusy(false);
    }
  };

  const adjustStock = async () => {
    if (!adjusting) return;
    setBusy(true);
    try {
      const updated = await api.post<IngredientRow>(`/inventory/ingredients/${adjusting.id}/adjustments`, {
        delta: Number(adjustForm.delta),
        reason: adjustForm.reason,
      });
      setNotice(`موجودی «${updated.nameFa}» به ${quantity(updated.currentQty)} رسید.`);
      setAdjusting(null);
      setAdjustForm({ delta: '', reason: '' });
      await load();
    } catch (caught) {
      setError(errorMessage(caught));
    } finally {
      setBusy(false);
    }
  };

  const saveRecipe = async () => {
    if (!recipeProductId) return;
    setBusy(true);
    try {
      const items = recipeItems
        .filter((item) => item.ingredientId && Number(item.qty) > 0)
        .map((item) => ({ ingredientId: item.ingredientId, qty: Number(item.qty) }));
      await api.post(`/inventory/recipes/${recipeProductId}`, { yieldQty: 1, items });
      setNotice(items.length === 0 ? 'دستور پخت پاک شد.' : 'دستور پخت ذخیره شد.');
      await load();
    } catch (caught) {
      setError(errorMessage(caught));
    } finally {
      setBusy(false);
    }
  };

  const createSupplier = async () => {
    setBusy(true);
    try {
      await api.post<SupplierRow>('/inventory/suppliers', {
        nameFa: supplierForm.nameFa,
        phone: supplierForm.phone || undefined,
        address: supplierForm.address || undefined,
      });
      setSupplierModal(false);
      setSupplierForm({ nameFa: '', phone: '', address: '' });
      setNotice('تأمین‌کننده ثبت شد.');
      await load();
    } catch (caught) {
      setError(errorMessage(caught));
    } finally {
      setBusy(false);
    }
  };

  const createPurchase = async () => {
    const items = purchaseForm.items
      .filter((item) => item.ingredientId && Number(item.qty) > 0)
      .map((item) => ({
        ingredientId: item.ingredientId,
        qty: Number(item.qty),
        unitCost: Number(item.unitCost || 0),
      }));

    if (items.length === 0) {
      setError('حداقل یک قلم با مقدار بیشتر از صفر لازم است.');
      return;
    }

    setBusy(true);
    setError(null);
    try {
      const created = await api.post<PurchaseRow>('/inventory/purchases', {
        supplierId: purchaseForm.supplierId || undefined,
        invoiceNo: purchaseForm.invoiceNo || undefined,
        items,
      });
      setNotice(`خرید ${formatRial(created.total)} ریالی ثبت و موجودی به‌روز شد.`);
      setPurchaseForm({ supplierId: '', invoiceNo: '', items: [{ ingredientId: '', qty: '', unitCost: '' }] });
      await load();
    } catch (caught) {
      setError(errorMessage(caught));
    } finally {
      setBusy(false);
    }
  };

  const createWaste = async () => {
    setBusy(true);
    setError(null);
    try {
      const created = await api.post<WasteRow>('/inventory/waste', {
        ingredientId: wasteForm.ingredientId,
        qty: Number(wasteForm.qty),
        reason: wasteForm.reason,
      });
      setNotice(`ضایعات ${quantity(created.qty)} ${created.unitSymbol ?? ''} «${created.ingredientNameFa}» ثبت شد.`);
      setWasteForm({ ingredientId: '', qty: '', reason: '' });
      await load();
    } catch (caught) {
      setError(errorMessage(caught));
    } finally {
      setBusy(false);
    }
  };

  const purchaseTotal = purchaseForm.items.reduce(
    (sum, item) => sum + Math.round(Number(item.qty || 0) * Number(item.unitCost || 0)),
    0,
  );

  const supplierColumns: Column<SupplierRow>[] = [
    { key: 'name', header: 'تأمین‌کننده', render: (row) => <span className="text-xs font-medium text-ink">{row.nameFa}</span> },
    { key: 'phone', header: 'تماس', render: (row) => <span className="num text-[11px]" dir="ltr">{row.phone ?? '—'}</span> },
    { key: 'count', header: 'خریدها', render: (row) => <span className="num text-xs">{formatCountFa(row.purchaseCount)}</span> },
    {
      key: 'last',
      header: 'آخرین خرید',
      render: (row) => <span className="text-[11px] text-muted">{formatDateTimeFa(row.lastPurchaseAt)}</span>,
    },
  ];

  const purchaseColumns: Column<PurchaseRow>[] = [
    { key: 'date', header: 'زمان', render: (row) => <span className="text-[11px]">{formatDateTimeFa(row.purchasedAt)}</span> },
    { key: 'supplier', header: 'تأمین‌کننده', render: (row) => <span className="text-xs">{row.supplierNameFa ?? '—'}</span> },
    { key: 'invoice', header: 'فاکتور', render: (row) => <span className="text-[11px] text-muted">{row.invoiceNo ?? '—'}</span> },
    { key: 'items', header: 'اقلام', render: (row) => <span className="num text-xs">{formatCountFa(row.itemCount)}</span> },
    { key: 'total', header: 'مبلغ', render: (row) => <span className="num text-xs">{formatRial(row.total)}</span> },
  ];

  const ingredientColumns: Column<IngredientRow>[] = [
    {
      key: 'name',
      header: 'ماده اولیه',
      render: (row) => (
        <div className="flex items-center gap-2">
          <span className="font-medium text-ink">{row.nameFa}</span>
          {row.currentQty <= 0 ? (
            <Badge tone="danger">تمام شد</Badge>
          ) : row.isLow ? (
            <Badge tone="warning">کمبود</Badge>
          ) : null}
        </div>
      ),
    },
    {
      key: 'qty',
      header: 'موجودی',
      render: (row) => (
        <span className="num text-xs">
          {quantity(row.currentQty)} {row.unitSymbol ?? ''}
        </span>
      ),
    },
    {
      key: 'min',
      header: 'حد هشدار',
      render: (row) => (
        <span className="num text-[11px] text-muted">
          {quantity(row.minQty)} {row.unitSymbol ?? ''}
        </span>
      ),
    },
    { key: 'cost', header: 'بهای واحد', render: (row) => <span className="num text-[11px]">{formatRial(row.costPerUnit)}</span> },
    {
      key: 'actions',
      header: 'اصلاح موجودی',
      render: (row) => (
        <Button size="sm" variant="outline" onClick={() => setAdjusting(row)}>
          ثبت تغییر
        </Button>
      ),
    },
  ];

  const movementColumns: Column<StockMovementRow>[] = [
    { key: 'date', header: 'زمان', render: (row) => <span className="text-[11px]">{formatDateTimeFa(row.createdAt)}</span> },
    { key: 'ingredient', header: 'ماده اولیه', render: (row) => <span className="text-xs">{row.ingredientNameFa}</span> },
    {
      key: 'type',
      header: 'نوع',
      render: (row) => <Badge tone={MOVEMENT_TONES[row.type] ?? 'neutral'}>{row.typeLabelFa}</Badge>,
    },
    {
      key: 'qty',
      header: 'مقدار',
      render: (row) => (
        <span className={`num text-xs ${row.qty < 0 ? 'text-danger-600' : 'text-success-700'}`}>
          {row.qty > 0 ? '+' : ''}
          {quantity(row.qty)} {row.unitSymbol ?? ''}
        </span>
      ),
    },
    { key: 'ref', header: 'مرجع', render: (row) => <span className="text-[11px] text-muted">{row.orderCode ?? row.note ?? '—'}</span> },
  ];

  return (
    <div className="space-y-5">
      <PageHeader
        title="انبار و مواد اولیه"
        description="موجودی، دستور پخت و گردش انبار. با فعال بودن ماژول، مواد اولیه هر دستور پخت هنگام ثبت سفارش کسر و هنگام لغو بازگردانده می‌شود."
        breadcrumb="کافه‌فلو / انبار"
        actions={
          <Button size="sm" onClick={() => setIngredientModal(true)}>
            ماده اولیه جدید
          </Button>
        }
      />

      {notice ? <Alert tone="success">{notice}</Alert> : null}
      {error ? <Alert tone="danger">{error}</Alert> : null}

      {loading && ingredients.length === 0 ? (
        <Card className="flex justify-center py-16 text-brand-600">
          <Spinner size="lg" />
        </Card>
      ) : error && ingredients.length === 0 ? (
        <Card>
          <ErrorState message={error} onRetry={() => void load()} />
        </Card>
      ) : (
        <>
          <div className="grid gap-3 sm:grid-cols-3">
            <StatCard label="مواد اولیه" value={formatCountFa(summary.total)} />
            <StatCard label="کمبود" value={formatCountFa(summary.low)} tone="warning" />
            <StatCard label="اتمام موجودی" value={formatCountFa(summary.out)} tone="warning" />
          </div>

          <Card>
            <CardHeader title="موجودی مواد اولیه" description="اصلاح موجودی همیشه دلیل و سابقه در گردش انبار دارد." />
            <DataTable
              columns={ingredientColumns}
              rows={ingredients}
              rowKey={(row) => row.id}
              empty={<EmptyState title="ماده اولیه‌ای ثبت نشده است" />}
            />
          </Card>

          <Card>
            <CardHeader
              title="دستور پخت"
              description="مقدار هر ماده اولیه برای یک واحد محصول؛ مبنای کسر خودکار هنگام فروش."
            />
            <CardBody className="space-y-3">
              <div className="grid gap-3 sm:grid-cols-2">
                <Field label="محصول">
                  <select
                    value={recipeProductId}
                    onChange={(event) => selectRecipeProduct(event.target.value)}
                    className="h-11 w-full rounded-xl border border-line bg-surface px-3 text-sm text-ink"
                  >
                    <option value="">انتخاب محصول</option>
                    {products.map((product) => (
                      <option key={product.id} value={product.id}>
                        {product.nameFa}
                        {recipeByProduct.has(product.id) ? ' ✓' : ''}
                      </option>
                    ))}
                  </select>
                </Field>
              </div>

              {recipeProductId ? (
                <div className="space-y-2">
                  {recipeItems.map((item, index) => (
                    <div key={index} className="flex items-end gap-2">
                      <div className="flex-1">
                        <Field label={index === 0 ? 'ماده اولیه' : ''}>
                          <select
                            value={item.ingredientId}
                            onChange={(event) => {
                              const next = [...recipeItems];
                              next[index] = { ...next[index], ingredientId: event.target.value };
                              setRecipeItems(next);
                            }}
                            className="h-11 w-full rounded-xl border border-line bg-surface px-3 text-sm text-ink"
                          >
                            <option value="">انتخاب ماده اولیه</option>
                            {ingredients.map((ingredient) => (
                              <option key={ingredient.id} value={ingredient.id}>
                                {ingredient.nameFa} {ingredient.unitSymbol ? `(${ingredient.unitSymbol})` : ''}
                              </option>
                            ))}
                          </select>
                        </Field>
                      </div>
                      <div className="w-32">
                        <Field label={index === 0 ? 'مقدار' : ''}>
                          <Input
                            type="number"
                            min={0}
                            step="0.001"
                            value={item.qty}
                            onChange={(event) => {
                              const next = [...recipeItems];
                              next[index] = { ...next[index], qty: event.target.value };
                              setRecipeItems(next);
                            }}
                          />
                        </Field>
                      </div>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => setRecipeItems(recipeItems.filter((_, i) => i !== index))}
                        aria-label="حذف ردیف"
                      >
                        ×
                      </Button>
                    </div>
                  ))}
                  <div className="flex gap-2">
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => setRecipeItems([...recipeItems, { ingredientId: '', qty: '' }])}
                    >
                      افزودن ردیف
                    </Button>
                    <Button size="sm" onClick={() => void saveRecipe()} loading={busy}>
                      ذخیره دستور پخت
                    </Button>
                  </div>
                </div>
              ) : (
                <p className="text-[11px] text-muted">برای ویرایش، یک محصول انتخاب کنید.</p>
              )}
            </CardBody>
          </Card>

          <Card>
            <CardHeader
title="خرید و تأمین‌کنندگان"
              description="هر خرید، موجودی را افزایش و بهای واحد را به‌روز می‌کند و در گردش انبار ثبت می‌شود."
              action={
                <Button size="sm" variant="outline" onClick={() => setSupplierModal(true)}>
                  تأمین‌کننده جدید
                </Button>
              }
            />
            <CardBody className="space-y-3">
              <div className="grid gap-3 sm:grid-cols-3">
                <Field label="تأمین‌کننده">
                  <select
                    value={purchaseForm.supplierId}
                    onChange={(event) => setPurchaseForm({ ...purchaseForm, supplierId: event.target.value })}
                    className="h-11 w-full rounded-xl border border-line bg-surface px-3 text-sm text-ink"
                  >
                    <option value="">بدون تأمین‌کننده</option>
                    {suppliers.map((supplier) => (
                      <option key={supplier.id} value={supplier.id}>
                        {supplier.nameFa}
                      </option>
                    ))}
                  </select>
                </Field>
                <Field label="شماره فاکتور">
                  <Input
                    value={purchaseForm.invoiceNo}
                    onChange={(event) => setPurchaseForm({ ...purchaseForm, invoiceNo: event.target.value })}
                    dir="ltr"
                  />
                </Field>
                <div className="flex items-end pb-1">
                  <p className="text-[11px] text-muted">
                    جمع خرید: <span className="num text-ink">{formatRial(purchaseTotal)}</span>
                  </p>
                </div>
              </div>

              <div className="space-y-2">
                {purchaseForm.items.map((item, index) => (
                  <div key={index} className="flex items-end gap-2">
                    <div className="flex-1">
                      <Field label={index === 0 ? 'ماده اولیه' : ''}>
                        <select
                          value={item.ingredientId}
                          onChange={(event) => {
                            const next = [...purchaseForm.items];
                            next[index] = { ...next[index], ingredientId: event.target.value };
                            setPurchaseForm({ ...purchaseForm, items: next });
                          }}
                          className="h-11 w-full rounded-xl border border-line bg-surface px-3 text-sm text-ink"
                        >
                          <option value="">انتخاب ماده اولیه</option>
                          {ingredients.map((ingredient) => (
                            <option key={ingredient.id} value={ingredient.id}>
                              {ingredient.nameFa} {ingredient.unitSymbol ? `(${ingredient.unitSymbol})` : ''}
                            </option>
                          ))}
                        </select>
                      </Field>
                    </div>
                    <div className="w-28">
                      <Field label={index === 0 ? 'مقدار' : ''}>
                        <Input
                          type="number"
                          min={0}
                          step="0.001"
                          value={item.qty}
                          onChange={(event) => {
                            const next = [...purchaseForm.items];
                            next[index] = { ...next[index], qty: event.target.value };
                            setPurchaseForm({ ...purchaseForm, items: next });
                          }}
                        />
                      </Field>
                    </div>
                    <div className="w-32">
                      <Field label={index === 0 ? 'بهای واحد' : ''}>
                        <Input
                          type="number"
                          min={0}
                          value={item.unitCost}
                          onChange={(event) => {
                            const next = [...purchaseForm.items];
                            next[index] = { ...next[index], unitCost: event.target.value };
                            setPurchaseForm({ ...purchaseForm, items: next });
                          }}
                        />
                      </Field>
                    </div>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() =>
                        setPurchaseForm({
                          ...purchaseForm,
                          items: purchaseForm.items.filter((_, i) => i !== index),
                        })
                      }
                      aria-label="حذف ردیف"
                    >
                      ×
                    </Button>
                  </div>
                ))}
                <div className="flex gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() =>
                      setPurchaseForm({
                        ...purchaseForm,
                        items: [...purchaseForm.items, { ingredientId: '', qty: '', unitCost: '' }],
                      })
                    }
                  >
                    افزودن قلم
                  </Button>
                  <Button size="sm" onClick={() => void createPurchase()} loading={busy}>
                    ثبت خرید
                  </Button>
                </div>
              </div>

              {purchases.length > 0 ? (
                <DataTable columns={purchaseColumns} rows={purchases} rowKey={(row) => row.id} />
              ) : (
                <p className="text-[11px] text-muted">هنوز خریدی ثبت نشده است.</p>
              )}

              {suppliers.length > 0 ? (
                <DataTable columns={supplierColumns} rows={suppliers} rowKey={(row) => row.id} />
              ) : null}
            </CardBody>
          </Card>

          <Card>
            <CardHeader title="ضایعات" description="ثبت ضایعات موجودی را کم می‌کند و در گردش انبار رد می‌ماند." />
            <CardBody className="space-y-3">
              <div className="grid gap-3 sm:grid-cols-4">
                <Field label="ماده اولیه" required>
                  <select
                    value={wasteForm.ingredientId}
                    onChange={(event) => setWasteForm({ ...wasteForm, ingredientId: event.target.value })}
                    className="h-11 w-full rounded-xl border border-line bg-surface px-3 text-sm text-ink"
                  >
                    <option value="">انتخاب</option>
                    {ingredients.map((ingredient) => (
                      <option key={ingredient.id} value={ingredient.id}>
                        {ingredient.nameFa}
                      </option>
                    ))}
                  </select>
                </Field>
                <Field label="مقدار" required>
                  <Input
                    type="number"
                    min={0}
                    step="0.001"
                    value={wasteForm.qty}
                    onChange={(event) => setWasteForm({ ...wasteForm, qty: event.target.value })}
                  />
                </Field>
                <Field label="دلیل" required>
                  <Input
                    value={wasteForm.reason}
                    onChange={(event) => setWasteForm({ ...wasteForm, reason: event.target.value })}
                    placeholder="ریختن، تاریخ گذشته…"
                  />
                </Field>
                <div className="flex items-end pb-1">
                  <Button
                    onClick={() => void createWaste()}
                    loading={busy}
                    disabled={!wasteForm.ingredientId || Number(wasteForm.qty) <= 0 || wasteForm.reason.trim().length < 2}
                  >
                    ثبت ضایعات
                  </Button>
                </div>
              </div>

              {wasteRecords.length > 0 ? (
                <ul className="divide-y divide-line rounded-xl border border-line text-[11px]">
                  {wasteRecords.map((record) => (
                    <li key={record.id} className="flex items-center justify-between gap-3 px-3 py-2">
                      <div>
                        <p className="text-ink">{record.ingredientNameFa}</p>
                        <p className="text-[10px] text-muted">
                          {record.reason ?? '—'} · {formatDateTimeFa(record.createdAt)}
                        </p>
                      </div>
                      <span className="num text-danger-600">
                        -{quantity(record.qty)} {record.unitSymbol ?? ''}
                      </span>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="text-[11px] text-muted">ضایعاتی ثبت نشده است.</p>
              )}
            </CardBody>
          </Card>

          <Card>
            <CardHeader title="گردش انبار" description="۶۰ ردیف آخر؛ کسر خودکار، بازگردانی، خرید و اصلاح دستی" />
            {movements.length > 0 ? (
              <DataTable columns={movementColumns} rows={movements} rowKey={(row) => row.id} />
            ) : (
              <EmptyState title="گردشی ثبت نشده است" />
            )}
          </Card>
        </>
      )}

      <Modal
        open={ingredientModal}
        onClose={() => setIngredientModal(false)}
        title="ماده اولیه جدید"
        footer={
          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={() => setIngredientModal(false)}>
              انصراف
            </Button>
            <Button onClick={() => void createIngredient()} loading={busy} disabled={!ingredientForm.nameFa.trim()}>
              ثبت
            </Button>
          </div>
        }
      >
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="نام" required>
            <Input
              value={ingredientForm.nameFa}
              onChange={(event) => setIngredientForm({ ...ingredientForm, nameFa: event.target.value })}
              placeholder="مثلاً دانه قهوه"
            />
          </Field>
          <Field label="واحد" hint="گرم، میلی‌لیتر، عدد…">
            <Input
              value={ingredientForm.unitSymbol}
              onChange={(event) => setIngredientForm({ ...ingredientForm, unitSymbol: event.target.value })}
            />
          </Field>
          <Field label="موجودی اولیه">
            <Input
              type="number"
              min={0}
              step="0.001"
              value={ingredientForm.currentQty}
              onChange={(event) => setIngredientForm({ ...ingredientForm, currentQty: event.target.value })}
            />
          </Field>
          <Field label="حد هشدار">
            <Input
              type="number"
              min={0}
              step="0.001"
              value={ingredientForm.minQty}
              onChange={(event) => setIngredientForm({ ...ingredientForm, minQty: event.target.value })}
            />
          </Field>
          <Field label="بهای واحد (ریال)">
            <Input
              type="number"
              min={0}
              value={ingredientForm.costPerUnit}
              onChange={(event) => setIngredientForm({ ...ingredientForm, costPerUnit: event.target.value })}
            />
          </Field>
        </div>
      </Modal>

      <Modal
        open={Boolean(adjusting)}
        onClose={() => setAdjusting(null)}
        title={adjusting ? `اصلاح موجودی «${adjusting.nameFa}»` : 'اصلاح موجودی'}
        description="عدد مثبت اضافه می‌کند و عدد منفی کم می‌کند؛ دلیل الزامی است."
        footer={
          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={() => setAdjusting(null)}>
              انصراف
            </Button>
            <Button
              onClick={() => void adjustStock()}
              loading={busy}
              disabled={!adjustForm.delta || adjustForm.reason.trim().length < 2}
            >
              ثبت
            </Button>
          </div>
        }
      >
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="مقدار تغییر" required hint={adjusting?.unitSymbol ?? undefined}>
            <Input
              type="number"
              step="0.001"
              value={adjustForm.delta}
              onChange={(event) => setAdjustForm({ ...adjustForm, delta: event.target.value })}
              placeholder="مثلاً 500 یا ‎-200"
            />
          </Field>
          <Field label="دلیل" required>
            <Input
              value={adjustForm.reason}
              onChange={(event) => setAdjustForm({ ...adjustForm, reason: event.target.value })}
              placeholder="خرید، ضایعات، شمارش"
            />
          </Field>
        </div>
      </Modal>

      <Modal
        open={supplierModal}
        onClose={() => setSupplierModal(false)}
        title="تأمین‌کننده جدید"
        footer={
          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={() => setSupplierModal(false)}>
              انصراف
            </Button>
            <Button onClick={() => void createSupplier()} loading={busy} disabled={supplierForm.nameFa.trim().length < 2}>
              ثبت
            </Button>
          </div>
        }
      >
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="sm:col-span-2">
            <Field label="نام" required>
              <Input
                value={supplierForm.nameFa}
                onChange={(event) => setSupplierForm({ ...supplierForm, nameFa: event.target.value })}
              />
            </Field>
          </div>
          <Field label="شماره تماس">
            <Input
              value={supplierForm.phone}
              onChange={(event) => setSupplierForm({ ...supplierForm, phone: event.target.value })}
              dir="ltr"
            />
          </Field>
          <Field label="نشانی">
            <Input
              value={supplierForm.address}
              onChange={(event) => setSupplierForm({ ...supplierForm, address: event.target.value })}
            />
          </Field>
        </div>
      </Modal>
    </div>
  );
}
