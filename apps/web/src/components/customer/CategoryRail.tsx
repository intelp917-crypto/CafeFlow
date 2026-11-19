import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import type { PublicMenuCategory } from '@cafeflow/shared';

/**
 * Persistent mini icon sidebar.
 *
 * It floats away from the viewport edge (so the page shows through around it),
 * lives in a rounded capsule, and can expand in place to show labels. It stays
 * fixed while the menu scrolls, and its own list scrolls independently.
 */

interface CategoryRailProps {
  categories: PublicMenuCategory[];
  activeCategory: string | null;
  onSelect: (categoryId: string) => void;
}

interface CategoryIcon {
  path: string;
  detail?: string;
}

const CUP: CategoryIcon = {
  path: 'M5 9h11a4 4 0 0 1 0 8h-1v2H8v-2H5z',
  detail: 'M8 5c0 1.5 1 1.5 1 3M12 5c0 1.5 1 1.5 1 3',
};
const LEAF: CategoryIcon = {
  path: 'M20 4c0 8-4 12-9 12a5 5 0 0 1-5-5c0-5 6-7 14-7z',
  detail: 'M4 20c2-6 6-9 12-11',
};
const CAKE: CategoryIcon = {
  path: 'M5 20v-6a3 3 0 0 1 3-3h8a3 3 0 0 1 3 3v6',
  detail: 'M4 20h16M9 11V8M15 11V8M12 11V7',
};
const FOOD: CategoryIcon = {
  path: 'M7 3v7a2 2 0 0 0 4 0V3',
  detail: 'M9 10v11M16 3c-1.5 1.5-2 3.5-2 6s.5 4.5 2 6v6',
};
const GLASS: CategoryIcon = {
  path: 'M6 4h12l-1.5 8a5 5 0 0 1-9 0z',
  detail: 'M7 12h10M12 20v-4',
};
const BEAN: CategoryIcon = {
  path: 'M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18z',
  detail: 'M8 8c4 1 4 7 8 8',
};
const LAYERS: CategoryIcon = {
  path: 'M4 8l8-4 8 4-8 4z',
  detail: 'M4 12l8 4 8-4M4 16l8 4 8-4',
};
const BOTTLE: CategoryIcon = {
  path: 'M10 3h4v3l2 3v10a2 2 0 0 1-2 2h-4a2 2 0 0 1-2-2V9l2-3z',
  detail: 'M8 12h8',
};
const GRID: CategoryIcon = {
  path: 'M4 4h6v6H4zM14 4h6v6h-6zM4 14h6v6H4zM14 14h6v6h-6z',
};

const FALLBACKS: CategoryIcon[] = [GRID, CUP, BEAN, LAYERS, BOTTLE];

function iconFor(category: PublicMenuCategory, index: number): CategoryIcon {
  const name = `${category.nameFa} ${category.slug}`.toLowerCase();
  if (/(قهوه|اسپرسو|لاته|کاپوچینو|coffee|espresso|latte|cappuccino|americano|mocha)/.test(name)) return CUP;
  if (/(چای|دمنوش|tea|herbal|infusion)/.test(name)) return LEAF;
  if (/(شیرینی|کیک|دسر|دولچه|dessert|cake|pastry|sweet|cookie)/.test(name)) return CAKE;
  if (/(غذا|ساندویچ|برگر|پیتزا|صبحانه|املت|food|sandwich|burger|pizza|breakfast|omelet|meal)/.test(name))
    return FOOD;
  if (/(آبمیوه|نوشیدنی|شیک|لیموناد|juice|drink|shake|soda|lemonade|smoothie)/.test(name)) return GLASS;
  if (/(دانه|bean|roast)/.test(name)) return BEAN;
  return FALLBACKS[index % FALLBACKS.length]!;
}

function RailIcon({ icon, className = 'size-5' }: { icon: CategoryIcon; className?: string }) {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={`shrink-0 ${className}`}
    >
      <path d={icon.path} />
      {icon.detail ? <path d={icon.detail} /> : null}
    </svg>
  );
}

const STORAGE_KEY = 'cafeflow:rail-open';

function readOpen(): boolean {
  try {
    return localStorage.getItem(STORAGE_KEY) === '1';
  } catch {
    return false;
  }
}

export function CategoryRail({ categories, activeCategory, onSelect }: CategoryRailProps) {
  const [open, setOpen] = useState(readOpen);

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, open ? '1' : '0');
    } catch {
      // Private mode: the rail simply starts closed next time.
    }
  }, [open]);

  return (
    <aside className="fixed left-4 top-1/2 z-40 -translate-y-1/2 sm:left-5">
      <div
        className={`flex max-h-[78vh] flex-col rounded-[2rem] border border-line/70 bg-surface/95 shadow-[0_30px_80px_-30px_rgba(36,22,17,0.55)] backdrop-blur transition-[width] duration-300 ${
          open ? 'w-48' : 'w-[4.5rem]'
        }`}
      >
        <div className={`flex items-center p-2 ${open ? 'justify-between' : 'justify-center'}`}>
          {open ? (
            <span className="ps-2 font-display text-sm font-bold text-ink">منو</span>
          ) : null}
          <button
            type="button"
            onClick={() => setOpen((value) => !value)}
            aria-expanded={open}
            aria-controls="menu-rail-list"
            aria-label={open ? 'جمع‌کردن نوار دسته‌ها' : 'بازکردن نوار دسته‌ها'}
            className="flex size-9 items-center justify-center rounded-full border border-line bg-surface text-ink shadow-sm hover:bg-cream"
          >
            <svg
              aria-hidden="true"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.8"
              strokeLinecap="round"
              strokeLinejoin="round"
              className={`size-4 transition-transform duration-300 ${open ? 'rotate-180' : ''}`}
            >
              <path d="M9 6l6 6-6 6" />
            </svg>
          </button>
        </div>

        <div className="mx-3 h-px bg-line/80" />

        <ul
          id="menu-rail-list"
          className="scroll-thin flex-1 space-y-1.5 overflow-y-auto overscroll-contain px-2.5 py-3"
        >
          {categories.map((category, index) => {
            const active = activeCategory === category.id;
            return (
              <li key={category.id} className="group relative">
                <button
                  type="button"
                  onClick={() => onSelect(category.id)}
                  aria-current={active ? 'true' : undefined}
                  aria-label={category.nameFa}
                  title={open ? undefined : category.nameFa}
                  className={`flex w-full items-center gap-3 rounded-full text-start text-xs ${
                    open ? 'p-1' : 'flex-col justify-center gap-1 py-0.5'
                  } ${active ? 'font-semibold' : ''}`}
                >
                  <span
                    className={`flex size-10 shrink-0 items-center justify-center rounded-full border ${
                      active
                        ? 'border-espresso bg-espresso text-cream'
                        : 'border-transparent bg-cream/70 text-ink/70 group-hover:border-line group-hover:bg-cream'
                    }`}
                  >
                    <RailIcon icon={iconFor(category, index)} />
                  </span>
                  {!open ? (
                    <span className="line-clamp-2 w-full break-words px-0.5 text-center text-[11px] leading-tight text-ink">
                      {category.nameFa}
                    </span>
                  ) : null}
                  {open ? (
                    <span className="min-w-0 flex-1 pe-2">
                      <span className="block truncate text-[11px] text-ink">{category.nameFa}</span>
                      <span className="num block text-[9px] text-muted">
                        {category.products.length} آیتم
                      </span>
                    </span>
                  ) : null}
                </button>
              </li>
            );
          })}
        </ul>

        <div className="mx-3 h-px bg-line/80" />

        <div className="p-2">
          <Link
            to="/staff/login"
            aria-label="ورود کارکنان"
            title="ورود کارکنان"
            className={`flex items-center gap-3 rounded-full text-ink/70 hover:text-ink ${
              open ? 'p-1' : 'justify-center p-0'
            }`}
          >
            <span className="flex size-10 items-center justify-center rounded-full border border-transparent bg-cream/70">
              <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" className="size-5">
                <path d="M15 4h3a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2h-3" strokeLinecap="round" />
                <path d="M10 8l4 4-4 4M14 12H4" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </span>
            {open ? <span className="text-[11px]">ورود کارکنان</span> : null}
          </Link>
        </div>
      </div>
    </aside>
  );
}
