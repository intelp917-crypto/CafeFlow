import { useCallback, useEffect, useMemo, useState, type ChangeEvent } from 'react';
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
  Switch,
  Textarea,
  type Column,
} from '@cafeflow/ui';
import { normalizeForSearch, type CatalogCategory, type CatalogProduct, type CatalogResponse } from '@cafeflow/shared';
import { api, errorMessage } from '../lib/api';
import { useAuth } from '../lib/auth';
import { formatRial, parseAmountFa } from '../lib/format';
import { ImportModal } from '../components/catalog/ImportModal';

interface ProductFormState {
  nameFa: string;
  categoryId: string;
  basePrice: string;
  descriptionFa: string;
  imageUrl: string;
  departmentId: string;
  prepMinutes: string;
  isAvailable: boolean;
  isActive: boolean;
}

interface CategoryFormState {
  nameFa: string;
  sortOrder: string;
  isActive: boolean;
}

interface OptionDraft {
  nameFa: string;
  priceDelta: string;
  isActive: boolean;
}

interface GroupDraft {
  nameFa: string;
  minSelect: string;
  maxSelect: string;
  isRequired: boolean;
  options: OptionDraft[];
}

interface ExtraDraft {
  nameFa: string;
  price: string;
  isActive: boolean;
}

interface AvailabilityDraft {
  weekday: string;
  startTime: string;
  endTime: string;
}

const WEEKDAYS = [
  { value: '6', label: 'شنبه' },
  { value: '0', label: 'یکشنبه' },
  { value: '1', label: 'دوشنبه' },
  { value: '2', label: 'سه‌شنبه' },
  { value: '3', label: 'چهارشنبه' },
  { value: '4', label: 'پنجشنبه' },
  { value: '5', label: 'جمعه' },
];

const selectClass = 'h-11 w-full rounded-xl border border-line bg-surface px-3 text-sm text-ink';

function blankProduct(categoryId: string): ProductFormState {
  return {
    nameFa: '',
    categoryId,
    basePrice: '',
    descriptionFa: '',
    imageUrl: '',
    departmentId: '',
    prepMinutes: '10',
    isAvailable: true,
    isActive: true,
  };
}

function blankGroup(): GroupDraft {
  return {
    nameFa: '',
    minSelect: '0',
    maxSelect: '1',
    isRequired: false,
    options: [{ nameFa: '', priceDelta: '0', isActive: true }],
  };
}

function ProductStatus({ product }: { product: CatalogProduct }) {
  if (product.isArchived) return <Badge tone="neutral">بایگانی</Badge>;
  if (!product.isActive) return <Badge tone="warning">غیرفعال</Badge>;
  if (!product.isAvailable) return <Badge tone="danger">ناموجود</Badge>;
  return <Badge tone="success">فعال</Badge>;
}

/** Live preview so a mistyped or dead image URL is obvious before saving. */
function ProductImagePreview({ url }: { url: string }) {
  const [failed, setFailed] = useState(false);
  const trimmed = url.trim();

  useEffect(() => {
    setFailed(false);
  }, [url]);

  if (trimmed === '' || failed) {
    return (
      <span className="px-1 text-center text-[10px] leading-4 text-muted">
        {trimmed === '' ? 'بدون تصویر' : 'تصویر باز نشد'}
      </span>
    );
  }

  return (
    <img
      src={trimmed}
      alt="پیش‌نمایش تصویر محصول"
      loading="lazy"
      onError={() => setFailed(true)}
      className="h-full w-full object-cover"
    />
  );
}

/** A broken image simply disappears instead of leaving a broken-image glyph in the row. */
function ProductThumb({ url }: { url: string | null }) {
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    setFailed(false);
  }, [url]);

  if (!url || failed) return null;

  return (
    <img
      src={url}
      alt=""
      loading="lazy"
      onError={() => setFailed(true)}
      className="size-10 shrink-0 rounded-xl border border-line object-cover"
    />
  );
}

/**
 * Catalogue management.
 *
 * This is the write side of the QR menu: the same tables the customer page
 * reads, so a saved product is on the menu immediately. Products are archived
 * rather than deleted, and a category only disappears when it is empty.
 */
export function CatalogPage() {
  const { hasPermission } = useAuth();
  const canWrite = hasPermission('catalog.write');

  const [data, setData] = useState<CatalogResponse>({ categories: [], products: [], departments: [] });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const [query, setQuery] = useState('');
  const [categoryFilter, setCategoryFilter] = useState('');
  const [showArchived, setShowArchived] = useState(false);

  const [productOpen, setProductOpen] = useState(false);
  const [editingProduct, setEditingProduct] = useState<CatalogProduct | null>(null);
  const [productForm, setProductForm] = useState<ProductFormState>(blankProduct(''));

  const [optionsOpen, setOptionsOpen] = useState(false);
  const [optionsProduct, setOptionsProduct] = useState<CatalogProduct | null>(null);
  const [groups, setGroups] = useState<GroupDraft[]>([]);

  const [extrasOpen, setExtrasOpen] = useState(false);
  const [extrasProduct, setExtrasProduct] = useState<CatalogProduct | null>(null);
  const [extras, setExtras] = useState<ExtraDraft[]>([]);

  const [availabilityOpen, setAvailabilityOpen] = useState(false);
  const [availabilityProduct, setAvailabilityProduct] = useState<CatalogProduct | null>(null);
  const [availabilityWindows, setAvailabilityWindows] = useState<AvailabilityDraft[]>([]);

  const [categoryOpen, setCategoryOpen] = useState(false);
  const [editingCategory, setEditingCategory] = useState<CatalogCategory | null>(null);
  const [categoryForm, setCategoryForm] = useState<CategoryFormState>({ nameFa: '', sortOrder: '', isActive: true });

  const [importOpen, setImportOpen] = useState(false);
  const [imageBusy, setImageBusy] = useState(false);

  const [confirmMessage, setConfirmMessage] = useState<string | null>(null);
  const [confirmRun, setConfirmRun] = useState<(() => void) | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setData(await api.get<CatalogResponse>('/catalog'));
    } catch (caught) {
      setError(errorMessage(caught));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const activeCategories = useMemo(() => data.categories.filter((row) => row.isActive), [data.categories]);

  const products = useMemo(() => {
    const needle = normalizeForSearch(query);
    return data.products.filter((product) => {
      if (!showArchived && product.isArchived) return false;
      if (categoryFilter && product.categoryId !== categoryFilter) return false;
      if (needle === '') return true;
      return (
        normalizeForSearch(product.nameFa).includes(needle) ||
        normalizeForSearch(product.categoryNameFa).includes(needle) ||
        normalizeForSearch(product.descriptionFa ?? '').includes(needle)
      );
    });
  }, [categoryFilter, data.products, query, showArchived]);

  const unavailableCount = data.products.filter(
    (product) => !product.isArchived && product.isActive && !product.isAvailable,
  ).length;

  const askConfirm = (message: string, run: () => void) => {
    setConfirmMessage(message);
    setConfirmRun(() => run);
  };

  const fail = (caught: unknown) => setError(errorMessage(caught));

  /* -------------------------------- categories ------------------------------- */

  const openCategory = (category?: CatalogCategory) => {
    setEditingCategory(category ?? null);
    setCategoryForm({
      nameFa: category?.nameFa ?? '',
      sortOrder: category ? String(category.sortOrder) : '',
      isActive: category?.isActive ?? true,
    });
    setCategoryOpen(true);
  };

  const submitCategory = async () => {
    if (categoryForm.nameFa.trim() === '') {
      setError('نام دسته الزامی است.');
      return;
    }

    const sortText = categoryForm.sortOrder.trim();
    const sortOrder = sortText === '' ? undefined : parseAmountFa(sortText);
    if (sortOrder !== undefined && (!Number.isInteger(sortOrder) || sortOrder < 0 || sortOrder > 9999)) {
      setError('ترتیب نمایش باید عدد صحیح بین ۰ تا ۹۹۹۹ باشد.');
      return;
    }

    setBusy(true);
    setError(null);
    try {
      const payload = {
        nameFa: categoryForm.nameFa.trim(),
        sortOrder,
        isActive: categoryForm.isActive,
      };

      if (editingCategory) {
        await api.patch<CatalogCategory>(`/catalog/categories/${editingCategory.id}`, payload);
        setNotice(`دستهٔ «${payload.nameFa}» به‌روز شد.`);
      } else {
        await api.post<CatalogCategory>('/catalog/categories', payload);
        setNotice(`دستهٔ «${payload.nameFa}» ساخته شد.`);
      }

      setCategoryOpen(false);
      await load();
    } catch (caught) {
      fail(caught);
    } finally {
      setBusy(false);
    }
  };

  const deleteCategory = (category: CatalogCategory) => {
    askConfirm(`دستهٔ «${category.nameFa}» حذف شود؟ دسته‌های دارای محصول حذف نمی‌شوند.`, () => {
      void (async () => {
        setBusy(true);
        setError(null);
        try {
          await api.delete(`/catalog/categories/${category.id}`);
          setNotice(`دستهٔ «${category.nameFa}» حذف شد.`);
          if (categoryFilter === category.id) setCategoryFilter('');
          await load();
        } catch (caught) {
          fail(caught);
        } finally {
          setBusy(false);
        }
      })();
    });
  };

  /** Swaps one category with its neighbour and saves the whole order at once. */
  const moveCategory = async (category: CatalogCategory, direction: -1 | 1) => {
    const order = data.categories.map((row) => row.id);
    const index = order.indexOf(category.id);
    const target = index + direction;
    if (index < 0 || target < 0 || target >= order.length) return;

    const current = order[index]!;
    order[index] = order[target]!;
    order[target] = current;

    setBusy(true);
    setError(null);
    try {
      const reordered = await api.put<CatalogCategory[]>('/catalog/categories/order', { ids: order });
      setData((previous) => ({ ...previous, categories: reordered }));
      setNotice('ترتیب دسته‌ها در منو به‌روز شد.');
    } catch (caught) {
      fail(caught);
    } finally {
      setBusy(false);
    }
  };

  /** Products of the same category, archived included, in their saved order. */
  const siblingsOf = (product: CatalogProduct) =>
    data.products.filter((row) => row.categoryId === product.categoryId);

  /**
   * Swaps a product with its neighbour inside its own category. The complete
   * order travels, so a product archived in another tab is caught by the server
   * instead of silently disappearing from the new order.
   */
  const moveProduct = async (product: CatalogProduct, direction: -1 | 1) => {
    const ids = siblingsOf(product).map((row) => row.id);
    const index = ids.indexOf(product.id);
    const target = index + direction;
    if (index < 0 || target < 0 || target >= ids.length) return;

    const current = ids[index]!;
    ids[index] = ids[target]!;
    ids[target] = current;

    setBusy(true);
    setError(null);
    try {
      await api.put<CatalogProduct[]>('/catalog/products/order', { categoryId: product.categoryId, ids });
      setNotice(`ترتیب نمایش در دستهٔ «${product.categoryNameFa}» به‌روز شد.`);
      await load();
    } catch (caught) {
      fail(caught);
    } finally {
      setBusy(false);
    }
  };

  const toggleCategory = async (category: CatalogCategory) => {
    setError(null);
    try {
      await api.patch(`/catalog/categories/${category.id}`, { isActive: !category.isActive });
      await load();
    } catch (caught) {
      fail(caught);
    }
  };

  /* --------------------------------- products -------------------------------- */

  const openProduct = (product?: CatalogProduct) => {
    setEditingProduct(product ?? null);
    setProductForm(
      product
        ? {
            nameFa: product.nameFa,
            categoryId: product.categoryId,
            basePrice: String(product.basePrice),
            descriptionFa: product.descriptionFa ?? '',
            imageUrl: product.imageUrl ?? '',
            departmentId: product.departmentId ?? '',
            prepMinutes: String(product.prepMinutes),
            isAvailable: product.isAvailable,
            isActive: product.isActive,
          }
        : blankProduct(activeCategories[0]?.id ?? data.categories[0]?.id ?? ''),
    );
    setProductOpen(true);
  };

  const submitProduct = async () => {
    if (productForm.nameFa.trim() === '') {
      setError('نام محصول الزامی است.');
      return;
    }
    if (!productForm.categoryId) {
      setError('دستهٔ محصول را انتخاب کنید.');
      return;
    }
    if (productForm.basePrice.trim() === '') {
      setError('قیمت محصول الزامی است.');
      return;
    }

    // The price box accepts Persian digits and grouping characters («۱۲٬۵۰۰»),
    // so it is parsed here instead of trusting a native number input.
    const price = parseAmountFa(productForm.basePrice);
    if (!Number.isInteger(price) || price < 0) {
      setError('قیمت باید عدد صحیح ریال و غیرمنفی باشد.');
      return;
    }
    if (price > 1_000_000_000) {
      setError('قیمت بیش از حد بزرگ است.');
      return;
    }

    const prepMinutes = Math.trunc(parseAmountFa(productForm.prepMinutes));
    if (prepMinutes < 0 || prepMinutes > 240) {
      setError('زمان آماده‌سازی باید بین ۰ تا ۲۴۰ دقیقه باشد.');
      return;
    }
    if (productForm.descriptionFa.trim().length > 400) {
      setError('توضیح محصول حداکثر ۴۰۰ نویسه است.');
      return;
    }
    if (productForm.imageUrl.trim().length > 500) {
      setError('نشانی تصویر بیش از حد طولانی است.');
      return;
    }

    setBusy(true);
    setError(null);
    try {
      const payload = {
        nameFa: productForm.nameFa.trim(),
        categoryId: productForm.categoryId,
        basePrice: price,
        descriptionFa: productForm.descriptionFa.trim() || undefined,
        imageUrl: productForm.imageUrl.trim() || null,
        departmentId: productForm.departmentId || null,
        prepMinutes,
        isAvailable: productForm.isAvailable,
        isActive: productForm.isActive,
      };

      if (editingProduct) {
        await api.patch<CatalogProduct>(`/catalog/products/${editingProduct.id}`, payload);
        setNotice(`«${payload.nameFa}» به‌روز شد.`);
      } else {
        await api.post<CatalogProduct>('/catalog/products', payload);
        setNotice(`«${payload.nameFa}» به منو اضافه شد.`);
      }

      setProductOpen(false);
      await load();
    } catch (caught) {
      fail(caught);
    } finally {
      setBusy(false);
    }
  };

  /** Reads the picked photo locally and stores it through the API before saving. */
  const pickProductImage = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;

    if (!['image/png', 'image/jpeg', 'image/webp'].includes(file.type)) {
      setError('فرمت تصویر باید PNG، JPEG یا WebP باشد.');
      return;
    }
    if (file.size > 400 * 1024) {
      setError('حجم تصویر بیش از ۴۰۰ کیلوبایت است.');
      return;
    }

    const reader = new FileReader();
    reader.onload = () => {
      void (async () => {
        setImageBusy(true);
        setError(null);
        try {
          const uploaded = await api.post<{ url: string }>('/catalog/images', {
            dataUrl: String(reader.result ?? ''),
          });
          setProductForm((current) => ({ ...current, imageUrl: uploaded.url }));
        } catch (caught) {
          fail(caught);
        } finally {
          setImageBusy(false);
        }
      })();
    };
    reader.readAsDataURL(file);
  };

  const toggleAvailability = async (product: CatalogProduct) => {
    setError(null);
    try {
      await api.patch(`/catalog/products/${product.id}`, { isAvailable: !product.isAvailable });
      setNotice(
        product.isAvailable
          ? `«${product.nameFa}» موقتاً ناموجود شد.`
          : `«${product.nameFa}» دوباره قابل سفارش است.`,
      );
      await load();
    } catch (caught) {
      fail(caught);
    }
  };

  const archiveProduct = (product: CatalogProduct) => {
    askConfirm(`«${product.nameFa}» بایگانی شود؟ از منو حذف می‌شود و بعداً قابل بازگردانی است.`, () => {
      void (async () => {
        setError(null);
        try {
          await api.delete(`/catalog/products/${product.id}`);
          setNotice(`«${product.nameFa}» بایگانی شد.`);
          await load();
        } catch (caught) {
          fail(caught);
        }
      })();
    });
  };

  const restoreProduct = async (product: CatalogProduct) => {
    setError(null);
    try {
      await api.patch(`/catalog/products/${product.id}`, { isArchived: false });
      setNotice(`«${product.nameFa}» به منو بازگشت.`);
      await load();
    } catch (caught) {
      fail(caught);
    }
  };

  /* ---------------------------------- options -------------------------------- */

  const openOptions = (product: CatalogProduct) => {
    setOptionsProduct(product);
    setGroups(
      product.optionGroups.map((group) => ({
        nameFa: group.nameFa,
        minSelect: String(group.minSelect),
        maxSelect: String(group.maxSelect),
        isRequired: group.isRequired,
        options: group.options.map((option) => ({
          nameFa: option.nameFa,
          priceDelta: String(option.priceDelta),
          isActive: option.isActive,
        })),
      })),
    );
    setOptionsOpen(true);
  };

  const updateGroup = (index: number, patch: Partial<GroupDraft>) => {
    setGroups((current) => current.map((group, position) => (position === index ? { ...group, ...patch } : group)));
  };

  const updateOption = (groupIndex: number, optionIndex: number, patch: Partial<OptionDraft>) => {
    setGroups((current) =>
      current.map((group, position) =>
        position === groupIndex
          ? {
              ...group,
              options: group.options.map((option, optionPosition) =>
                optionPosition === optionIndex ? { ...option, ...patch } : option,
              ),
            }
          : group,
      ),
    );
  };

  /** What a guest pays with this delta alone, so a negative price is obvious. */
  const optionFinalPriceHint = (option: OptionDraft): string | undefined => {
    if (!optionsProduct) return undefined;
    const final = optionsProduct.basePrice + parseAmountFa(option.priceDelta);
    return final < 0 ? 'قیمت نهایی منفی می‌شود' : `قیمت نهایی: ${formatRial(final)}`;
  };

  /**
   * The server rejects an impossible group, but a manager should see which row
   * is wrong before a round-trip. A minimum that cannot be met by the active
   * options makes the product impossible to order from the QR menu.
   */
  const validateOptionGroups = (): string | null => {
    if (groups.length > 10) return 'هر محصول حداکثر ۱۰ گروه گزینه می‌تواند داشته باشد.';

    const groupNames = new Set<string>();
    for (const group of groups) {
      const name = group.nameFa.trim();
      if (name === '') return 'نام همهٔ گروه‌های گزینه الزامی است.';

      const groupKey = normalizeForSearch(name);
      if (groupNames.has(groupKey)) return `گروه «${name}» تکراری است.`;
      groupNames.add(groupKey);

      const options = group.options;
      if (options.length === 0) return `گروه «${name}» حداقل یک گزینه می‌خواهد.`;
      if (options.length > 20) return `گروه «${name}» بیش از ۲۰ گزینه دارد.`;

      const minSelect = Math.trunc(parseAmountFa(group.minSelect));
      const maxSelect = Math.trunc(parseAmountFa(group.maxSelect));
      if (minSelect < 0) return `حداقل انتخاب گروه «${name}» نمی‌تواند منفی باشد.`;
      if (maxSelect < 1) return `حداکثر انتخاب گروه «${name}» باید حداقل ۱ باشد.`;
      if (maxSelect < minSelect) return `در گروه «${name}» حداکثر انتخاب نباید از حداقل کمتر باشد.`;

      const activeCount = options.filter((option) => option.isActive).length;
      if (minSelect > activeCount) {
        return `گروه «${name}» حداقل ${minSelect} انتخاب می‌خواهد اما ${activeCount} گزینهٔ فعال دارد.`;
      }

      const optionNames = new Set<string>();
      for (const option of options) {
        const optionName = option.nameFa.trim();
        if (optionName === '') return `همهٔ گزینه‌های گروه «${name}» نام می‌خواهند.`;
        const optionKey = normalizeForSearch(optionName);
        if (optionNames.has(optionKey)) return `گزینهٔ «${optionName}» در گروه «${name}» تکراری است.`;
        optionNames.add(optionKey);
      }
    }
    return null;
  };

  const saveOptions = async () => {
    if (!optionsProduct) return;

    const invalid = validateOptionGroups();
    if (invalid) {
      setError(invalid);
      return;
    }

    setBusy(true);
    setError(null);
    try {
      const payload = {
        groups: groups.map((group) => ({
          nameFa: group.nameFa.trim(),
          minSelect: Math.max(0, Math.trunc(parseAmountFa(group.minSelect))),
          maxSelect: Math.max(1, Math.trunc(parseAmountFa(group.maxSelect))),
          isRequired: group.isRequired,
          options: group.options.map((option) => ({
            nameFa: option.nameFa.trim(),
            priceDelta: Math.trunc(parseAmountFa(option.priceDelta)),
            isActive: option.isActive,
          })),
        })),
      };

      await api.put<CatalogProduct>(`/catalog/products/${optionsProduct.id}/options`, payload);
      setOptionsOpen(false);
      setNotice(`گزینه‌های «${optionsProduct.nameFa}» ذخیره شد.`);
      await load();
    } catch (caught) {
      fail(caught);
    } finally {
      setBusy(false);
    }
  };

  const openExtras = (product: CatalogProduct) => {
    setExtrasProduct(product);
    setExtras(product.extras.map((extra) => ({
      nameFa: extra.nameFa,
      price: String(extra.price),
      isActive: extra.isActive,
    })));
    setExtrasOpen(true);
  };

  const saveExtras = async () => {
    if (!extrasProduct) return;
    if (extras.length > 30) {
      setError('هر محصول حداکثر ۳۰ افزودنی می‌تواند داشته باشد.');
      return;
    }

    const extraNames = new Set<string>();
    for (const extra of extras) {
      const name = extra.nameFa.trim();
      if (name === '' || extra.price.trim() === '') {
        setError('نام و قیمت همهٔ افزودنی‌ها الزامی است.');
        return;
      }
      const price = parseAmountFa(extra.price);
      if (!Number.isInteger(price) || price < 0) {
        setError('قیمت افزودنی باید عدد صحیح ریال و غیرمنفی باشد.');
        return;
      }
      const key = normalizeForSearch(name);
      if (extraNames.has(key)) {
        setError(`افزودنی «${name}» در همین محصول تکراری است.`);
        return;
      }
      extraNames.add(key);
    }

    setBusy(true);
    setError(null);
    try {
      await api.put<CatalogProduct>(`/catalog/products/${extrasProduct.id}/extras`, {
        extras: extras.map((extra) => ({
          nameFa: extra.nameFa.trim(),
          price: parseAmountFa(extra.price),
          isActive: extra.isActive,
        })),
      });
      setExtrasOpen(false);
      setNotice(`افزودنی‌های «${extrasProduct.nameFa}» ذخیره شد.`);
      await load();
    } catch (caught) {
      fail(caught);
    } finally {
      setBusy(false);
    }
  };

  const openAvailability = (product: CatalogProduct) => {
    setAvailabilityProduct(product);
    setAvailabilityWindows(product.availabilityWindows.map((window) => ({
      weekday: window.weekday === null ? '' : String(window.weekday),
      startTime: window.startTime,
      endTime: window.endTime,
    })));
    setAvailabilityOpen(true);
  };

  const saveAvailability = async () => {
    if (!availabilityProduct) return;

    if (availabilityWindows.length > 30) {
      setError('هر محصول حداکثر ۳۰ بازهٔ سرو می‌تواند داشته باشد.');
      return;
    }

    const seenWindows = new Set<string>();
    for (const window of availabilityWindows) {
      const key = `${window.weekday}|${window.startTime}|${window.endTime}`;
      if (seenWindows.has(key)) {
        setError('این بازه دو بار تکرار شده است؛ بازهٔ تکراری را حذف کنید.');
        return;
      }
      seenWindows.add(key);
    }

    const validTime = (value: string) => {
      const [hourText, minuteText] = value.split(':');
      const digitsOnly = (part: string) => part.length === 2 && [...part].every((char) => char >= '0' && char <= '9');
      if (value.length !== 5 || value[2] !== ':' || !digitsOnly(hourText ?? '') || !digitsOnly(minuteText ?? '')) return false;
      const hour = Number(hourText);
      const minute = Number(minuteText);
      return hour <= 23 && minute <= 59;
    };
    if (availabilityWindows.some((window) =>
      !validTime(window.startTime) ||
      !validTime(window.endTime) ||
      window.startTime >= window.endTime
    )) {
      setError('ساعت‌ها را به‌شکل HH:mm وارد کنید و پایان هر بازه را بعد از شروع آن بگذارید.');
      return;
    }

    setBusy(true);
    setError(null);
    try {
      await api.put<CatalogProduct>(`/catalog/products/${availabilityProduct.id}/availability`, {
        windows: availabilityWindows.map((window) => ({
          weekday: window.weekday === '' ? null : Number(window.weekday),
          startTime: window.startTime,
          endTime: window.endTime,
        })),
      });
      setAvailabilityOpen(false);
      setNotice(`ساعت‌های سرو «${availabilityProduct.nameFa}» ذخیره شد.`);
      await load();
    } catch (caught) {
      fail(caught);
    } finally {
      setBusy(false);
    }
  };

  /* ---------------------------------- render --------------------------------- */

  const columns: Column<CatalogProduct>[] = [
    {
      key: 'name',
      header: 'محصول',
      render: (product) => (
        <div className="flex items-center gap-2.5">
          <ProductThumb url={product.imageUrl} />
          <div className="min-w-0 space-y-0.5">
            <p className="font-medium text-ink">{product.nameFa}</p>
            {product.descriptionFa ? (
              <p className="line-clamp-1 text-[11px] text-muted">{product.descriptionFa}</p>
            ) : null}
          </div>
        </div>
      ),
    },
    {
      key: 'category',
      header: 'دسته',
      render: (product) => <span className="text-xs text-muted">{product.categoryNameFa}</span>,
    },
    {
      key: 'price',
      header: 'قیمت',
      render: (product) => <span className="num text-xs">{formatRial(product.basePrice)}</span>,
    },
    {
      key: 'department',
      header: 'واحد',
      render: (product) => (
        <span className="text-xs text-muted">{product.departmentNameFa ?? '—'}</span>
      ),
    },
    {
      key: 'options',
      header: 'گزینه‌ها',
      render: (product) => {
        const optionCount = product.optionGroups.reduce((total, group) => total + group.options.length, 0);
        return (
          <span className="text-xs text-muted">
            {product.optionGroups.length > 0
              ? `${product.optionGroups.length} گروه / ${optionCount} گزینه`
              : 'بدون گزینه'}
          </span>
        );
      },
    },
    { key: 'status', header: 'وضعیت', render: (product) => <ProductStatus product={product} /> },
    {
      key: 'actions',
      header: 'عملیات',
      align: 'end',
      render: (product) => (
        <div className="flex flex-wrap items-center justify-end gap-1.5">
          {canWrite ? (
            <>
              <Button
                size="sm"
                variant="ghost"
                aria-label={`جابه‌جایی «${product.nameFa}» به بالا`}
                disabled={busy || siblingsOf(product)[0]?.id === product.id}
                onClick={() => void moveProduct(product, -1)}
              >
                ↑
              </Button>
              <Button
                size="sm"
                variant="ghost"
                aria-label={`جابه‌جایی «${product.nameFa}» به پایین`}
                disabled={busy || siblingsOf(product)[siblingsOf(product).length - 1]?.id === product.id}
                onClick={() => void moveProduct(product, 1)}
              >
                ↓
              </Button>
              <Button size="sm" variant="ghost" onClick={() => openProduct(product)}>
                ویرایش
              </Button>
              <Button size="sm" variant="ghost" onClick={() => openOptions(product)}>
                گزینه‌ها
              </Button>
              <Button size="sm" variant="ghost" onClick={() => openExtras(product)}>
                افزودنی‌ها              </Button>
              <Button size="sm" variant="ghost" onClick={() => openAvailability(product)}>
                ساعت سرو
              </Button>
              {product.isArchived ? (
                <Button size="sm" variant="ghost" onClick={() => void restoreProduct(product)}>
                  بازگردانی
                </Button>
              ) : (
                <>
                  <Switch
                    checked={product.isAvailable}
                    onChange={() => void toggleAvailability(product)}
                    label={`وضعیت موجودی ${product.nameFa}`}
                  />
                  <Button size="sm" variant="ghost" onClick={() => archiveProduct(product)}>
                    بایگانی
                  </Button>
                </>
              )}
            </>
          ) : (
            <span className="text-[11px] text-muted">فقط مشاهده</span>
          )}
        </div>
      ),
    },
  ];

  if (loading && data.categories.length === 0) {
    return (
      <div className="flex min-h-[50vh] items-center justify-center text-brand-600">
        <Spinner size="lg" label="در حال بارگذاری منو…" />
      </div>
    );
  }

  if (error && data.categories.length === 0) {
    return <ErrorState message={error} onRetry={() => void load()} />;
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="منو و محصولات"
        description="دسته‌ها، محصولات و گزینه‌های منو را اینجا مدیریت کنید؛ تغییرات بلافاصله در منوی QR دیده می‌شود."
        actions={
          canWrite ? (
            <>
              <Button variant="ghost" onClick={() => setImportOpen(true)}>
                ایمپورت CSV
              </Button>
              <Button variant="secondary" onClick={() => openCategory()}>
                دستهٔ جدید
              </Button>
              <Button onClick={() => openProduct()}>محصول جدید</Button>
            </>
          ) : (
            <span className="text-xs text-muted">برای ویرایش منو دسترسی «مدیریت منو و محصولات» لازم است.</span>
          )
        }
      />

      {notice ? (
        <Alert tone="success" title="انجام شد">
          {notice}
        </Alert>
      ) : null}
      {error ? (
        <Alert tone="danger" title="خطا">
          {error}
        </Alert>
      ) : null}

      <div className="grid gap-4 sm:grid-cols-3">
        <Card>
          <CardBody>
            <p className="text-[11px] text-muted">دسته‌های فعال</p>
            <p className="num mt-1 font-display text-2xl font-bold text-ink">{activeCategories.length}</p>
          </CardBody>
        </Card>
        <Card>
          <CardBody>
            <p className="text-[11px] text-muted">محصولات در منو</p>
            <p className="num mt-1 font-display text-2xl font-bold text-ink">
              {data.products.filter((product) => !product.isArchived).length}
            </p>
          </CardBody>
        </Card>
        <Card>
          <CardBody>
            <p className="text-[11px] text-muted">ناموجود</p>
            <p className="num mt-1 font-display text-2xl font-bold text-ink">{unavailableCount}</p>
          </CardBody>
        </Card>
      </div>

      <div className="grid min-w-0 gap-6 lg:grid-cols-[20rem_1fr]">
        <Card className="min-w-0 self-start">
          <CardHeader title="دسته‌ها" description="ترتیب نمایش در منوی مشتری" />
          <CardBody className="space-y-3">
            {data.categories.length === 0 ? (
              <p className="text-xs text-muted">هنوز دسته‌ای ساخته نشده است.</p>
            ) : (
              data.categories.map((category, position) => (
                <div key={category.id} className="rounded-2xl border border-line/80 px-3 py-2.5">
                  <div className="flex items-center justify-between gap-2">
                    <div className="min-w-0">
                      <p className="truncate text-sm font-medium text-ink">{category.nameFa}</p>
                      <p className="num text-[10.5px] text-muted">
                        {category.productCount} محصول · ترتیب {category.sortOrder}
                      </p>
                    </div>
                  </div>

                  {canWrite ? (
                    <div className="mt-2 flex items-center justify-between gap-2">
                      <div className="flex items-center gap-2">
                        <Switch
                          checked={category.isActive}
                          onChange={() => void toggleCategory(category)}
                          label={`نمایش دستهٔ ${category.nameFa} در منو`}
                        />
                        <span className="text-[10.5px] text-muted">{category.isActive ? 'فعال' : 'پنهان'}</span>
                      </div>
                      <div className="flex items-center gap-1">
                        <Button
                          size="sm"
                          variant="ghost"
                          aria-label={`جابه‌جایی «${category.nameFa}» به بالا`}
                          disabled={busy || position === 0}
                          onClick={() => void moveCategory(category, -1)}
                        >
                          ↑
                        </Button>
                        <Button
                          size="sm"
                          variant="ghost"
                          aria-label={`جابه‌جایی «${category.nameFa}» به پایین`}
                          disabled={busy || position === data.categories.length - 1}
                          onClick={() => void moveCategory(category, 1)}
                        >
                          ↓
                        </Button>
                        <Button size="sm" variant="ghost" onClick={() => openCategory(category)}>
                          ویرایش
                        </Button>
                        <Button size="sm" variant="ghost" onClick={() => deleteCategory(category)}>
                          حذف
                        </Button>
                      </div>
                    </div>
                  ) : null}
                </div>
              ))
            )}
          </CardBody>
        </Card>

        <Card className="min-w-0">
          <CardHeader
            title="محصولات"
            description="قیمت‌ها به ریال و فقط از این صفحه تغییر می‌کنند؛ با ↑/↓ ترتیب نمایش هر محصول در دستهٔ خودش را تعیین کنید."
            action={
              <div className="flex items-center gap-2">
                <span className="text-[11px] text-muted">نمایش بایگانی</span>
                <Switch
                  checked={showArchived}
                  onChange={setShowArchived}
                  label="نمایش محصولات بایگانی‌شده"
                />
              </div>
            }
          />
          <CardBody className="space-y-4">
            <div className="flex flex-wrap items-center gap-2">
              <div className="min-w-48 flex-1">
                <Input
                  type="search"
                  placeholder="جست‌وجوی نام محصول یا دسته…"
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                  aria-label="جست‌وجوی محصول"
                />
              </div>
              <select
                className={`${selectClass} max-w-52`}
                value={categoryFilter}
                onChange={(event) => setCategoryFilter(event.target.value)}
                aria-label="فیلتر دسته"
              >
                <option value="">همهٔ دسته‌ها</option>
                {data.categories.map((category) => (
                  <option key={category.id} value={category.id}>
                    {category.nameFa}
                  </option>
                ))}
              </select>
            </div>

            <DataTable
              columns={columns}
              rows={products}
              rowKey={(product) => product.id}
              caption="فهرست محصولات منو"
              empty={
                <EmptyState
                  title="محصولی با این فیلترها پیدا نشد"
                  description="فیلتر دسته را بردارید یا محصول تازه‌ای اضافه کنید."
                />
              }
            />
          </CardBody>
        </Card>
      </div>

      <ImportModal
        open={importOpen}
        onClose={() => setImportOpen(false)}
        onImported={(summary) => {
          setImportOpen(false);
          setNotice(
            `ایمپورت انجام شد: ${summary.created} محصول تازه، ${summary.updated} به‌روزرسانی و ${summary.errors} خطا.`,
          );
          void load();
        }}
      />

      <Modal
        open={productOpen}
        onClose={() => setProductOpen(false)}
        title={editingProduct ? `ویرایش «${editingProduct.nameFa}»` : 'محصول جدید'}
        description="قیمت پایه به ریال ذخیره می‌شود؛ مالیات و حق سرویس هنگام سفارش اضافه می‌شوند."
        size="lg"
        footer={
          <>
            <Button variant="ghost" onClick={() => setProductOpen(false)}>
              انصراف
            </Button>
            <Button loading={busy} onClick={() => void submitProduct()}>
              {editingProduct ? 'ذخیرهٔ تغییرات' : 'افزودن به منو'}
            </Button>
          </>
        }
      >
        <div className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="نام محصول" required>
              <Input
                value={productForm.nameFa}
                onChange={(event) => setProductForm({ ...productForm, nameFa: event.target.value })}
                placeholder="مثلاً: لاته وانیل"
              />
            </Field>
            <Field label="دسته" required>
              <select
                className={selectClass}
                value={productForm.categoryId}
                onChange={(event) => setProductForm({ ...productForm, categoryId: event.target.value })}
              >
                <option value="">انتخاب دسته</option>
                {data.categories.map((category) => (
                  <option key={category.id} value={category.id}>
                    {category.nameFa}
                    {category.isActive ? '' : ' (پنهان)'}
                  </option>
                ))}
              </select>
            </Field>
          </div>

          <div className="grid gap-4 sm:grid-cols-3">
            <Field label="قیمت (ریال)" required hint={formatRial(Math.max(0, Math.trunc(parseAmountFa(productForm.basePrice))))}>
              <Input
                type="text"
                inputMode="numeric"
                dir="ltr"
                value={productForm.basePrice}
                onChange={(event) => setProductForm({ ...productForm, basePrice: event.target.value })}
              />
            </Field>
            <Field label="زمان آماده‌سازی (دقیقه)">
              <Input
                type="number"
                min={0}
                max={240}
                step={1}
                value={productForm.prepMinutes}
                onChange={(event) => setProductForm({ ...productForm, prepMinutes: event.target.value })}
              />
            </Field>
            <Field label="واحد آماده‌سازی">
              <select
                className={selectClass}
                value={productForm.departmentId}
                onChange={(event) => setProductForm({ ...productForm, departmentId: event.target.value })}
              >
                <option value="">پیش‌فرض کافه</option>
                {data.departments.map((department) => (
                  <option key={department.id} value={department.id}>
                    {department.nameFa}
                  </option>
                ))}
              </select>
            </Field>
          </div>

          <Field label="توضیح برای مشتری" hint="اختیاری؛ در کارت منو دیده می‌شود.">
            <Textarea
              rows={3}
              value={productForm.descriptionFa}
              onChange={(event) => setProductForm({ ...productForm, descriptionFa: event.target.value })}
              placeholder="مثلاً: اسپرسو دو شات با شیر بخارپز"
            />
          </Field>

          <Field label="نشانی تصویر محصول" hint="اختیاری؛ HTTPS یا مسیر فایلِ همین سایت. آپلود فایل در این فرم وجود ندارد.">
            <div className="flex items-start gap-3">
              <div className="flex size-20 shrink-0 items-center justify-center overflow-hidden rounded-2xl border border-line bg-surface">
                <ProductImagePreview url={productForm.imageUrl} />
              </div>
              <div className="min-w-0 flex-1 space-y-2">
                <Input
                  type="url"
                  inputMode="url"
                  dir="ltr"
                  value={productForm.imageUrl}
                  onChange={(event) => setProductForm({ ...productForm, imageUrl: event.target.value })}
                  placeholder="https://example.com/product.jpg یا /images/product.webp"
                />
                <div className="flex flex-wrap items-center gap-2">
                  <label className="inline-flex h-9 cursor-pointer items-center rounded-full border border-line bg-surface px-4 text-xs font-medium text-ink hover:border-brand-400">
                    {imageBusy ? 'در حال آپلود…' : 'آپلود تصویر'}
                    <input
                      type="file"
                      accept="image/png,image/jpeg,image/webp"
                      className="sr-only"
                      onChange={pickProductImage}
                      disabled={imageBusy}
                    />
                  </label>
                  {productForm.imageUrl.trim() !== '' ? (
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => setProductForm({ ...productForm, imageUrl: '' })}
                    >
                      حذف تصویر
                    </Button>
                  ) : null}
                </div>
              </div>
            </div>
          </Field>

          <div className="flex flex-wrap items-center gap-6">
            <div className="flex items-center gap-2">
              <Switch
                checked={productForm.isAvailable}
                onChange={(next) => setProductForm({ ...productForm, isAvailable: next })}
                label="موجود بودن محصول"
              />
              <span className="text-xs text-ink">موجود است</span>
            </div>
            <div className="flex items-center gap-2">
              <Switch
                checked={productForm.isActive}
                onChange={(next) => setProductForm({ ...productForm, isActive: next })}
                label="فعال بودن محصول"
              />
              <span className="text-xs text-ink">در منو نمایش داده شود</span>
            </div>
          </div>
        </div>
      </Modal>

      <Modal
        open={optionsOpen}
        onClose={() => setOptionsOpen(false)}
        title={`گزینه‌های «${optionsProduct?.nameFa ?? ''}»`}
        description="هر گروه می‌تواند اجباری باشد و اختلاف قیمت هر گزینه به قیمت پایه اضافه می‌شود."
        size="lg"
        footer={
          <>
            <Button variant="ghost" onClick={() => setOptionsOpen(false)}>
              انصراف
            </Button>
            <Button loading={busy} onClick={() => void saveOptions()}>
              ذخیرهٔ گزینه‌ها
            </Button>
          </>
        }
      >
        <div className="space-y-4">
          {groups.length === 0 ? (
            <p className="text-xs text-muted">این محصول هنوز گروه گزینه‌ای ندارد.</p>
          ) : null}

          {groups.map((group, groupIndex) => (
            <div key={groupIndex} className="space-y-3 rounded-2xl border border-line/80 p-4">
              <div className="flex items-end gap-2">
                <div className="flex-1">
                  <Field label="نام گروه" required>
                    <Input
                      value={group.nameFa}
                      onChange={(event) => updateGroup(groupIndex, { nameFa: event.target.value })}
                      placeholder="مثلاً: نوع شیر"
                    />
                  </Field>
                </div>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => setGroups(groups.filter((_, position) => position !== groupIndex))}
                >
                  حذف گروه
                </Button>
              </div>

              <div className="grid gap-3 sm:grid-cols-3">
                <Field label="حداقل انتخاب">
                  <Input
                    type="number"
                    min={0}
                    max={20}
                    value={group.minSelect}
                    onChange={(event) => updateGroup(groupIndex, { minSelect: event.target.value })}
                  />
                </Field>
                <Field label="حداکثر انتخاب">
                  <Input
                    type="number"
                    min={1}
                    max={20}
                    value={group.maxSelect}
                    onChange={(event) => updateGroup(groupIndex, { maxSelect: event.target.value })}
                  />
                </Field>
                <div className="flex items-end gap-2 pb-2">
                  <Switch
                    checked={group.isRequired}
                    onChange={(next) =>
                      updateGroup(groupIndex, {
                        isRequired: next,
                        // «اجباری» یعنی حداقل یک انتخاب؛ صفر گذاشتنش با
                        // برچسب گروه در تناقض بود.
                        minSelect: next && parseAmountFa(group.minSelect) < 1 ? '1' : group.minSelect,
                      })
                    }
                    label={`اجباری بودن گروه ${group.nameFa}`}
                  />
                  <span className="text-xs text-ink">انتخاب اجباری</span>
                </div>
              </div>

              <div className="space-y-2">
                {group.options.map((option, optionIndex) => (
                  <div key={optionIndex} className="flex flex-wrap items-end gap-2">
                    <div className="min-w-40 flex-1">
                      <Field label={optionIndex === 0 ? 'گزینه' : ''}>
                        <Input
                          value={option.nameFa}
                          onChange={(event) => updateOption(groupIndex, optionIndex, { nameFa: event.target.value })}
                          placeholder="مثلاً: شیر بادام"
                        />
                      </Field>
                    </div>
                    <div className="w-36">
                      <Field
                        label={optionIndex === 0 ? 'اختلاف قیمت' : ''}
                        hint={optionFinalPriceHint(option)}
                      >
                        <Input
                          type="text"
                          inputMode="numeric"
                          dir="ltr"
                          value={option.priceDelta}
                          onChange={(event) =>
                            updateOption(groupIndex, optionIndex, { priceDelta: event.target.value })
                          }
                        />
                      </Field>
                    </div>
                    <div className="flex items-center gap-2 pb-2">
                      <Switch
                        checked={option.isActive}
                        onChange={(next) => updateOption(groupIndex, optionIndex, { isActive: next })}
                        label={`فعال بودن گزینه ${option.nameFa || optionIndex + 1}`}
                      />
                      <span className="text-[11px] text-muted">فعال</span>
                    </div>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() =>
                        updateGroup(groupIndex, {
                          options: group.options.filter((_, position) => position !== optionIndex),
                        })
                      }
                    >
                      حذف
                    </Button>
                  </div>
                ))}
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={() =>
                    updateGroup(groupIndex, {
                      options: [...group.options, { nameFa: '', priceDelta: '0', isActive: true }],
                    })
                  }
                >
                  افزودن گزینه
                </Button>
              </div>
            </div>
          ))}

          <Button variant="secondary" onClick={() => setGroups([...groups, blankGroup()])}>
            افزودن گروه گزینه
          </Button>
        </div>
      </Modal>

      <Modal
        open={extrasOpen}
        onClose={() => setExtrasOpen(false)}
        title={`افزودنی‌های «${extrasProduct?.nameFa ?? ''}»`}
        description="قیمت افزودنی هنگام ثبت سفارش از سرور خوانده و به قیمت محصول اضافه می‌شود."
        size="lg"
        footer={
          <>
            <Button variant="ghost" onClick={() => setExtrasOpen(false)}>
              انصراف
            </Button>
            <Button loading={busy} onClick={() => void saveExtras()}>
              ذخیرهٔ افزودنی‌ها
            </Button>
          </>
        }
      >
        <div className="space-y-3">
          {extras.length === 0 ? (
            <p className="text-xs text-muted">برای این محصول افزودنی ثبت نشده است.</p>
          ) : null}
          {extras.map((extra, index) => (
            <div key={index} className="flex flex-wrap items-end gap-2 rounded-2xl border border-line/80 p-3">
              <div className="min-w-40 flex-1">
                <Field label="نام افزودنی" required>
                  <Input
                    value={extra.nameFa}
                    onChange={(event) => setExtras((current) => current.map((row, position) =>
                      position === index ? { ...row, nameFa: event.target.value } : row,
                    ))}
                    placeholder="مثلاً: شات اضافه"
                  />
                </Field>
              </div>
              <div className="w-40">
                <Field label="قیمت (ریال)" required>
                  <Input
                    type="text"
                    inputMode="numeric"
                    dir="ltr"
                    value={extra.price}
                    onChange={(event) => setExtras((current) => current.map((row, position) =>
                      position === index ? { ...row, price: event.target.value } : row,
                    ))}
                  />
                </Field>
              </div>
              <div className="flex items-center gap-2 pb-2">
                <Switch
                  checked={extra.isActive}
                  onChange={(next) => setExtras((current) => current.map((row, position) =>
                    position === index ? { ...row, isActive: next } : row,
                  ))}
                  label={`فعال بودن افزودنی ${extra.nameFa || index + 1}`}
                />
                <span className="text-xs text-ink">فعال</span>
              </div>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setExtras((current) => current.filter((_, position) => position !== index))}
              >
                حذف
              </Button>
            </div>
          ))}
          <Button
            variant="secondary"
            onClick={() => setExtras((current) => [...current, { nameFa: '', price: '0', isActive: true }])}
          >
            افزودن ردیف
          </Button>
        </div>
      </Modal>

      <Modal
        open={availabilityOpen}
        onClose={() => setAvailabilityOpen(false)}
        title={`ساعت سرو «${availabilityProduct?.nameFa ?? ''}»`}
        description="اگر بازه‌ای ثبت نشود، محصول همیشه از نظر ساعت قابل سفارش است. بازه‌ها بر اساس ساعت تهران اعمال می‌شوند و از نیمه‌شب عبور نمی‌کنند."
        size="lg"
        footer={
          <>
            <Button variant="ghost" onClick={() => setAvailabilityOpen(false)}>
              انصراف
            </Button>
            <Button loading={busy} onClick={() => void saveAvailability()}>
              ذخیرهٔ ساعت‌ها
            </Button>
          </>
        }
      >
        <div className="space-y-3">
          {availabilityWindows.length === 0 ? (
            <p className="text-xs text-muted">برای این محصول محدودیت زمانی ثبت نشده است.</p>
          ) : null}
          {availabilityWindows.map((window, index) => (
            <div key={index} className="grid items-end gap-2 rounded-2xl border border-line/80 p-3 sm:grid-cols-[minmax(9rem,1fr)_minmax(7rem,0.7fr)_minmax(7rem,0.7fr)_auto]">
              <Field label="روز هفته">
                <select
                  className={selectClass}
                  value={window.weekday}
                  onChange={(event) => setAvailabilityWindows((current) => current.map((row, position) =>
                    position === index ? { ...row, weekday: event.target.value } : row,
                  ))}
                >
                  <option value="">هر روز</option>
                  {WEEKDAYS.map((day) => (
                    <option key={day.value} value={day.value}>{day.label}</option>
                  ))}
                </select>
              </Field>
              <Field label="از ساعت">
                <Input
                  type="time"
                  value={window.startTime}
                  onChange={(event) => setAvailabilityWindows((current) => current.map((row, position) =>
                    position === index ? { ...row, startTime: event.target.value } : row,
                  ))}
                />
              </Field>
              <Field label="تا ساعت">
                <Input
                  type="time"
                  value={window.endTime}
                  onChange={(event) => setAvailabilityWindows((current) => current.map((row, position) =>
                    position === index ? { ...row, endTime: event.target.value } : row,
                  ))}
                />
              </Field>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setAvailabilityWindows((current) => current.filter((_, position) => position !== index))}
              >
                حذف
              </Button>
            </div>
          ))}
          <Button
            variant="secondary"
            onClick={() => setAvailabilityWindows((current) => [...current, { weekday: '', startTime: '08:00', endTime: '18:00' }])}
          >
            افزودن بازه
          </Button>
        </div>
      </Modal>

      <Modal
        open={categoryOpen}
        onClose={() => setCategoryOpen(false)}
        title={editingCategory ? `ویرایش «${editingCategory.nameFa}»` : 'دستهٔ جدید'}
        size="sm"
        footer={
          <>
            <Button variant="ghost" onClick={() => setCategoryOpen(false)}>
              انصراف
            </Button>
            <Button loading={busy} onClick={() => void submitCategory()}>
              ذخیره
            </Button>
          </>
        }
      >
        <div className="space-y-4">
          <Field label="نام دسته" required>
            <Input
              value={categoryForm.nameFa}
              onChange={(event) => setCategoryForm({ ...categoryForm, nameFa: event.target.value })}
              placeholder="مثلاً: نوشیدنی گرم"
            />
          </Field>
          <Field label="ترتیب نمایش" hint="عدد کوچک‌تر بالاتر نمایش داده می‌شود؛ خالی بگذارید تا آخر فهرست بیاید.">
            <Input
              type="number"
              min={0}
              max={9999}
              value={categoryForm.sortOrder}
              onChange={(event) => setCategoryForm({ ...categoryForm, sortOrder: event.target.value })}
            />
          </Field>
          <div className="flex items-center gap-2">
            <Switch
              checked={categoryForm.isActive}
              onChange={(next) => setCategoryForm({ ...categoryForm, isActive: next })}
              label="فعال بودن دسته"
            />
            <span className="text-xs text-ink">در منوی مشتری دیده شود</span>
          </div>
        </div>
      </Modal>

      <Modal
        open={confirmMessage !== null}
        onClose={() => setConfirmMessage(null)}
        title="تأیید عملیات"
        size="sm"
        footer={
          <>
            <Button variant="ghost" onClick={() => setConfirmMessage(null)}>
              انصراف
            </Button>
            <Button
              variant="danger"
              onClick={() => {
                confirmRun?.();
                setConfirmMessage(null);
              }}
            >
              تأیید
            </Button>
          </>
        }
      >
        <p className="text-xs leading-6 text-ink">{confirmMessage}</p>
      </Modal>
    </div>
  );
}
