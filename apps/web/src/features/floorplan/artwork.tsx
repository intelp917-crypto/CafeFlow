import type { CSSProperties, ComponentType } from 'react';
import {
  Armchair,
  Box,
  Calculator,
  ChefHat,
  Cigarette,
  ConciergeBell,
  Crown,
  CupSoda,
  DoorOpen,
  LogOut,
  ShoppingBag,
  Sofa,
  Trees,
  Users,
} from 'lucide-react';
import type { LayoutObject, LayoutObjectType, LayoutTableDto } from '@cafeflow/shared';
import { cn } from '@cafeflow/ui';
import { formatCountFa } from '../../lib/format';

/**
 * Floor-plan artwork.
 *
 * Every element type is drawn as a small piece of furniture instead of a bare
 * rectangle: the bar has a wooden counter top with taps and stools, the kitchen
 * has a hood and burner rings, the sofa has a backrest and cushions, and zones
 * get a tinted, hatched area with a readable label chip. Icons come from the
 * same Lucide family the rest of the app uses, so strokes stay consistent.
 */

type Glyph = ComponentType<{ size?: number | string; className?: string; strokeWidth?: number; style?: CSSProperties }>;

const TABLE_STATUS_LABELS: Record<string, string> = {
  available: 'آزاد',
  occupied: 'اشغال',
  reserved: 'رزرو',
  waiting_service: 'در انتظار سرویس',
  waiting_payment: 'در انتظار پرداخت',
  cleaning: 'نظافت',
  unavailable: 'غیرفعال',
};

export const STATUS_LABELS_FA = TABLE_STATUS_LABELS;

const STATUS_FILL: Record<string, string> = {
  available: '#eef6ec',
  occupied: '#fcefe5',
  reserved: '#eaf1f4',
  waiting_service: '#fbf2df',
  waiting_payment: '#fbf2df',
  cleaning: '#f0e9dc',
  unavailable: '#f6f0e6',
};

const STATUS_STROKE: Record<string, string> = {
  available: '#3f7a45',
  occupied: '#b95f33',
  reserved: '#2c5a6b',
  waiting_service: '#9a6c12',
  waiting_payment: '#9a6c12',
  cleaning: '#9c8b76',
  unavailable: '#7b6a5b',
};

/** The glyph shown in the library, the layers list and on the canvas. */
export function objectGlyph(type: LayoutObjectType, zoneKind?: string): Glyph {
  if (type === 'zone') {
    switch (zoneKind) {
      case 'bar':
        return CupSoda;
      case 'kitchen':
        return ChefHat;
      case 'vip':
        return Crown;
      case 'smoking':
        return Cigarette;
      case 'outdoor':
        return Trees;
      case 'waiting':
        return Armchair;
      case 'cashier':
        return Calculator;
      case 'entrance':
        return DoorOpen;
      case 'pickup':
        return ShoppingBag;
      default:
        return Box;
    }
  }
  switch (type) {
    case 'table':
      return Users;
    case 'chair':
      return Armchair;
    case 'bar':
      return CupSoda;
    case 'kitchen':
      return ChefHat;
    case 'sofa':
      return Sofa;
    case 'service':
      return ConciergeBell;
    case 'entrance':
      return DoorOpen;
    case 'exit':
      return LogOut;
    default:
      return Box;
  }
}

/** `#rrggbb` luminance check, so a glyph stays readable on any library colour. */
export function isDarkColor(hex?: string): boolean {
  if (!hex) return false;
  const value = hex.replace('#', '').trim();
  if (!/^[0-9a-f]{6}$/i.test(value)) return false;
  const r = Number.parseInt(value.slice(0, 2), 16);
  const g = Number.parseInt(value.slice(2, 4), 16);
  const b = Number.parseInt(value.slice(4, 6), 16);
  return 0.299 * r + 0.587 * g + 0.114 * b < 140;
}

const SELECTED_RING = 'ring-2 ring-brand-500/85 ring-offset-2 ring-offset-surface';

function iconSizeFor(object: LayoutObject, ratio = 0.34, min = 10, max = 22) {
  return Math.max(min, Math.min(max, Math.min(object.width, object.height) * ratio));
}

interface ArtProps {
  object: LayoutObject;
  table?: LayoutTableDto;
  liveStatus?: string;
  preview: boolean;
  label: string;
  selected: boolean;
}

function TableArt({ object, table, liveStatus, preview, label, selected }: ArtProps) {
  const shape = table?.shape ?? 'square';
  const status = liveStatus ?? 'available';
  const stroke = preview ? (STATUS_STROKE[status] ?? '#9c8b76') : '#c2a37f';
  const iconSize = iconSizeFor(object, 0.18, 8, 12);
  const compact = object.height < 62;

  return (
    <div
      className={cn(
        'relative flex h-full w-full flex-col items-center justify-center overflow-hidden text-center',
        shape === 'round' ? 'rounded-full' : shape === 'rectangle' ? 'rounded-2xl' : 'rounded-xl',
        selected && SELECTED_RING,
      )}
      style={{
        background: preview
          ? (STATUS_FILL[status] ?? '#f6f0e6')
          : 'radial-gradient(120% 120% at 30% 15%, #fffdf9 0%, #f7ecdc 55%, #ecdfca 100%)',
        border: `1.5px solid ${stroke}`,
        color: preview ? stroke : '#291b13',
        boxShadow: preview ? undefined : 'inset 0 1px 0 rgba(255,255,255,0.9), 0 1px 2px rgba(41,27,19,0.08)',
      }}
    >
      {/* Table-top edge, so a square table reads as a surface rather than a box. */}
      <span
        aria-hidden="true"
        className={cn('pointer-events-none absolute border border-dashed', shape === 'round' ? 'inset-[5px] rounded-full' : 'inset-[5px] rounded-[inherit]')}
        style={{ borderColor: stroke, opacity: 0.35 }}
      />
      <span className={cn('relative max-w-full truncate px-1 font-semibold leading-4', compact ? 'text-[10px]' : 'text-[11px]')}>
        {label}
      </span>
      {table && !compact ? (
        <span className="relative mx-auto flex items-center gap-1 text-[9px] leading-3 opacity-80">
          <Users aria-hidden="true" size={iconSize} strokeWidth={2} />
          <span className="num">{formatCountFa(table.capacity)} نفر</span>
        </span>
      ) : null}
      {preview ? (
        <span
          className="relative mt-0.5 max-w-full truncate rounded-full px-1.5 text-[8px] font-medium leading-3"
          style={{ backgroundColor: `${stroke}1f`, color: stroke }}
        >
          {STATUS_LABELS_FA[status] ?? status}
        </span>
      ) : null}
    </div>
  );
}

function BarArt({ object, label, selected }: ArtProps) {
  const compact = object.height < 62;
  const iconSize = iconSizeFor(object, 0.3, 11, 18);
  return (
    <div
      className={cn('relative h-full w-full overflow-hidden rounded-lg', selected && SELECTED_RING)}
      style={{
        background: 'linear-gradient(180deg, #7c3d20 0%, #5a2c16 55%, #3b2519 100%)',
        border: '1.5px solid #4e2413',
        boxShadow: 'inset 0 -3px 6px rgba(0,0,0,0.25)',
      }}
    >
      {/* Wooden counter top with grain and a brass tap. */}
      <div
        className="relative w-full shrink-0"
        style={{
          height: compact ? '38%' : '32%',
          background: 'linear-gradient(180deg, #eacfad 0%, #dcc09c 70%, #c9a882 100%)',
          boxShadow: '0 2px 0 rgba(0,0,0,0.18), inset 0 -1px 0 rgba(255,255,255,0.5)',
        }}
      >
        <span
          aria-hidden="true"
          className="absolute inset-x-0 top-1/2 h-px"
          style={{ background: 'repeating-linear-gradient(90deg, rgba(140,101,63,0.55) 0 10px, rgba(140,101,63,0.1) 10px 18px)' }}
        />
        <span aria-hidden="true" className="absolute left-[12%] top-[22%] h-[62%] w-[3px] rounded-full bg-[#d9b46a]" />
        <span aria-hidden="true" className="absolute left-[15%] top-[22%] h-[30%] w-[7px] rounded-t-sm border border-[#d9b46a] border-b-0 bg-transparent" />
        <span aria-hidden="true" className="absolute right-[12%] top-1 size-3 rounded-full border border-[#a98259]/70" />
      </div>
      <div className="relative flex flex-1 items-center justify-center gap-1.5 px-1.5" style={{ color: '#f7efe3' }}>
        <CupSoda aria-hidden="true" size={iconSize} strokeWidth={1.7} />
        <span className={cn('max-w-full truncate font-semibold', compact ? 'text-[10px]' : 'text-[11px]')}>{label}</span>
      </div>
      {!compact ? (
        <div aria-hidden="true" className="absolute inset-x-2 bottom-1 flex justify-around">
          {[0, 1, 2].map((stool) => (
            <span key={stool} className="h-[3px] w-[17%] rounded-full bg-[#e6bd8f]/75" />
          ))}
        </div>
      ) : null}
    </div>
  );
}

function KitchenArt({ object, label, selected }: ArtProps) {
  const compact = object.height < 70;
  const iconSize = iconSizeFor(object, 0.3, 11, 18);
  return (
    <div
      className={cn('relative h-full w-full overflow-hidden rounded-lg', selected && SELECTED_RING)}
      style={{
        background: 'linear-gradient(160deg, #45301f 0%, #3b2519 55%, #241611 100%)',
        border: '1.5px solid #1b120d',
      }}
    >
      {/* Extractor hood. */}
      <div
        className="absolute inset-x-0 top-0"
        style={{
          height: compact ? '20%' : '24%',
          background: 'repeating-linear-gradient(90deg, #57402f 0 6px, #2f2018 6px 9px)',
          boxShadow: '0 2px 4px rgba(0,0,0,0.35)',
        }}
      />
      <div className="relative flex h-full items-center justify-center gap-1.5 px-1.5" style={{ color: '#f7efe3' }}>
        <ChefHat aria-hidden="true" size={iconSize} strokeWidth={1.7} />
        <span className={cn('max-w-full truncate font-semibold', compact ? 'text-[10px]' : 'text-[11px]')}>{label}</span>
      </div>
      {!compact ? (
        <div aria-hidden="true" className="absolute inset-x-2 bottom-1.5 flex items-center justify-center gap-1.5">
          {[0, 1, 2, 3].map((burner) => (
            <span
              key={burner}
              className="size-[9px] rounded-full border bg-[#120c08]/50"
              style={{ borderColor: 'rgba(207,195,180,0.55)', boxShadow: 'inset 0 0 0 2px rgba(207,195,180,0.18)' }}
            />
          ))}
        </div>
      ) : null}
    </div>
  );
}

function SofaArt({ label, selected }: ArtProps) {
  return (
    <div
      className={cn('relative h-full w-full overflow-hidden rounded-xl', selected && SELECTED_RING)}
      style={{ background: 'linear-gradient(180deg, #8a7864 0%, #6b5a49 100%)', border: '1.5px solid #5a4a3d' }}
    >
      {/* Backrest, seat cushions and armrests. */}
      <div
        aria-hidden="true"
        className="absolute inset-x-[8%] top-[8%] rounded-t-lg"
        style={{ height: '34%', background: 'linear-gradient(180deg, #96836d, #7d6b58)', boxShadow: 'inset 0 2px 0 rgba(255,255,255,0.14)' }}
      />
      <div
        aria-hidden="true"
        className="absolute inset-x-[12%] bottom-[12%] rounded-md"
        style={{ top: '44%', background: 'linear-gradient(180deg, #b0a08a, #a3927c)' }}
      />
      <span aria-hidden="true" className="absolute left-1/2 top-[44%] bottom-[12%] w-px bg-black/15" />
      <span aria-hidden="true" className="absolute inset-y-[16%] left-0 w-[8%] rounded-r-md bg-[#5f4f40]" />
      <span aria-hidden="true" className="absolute inset-y-[16%] right-0 w-[8%] rounded-l-md bg-[#5f4f40]" />
      <div className="relative flex h-full items-center justify-center px-2">
        <span className="max-w-full truncate rounded-full bg-espresso/60 px-2 py-0.5 text-[10px] font-semibold text-cream backdrop-blur-[1px]">
          {label}
        </span>
      </div>
    </div>
  );
}

function ChairArt({ object, label, selected }: ArtProps) {
  const showLabel = object.width >= 72 && object.height >= 44;
  return (
    <div
      className={cn('relative h-full w-full overflow-hidden rounded-lg', selected && SELECTED_RING)}
      style={{
        background: 'linear-gradient(180deg, #c26c40 0%, #b95f33 55%, #a34c25 100%)',
        border: '1.5px solid #853c1d',
      }}
    >
      <span
        aria-hidden="true"
        className="absolute inset-x-[16%] top-[8%] rounded-t-md"
        style={{ height: '30%', background: 'linear-gradient(180deg, #8b3f1f, #73331a)' }}
      />
      <span
        aria-hidden="true"
        className="absolute inset-x-[10%] bottom-[14%] rounded-md"
        style={{ top: '42%', background: 'linear-gradient(180deg, #e19e76, #d07c4f)' }}
      />
      {showLabel ? (
        <span className="absolute inset-x-1 bottom-0.5 truncate text-center text-[9px] font-semibold leading-3 text-cream/90">
          {label}
        </span>
      ) : null}
    </div>
  );
}

function ServiceArt({ object, label, selected }: ArtProps) {
  const iconSize = iconSizeFor(object, 0.32, 12, 20);
  return (
    <div
      className={cn('relative flex h-full w-full flex-col items-center justify-center gap-0.5 overflow-hidden rounded-xl px-1 text-center', selected && SELECTED_RING)}
      style={{
        background: 'linear-gradient(160deg, #fdf6e8 0%, #f4e6c9 100%)',
        border: '1.5px solid #d9b46a',
        color: '#7d5710',
      }}
    >
      <ConciergeBell aria-hidden="true" size={iconSize} strokeWidth={1.8} style={{ color: '#9a6c12' }} />
      <span className="max-w-full truncate text-[10px] font-semibold leading-3">{label}</span>
      <span aria-hidden="true" className="absolute inset-x-0 bottom-0 h-1" style={{ background: 'linear-gradient(90deg, #d9b46a, #e7cdae)' }} />
    </div>
  );
}

function DoorArt({ object, label, selected }: ArtProps) {
  const entrance = object.type === 'entrance';
  const color = entrance ? '#3f7a45' : '#b23a26';
  const GlyphIcon = entrance ? DoorOpen : LogOut;
  const iconSize = iconSizeFor(object, 0.36, 12, 20);
  return (
    <div
      className={cn('relative flex h-full w-full items-center justify-center gap-1.5 overflow-hidden rounded-md px-1.5', selected && SELECTED_RING)}
      style={{ background: entrance ? '#eef6ec' : '#fbece6', border: `1.5px solid ${color}66`, color }}
    >
      <span aria-hidden="true" className="absolute inset-y-0 left-0 w-[5%]" style={{ background: color }} />
      <span
        aria-hidden="true"
        className="absolute inset-y-[14%] right-[7%] w-[22%] rounded-sm bg-surface"
        style={{ border: `1.5px solid ${color}`, boxShadow: 'inset 2px 0 0 rgba(0,0,0,0.06)' }}
      />
      <GlyphIcon aria-hidden="true" size={iconSize} strokeWidth={1.8} />
      <span className="max-w-full truncate text-[10px] font-semibold">{label}</span>
    </div>
  );
}

function ZoneArt({ object, label, selected }: ArtProps) {
  const color = object.props.color ?? '#cdbda7';
  const compact = object.width < 110 || object.height < 70;
  const iconSize = Math.max(14, Math.min(compact ? 18 : 40, Math.min(object.width, object.height) * 0.3));
  const GlyphIcon = objectGlyph('zone', object.props.zoneKind);
  return (
    <div
      className={cn('relative h-full w-full overflow-hidden rounded-lg', selected && SELECTED_RING)}
      style={{ background: `${color}40`, border: `2px dashed ${color}` }}
    >
      <div
        aria-hidden="true"
        className="absolute inset-0 opacity-40"
        style={{ backgroundImage: `repeating-linear-gradient(45deg, ${color}66 0 2px, transparent 2px 11px)` }}
      />
      <div className="relative flex h-full w-full flex-col items-center justify-center gap-1 px-1">
        {!compact ? (
          <GlyphIcon aria-hidden="true" size={iconSize} strokeWidth={1.6} style={{ color, opacity: 0.6 }} />
        ) : null}
        <span
          className="max-w-[94%] truncate rounded-full bg-surface/90 px-2 py-0.5 text-[10px] font-semibold leading-3 text-ink"
          style={{ border: `1px solid ${color}`, boxShadow: '0 1px 2px rgba(41,27,19,0.12)' }}
        >
          {label}
        </span>
      </div>
    </div>
  );
}

function OtherArt({ object, label, selected }: ArtProps) {
  const color = object.props.color ?? '#e6dbc9';
  const iconSize = iconSizeFor(object, 0.3, 11, 18);
  const dark = isDarkColor(color);
  return (
    <div
      className={cn('relative flex h-full w-full flex-col items-center justify-center gap-0.5 overflow-hidden rounded-lg px-1 text-center', selected && SELECTED_RING)}
      style={{ background: color, border: '1.5px solid rgba(41,27,19,0.18)', color: dark ? '#f7efe3' : '#291b13' }}
    >
      <Box aria-hidden="true" size={iconSize} strokeWidth={1.7} />
      <span className="max-w-full truncate text-[10px] font-semibold leading-3">{label}</span>
    </div>
  );
}

export function ObjectArtwork(props: ArtProps) {
  switch (props.object.type) {
    case 'table':
      return <TableArt {...props} />;
    case 'bar':
      return <BarArt {...props} />;
    case 'kitchen':
      return <KitchenArt {...props} />;
    case 'sofa':
      return <SofaArt {...props} />;
    case 'chair':
      return <ChairArt {...props} />;
    case 'service':
      return <ServiceArt {...props} />;
    case 'entrance':
    case 'exit':
      return <DoorArt {...props} />;
    case 'zone':
      return <ZoneArt {...props} />;
    default:
      return <OtherArt {...props} />;
  }
}
