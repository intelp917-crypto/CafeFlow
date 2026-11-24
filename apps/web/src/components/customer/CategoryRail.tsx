import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import type { PublicMenuCategory } from '@cafeflow/shared';
import { cn } from '@cafeflow/ui';
import { formatCountFa } from '../../lib/format';

/**
 * Persistent category rail — the menu's only category index.
 *
 * A single floating capsule on the left edge that always shows the category
 * names, never scrolls out of view and keeps its own list scrollable. On
 * tablets and up it opens in place (hover or the pin button) to reveal counts
 * and the staff login; on phones it stays compact with the name under each
 * icon.
 *
 * It floats *over* the page instead of taking a column, so the menu keeps its
 * full width. That is safe because the capsule is narrow, translucent and
 * height-fitted to its items: it sits in the page's own margin and never
 * stretches into an empty panel over content.
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
      className={cn('shrink-0', className)}
    >
      <path d={icon.path} />
      {icon.detail ? <path d={icon.detail} /> : null}
    </svg>
  );
}

const STORAGE_KEY = 'cafeflow:rail-open';
const WIDE_QUERY = '(min-width: 768px)';

function readPinned(): boolean {
  try {
    return localStorage.getItem(STORAGE_KEY) === '1';
  } catch {
    return false;
  }
}

/** The rail has one body per density: compact on phones, expandable above. */
function useWideLayout(): boolean {
  const [wide, setWide] = useState(() =>
    typeof window === 'undefined' ? true : window.matchMedia(WIDE_QUERY).matches,
  );

  useEffect(() => {
    const query = window.matchMedia(WIDE_QUERY);
    const onChange = () => setWide(query.matches);
    onChange();
    query.addEventListener('change', onChange);
    return () => query.removeEventListener('change', onChange);
  }, []);

  return wide;
}

export function CategoryRail({ categories, activeCategory, onSelect }: CategoryRailProps) {
  const wide = useWideLayout();
  const [pinned, setPinned] = useState(readPinned);
  const [hovered, setHovered] = useState(false);
  const [awake, setAwake] = useState(false);
  const hoverTimer = useRef<number | undefined>(undefined);
  const awakeTimer = useRef<number | undefined>(undefined);
  const expanded = wide && (pinned || hovered);

  // Idle, the rail is glass so the page shows through it. Touching it brings
  // the solid surface back (long enough to read and tap), then it fades again.
  const wake = () => {
    setAwake(true);
    window.clearTimeout(awakeTimer.current);
    awakeTimer.current = window.setTimeout(() => setAwake(false), 2800);
  };

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, pinned ? '1' : '0');
    } catch {
      // Private mode: the rail simply starts closed next time.
    }
  }, [pinned]);

  useEffect(() => {
    if (wide) return;
    setHovered(false);
  }, [wide]);

  useEffect(
    () => () => {
      window.clearTimeout(hoverTimer.current);
      window.clearTimeout(awakeTimer.current);
    },
    [],
  );

  // A short delay keeps the capsule from flickering when the pointer merely
  // crosses its edge on the way to the page.
  const expandSoon = () => {
    if (!wide) return;
    window.clearTimeout(hoverTimer.current);
    hoverTimer.current = window.setTimeout(() => setHovered(true), 130);
  };
  const collapseSoon = () => {
    window.clearTimeout(hoverTimer.current);
    hoverTimer.current = window.setTimeout(() => setHovered(false), 160);
  };

  return (
    <aside
      // No touch-action override and no preventDefault on touchmove here: on
      // iOS those swallow the tap that should reach a category button and stop
      // the list from scrolling at all, which leaves lower categories
      // unreachable. The browser's own touch handling is the correct one.
      aria-label="دسته‌بندی‌های منو"
      onMouseEnter={expandSoon}
      onMouseLeave={collapseSoon}
      onPointerDown={wake}
      onFocusCapture={wake}
      className="fixed left-1.5 top-1/2 z-40 -translate-y-1/2 md:left-3"
    >
      <div
        className={cn(
          'flex max-h-[min(86dvh,44rem)] flex-col overflow-hidden rounded-[1.5rem] border border-line/25 ring-1 ring-cream/15 backdrop-blur-[2px] transition-[width,background-color] duration-300 ease-out motion-reduce:transition-none',
          expanded ? 'w-[16.5rem]' : wide ? 'w-[5rem]' : 'w-[4.25rem]',
          // Idle it is glass, so the page keeps showing through; any interaction
          // (tap, drag, focus, hover or the pinned-open state) restores the solid
          // surface so the labels are readable again.
          awake || expanded ? 'bg-surface' : 'bg-surface/15 hover:bg-surface/75',
        )}
      >
        {expanded ? (
          <>
            <div className="flex items-center justify-between gap-2 p-2.5">
              <span className="flex min-w-0 items-center gap-2 ps-1">
                <span className="flex size-8 shrink-0 items-center justify-center rounded-full bg-espresso text-cream">
                  <RailIcon icon={GRID} className="size-4" />
                </span>
                <span className="min-w-0">
                  <span className="block truncate font-display text-[13px] font-bold text-ink">دسته‌ها</span>
                  <span className="num block text-[9px] text-muted">
                    {formatCountFa(categories.length)} دسته
                  </span>
                </span>
              </span>
              <RailToggle pinned={pinned} expanded onToggle={() => setPinned((value) => !value)} />
            </div>
            <div className="mx-3 h-px bg-line/80" />
          </>
        ) : wide ? (
          <>
            <div className="flex justify-center p-2">
              <RailToggle pinned={pinned} expanded={false} onToggle={() => setPinned((value) => !value)} />
            </div>
            <div className="mx-3 h-px bg-line/80" />
          </>
        ) : null}

        <ul
          id="menu-rail-list"
          className="scroll-thin flex-1 space-y-1 overflow-y-auto overscroll-contain px-1.5 py-2 md:px-2"
        >
          {categories.map((category, index) => {
            const active = activeCategory === category.id;
            return (
              <li key={category.id}>
                <button
                  type="button"
                  onClick={() => onSelect(category.id)}
                  aria-current={active ? 'true' : undefined}
                  aria-label={category.nameFa}
                  title={category.nameFa}
                  className={cn(
                    'group relative flex w-full min-w-0 flex-col items-center gap-1 overflow-hidden rounded-[1.05rem] px-1 py-1.5 text-center transition-colors duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-400',
                    expanded ? 'md:flex-row md:gap-2.5 md:p-1 md:text-start' : '',
                    active ? 'bg-cream' : 'hover:bg-cream/70',
                  )}
                >
                  <span
                    className={cn(
                      'flex size-10 shrink-0 items-center justify-center rounded-[0.85rem] border transition-colors duration-200 md:size-11',
                      active
                        ? 'border-espresso bg-espresso text-cream shadow-[0_10px_22px_-14px_rgba(36,22,17,0.9)]'
                        : 'border-transparent bg-cream/30 text-ink/75 group-hover:border-line group-hover:bg-cream group-hover:text-ink',
                    )}
                  >
                    <RailIcon icon={iconFor(category, index)} className="size-[18px] md:size-5" />
                  </span>

                  <span className="w-full min-w-0 max-w-full md:flex-1">
                    <span
                      className={cn(
                        'line-clamp-2 block w-full text-[10px] leading-[1.4] [overflow-wrap:anywhere] md:line-clamp-1 md:text-[11.5px] md:leading-5',
                        active ? 'font-semibold text-ink' : 'text-ink/75',
                      )}
                    >
                      {category.nameFa}
                    </span>
                    {expanded ? (
                      <span className="num hidden text-[9px] text-muted md:block">
                        {formatCountFa(category.products.length)} آیتم
                      </span>
                    ) : null}
                  </span>

                  {active ? (
                    <span
                      aria-hidden="true"
                      className="absolute inset-y-2 start-0 w-[3px] rounded-full bg-brand-600"
                    />
                  ) : null}
                </button>
              </li>
            );
          })}
        </ul>

        {wide ? (
          <>
            <div className="mx-3 h-px bg-line/80" />
            <div className="p-1.5 md:p-2.5">
              <Link
                to="/staff/login"
                aria-label="ورود کارکنان"
                title="ورود کارکنان"
                className={cn(
                  'group flex items-center gap-2.5 rounded-[1.05rem] p-1 text-ink/70 transition-colors duration-200 hover:text-ink',
                  expanded ? '' : 'justify-center',
                )}
              >
                <span className="flex size-11 shrink-0 items-center justify-center rounded-[0.85rem] border border-transparent bg-cream/30 transition-colors duration-200 group-hover:border-line group-hover:bg-cream">
                  <svg
                    aria-hidden="true"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="1.6"
                    className="size-5"
                  >
                    <path d="M15 4h3a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2h-3" strokeLinecap="round" />
                    <path d="M10 8l4 4-4 4M14 12H4" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                </span>
                {expanded ? <span className="text-[11px]">ورود کارکنان</span> : null}
              </Link>
            </div>
          </>
        ) : null}
      </div>
    </aside>
  );
}

function RailToggle({
  pinned,
  expanded,
  onToggle,
}: {
  pinned: boolean;
  expanded: boolean;
  onToggle: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onToggle}
      aria-expanded={expanded}
      aria-controls="menu-rail-list"
      aria-label={pinned ? 'جمع‌کردن نوار دسته‌ها' : 'باز نگه‌داشتن نوار دسته‌ها'}
      title={pinned ? 'جمع کردن' : 'باز نگه داشتن'}
      className="flex size-9 shrink-0 items-center justify-center rounded-full border border-line/60 bg-surface/80 text-ink/80 shadow-sm transition-colors duration-200 hover:bg-cream hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-400"
    >
      <svg
        aria-hidden="true"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
        className={cn(
          'size-4 transition-transform duration-300 motion-reduce:transition-none',
          pinned ? 'rotate-180 text-brand-600' : '',
        )}
      >
        <path d="M9 6l6 6-6 6" />
      </svg>
    </button>
  );
}
