import { useId, type MouseEvent, type ReactNode } from 'react';
import { cn } from '@cafeflow/ui';
import { MapPin, Navigation, Phone } from 'lucide-react';
import { directionsUrl, openDirections } from '../../lib/navigation';

interface CafeLocationProps {
  nameFa: string;
  addressFa?: string;
  phone?: string;
  latitude: number | null;
  longitude: number | null;
  /** `panel` is the editorial map block; `bar` is a one-line footer strip. */
  variant?: 'panel' | 'bar';
  tone?: 'light' | 'dark';
  className?: string;
}

const MAP_DELTA = 0.0045;

/** OpenStreetMap's keyless embed: a real map without a paid tile key. */
function mapEmbedUrl(latitude: number, longitude: number): string {
  const bounds = [
    (longitude - MAP_DELTA).toFixed(6),
    (latitude - MAP_DELTA).toFixed(6),
    (longitude + MAP_DELTA).toFixed(6),
    (latitude + MAP_DELTA).toFixed(6),
  ].join(',');
  return `https://www.openstreetmap.org/export/embed.html?bbox=${bounds}&layer=mapnik&marker=${latitude},${longitude}`;
}

function MapFrame({
  latitude,
  longitude,
  title,
  className,
}: {
  latitude: number;
  longitude: number;
  title: string;
  className?: string;
}) {
  return (
    <iframe
      title={title}
      src={mapEmbedUrl(latitude, longitude)}
      loading="lazy"
      referrerPolicy="no-referrer-when-downgrade"
      className={cn('border-0', className)}
    />
  );
}

function NavigateLink({
  latitude,
  longitude,
  nameFa,
  tone,
  className,
  children,
}: {
  latitude: number;
  longitude: number;
  nameFa: string;
  tone: 'light' | 'dark';
  className?: string;
  children?: ReactNode;
}) {
  const go = (event: MouseEvent<HTMLAnchorElement>) => {
    event.preventDefault();
    openDirections({ latitude, longitude, label: nameFa });
  };

  return (
    <a
      href={directionsUrl({ latitude, longitude, label: nameFa })}
      onClick={go}
      target="_blank"
      rel="noopener noreferrer"
      className={cn(
        'inline-flex h-11 items-center justify-center gap-2 rounded-full px-6 text-sm font-medium',
        'focus-visible:outline-2 focus-visible:outline-offset-2',
        tone === 'dark'
          ? 'bg-brand-500 text-cream hover:bg-brand-600 focus-visible:outline-brand-300'
          : 'bg-brand-500 text-cream shadow-[0_14px_30px_-18px_rgba(78,36,19,0.85)] hover:bg-brand-600 focus-visible:outline-brand-500',
        className,
      )}
    >
      <Navigation aria-hidden="true" className="size-4" />
      {children ?? 'ناوبری'}
    </a>
  );
}

/**
 * The café on the map plus the one action every guest needs: send the pin to
 * whatever navigation app their phone already has.
 */
export function CafeLocation({
  nameFa,
  addressFa,
  phone,
  latitude,
  longitude,
  variant = 'panel',
  tone = 'light',
  className,
}: CafeLocationProps) {
  const headingId = useId();

  if (latitude === null || longitude === null) return null;

  const dark = tone === 'dark';
  const tel = phone?.replace(/[^\d+]/g, '');

  if (variant === 'bar') {
    return (
      <div
        className={cn(
          'flex items-center gap-3 rounded-2xl border p-2.5 pe-3',
          dark ? 'border-cream/15 bg-cream/[0.04] text-cream' : 'border-line/80 bg-surface text-ink',
          className,
        )}
      >
        <div className="relative size-16 shrink-0 overflow-hidden rounded-xl bg-cream">
          <MapFrame
            latitude={latitude}
            longitude={longitude}
            title={`نقشه ${nameFa}`}
            className="absolute inset-0 size-full"
          />
        </div>
        <div className="min-w-0 flex-1">
          <p className={cn('text-[10px]', dark ? 'text-cream/55' : 'text-muted')}>ما اینجاییم</p>
          <p className="mt-0.5 truncate text-[11px] font-medium">{addressFa || nameFa}</p>
        </div>
        <NavigateLink
          latitude={latitude}
          longitude={longitude}
          nameFa={nameFa}
          tone={tone}
          className="h-9 shrink-0 px-4 text-xs"
        />
      </div>
    );
  }

  return (
    <section
      aria-labelledby={headingId}
      className={cn(
        'overflow-hidden rounded-[1.75rem] border',
        dark ? 'border-cream/15 bg-espresso text-cream' : 'border-line/80 bg-surface text-ink',
        className,
      )}
    >
      <div className="grid lg:grid-cols-[1.12fr_0.88fr]">
        <div className="relative order-1 min-h-56 overflow-hidden bg-cream sm:min-h-72 lg:min-h-[21rem]">
          <MapFrame
            latitude={latitude}
            longitude={longitude}
            title={`نقشه موقعیت ${nameFa}`}
            className="absolute inset-0 size-full"
          />
          <div
            aria-hidden="true"
            className="pointer-events-none absolute inset-0 bg-gradient-to-t from-espresso/25 via-transparent to-transparent"
          />
          <span className="absolute bottom-3 start-3 inline-flex items-center gap-1.5 rounded-full bg-surface/95 px-3 py-1.5 text-[10px] font-medium text-espresso shadow-sm backdrop-blur-sm">
            <MapPin aria-hidden="true" className="size-3.5 text-brand-600" />
            موقعیت کافه روی نقشه
          </span>
        </div>

        <div className="order-2 flex flex-col justify-between gap-7 p-6 sm:p-8 lg:p-9">
          <div>
            <p
              className={cn(
                'flex items-center gap-2 text-[10px] tracking-wide',
                dark ? 'text-brand-200' : 'text-brand-600',
              )}
            >
              <span aria-hidden="true" className={cn('h-px w-5', dark ? 'bg-brand-300/70' : 'bg-brand-300')} />
              نشانی و مسیر
            </p>
            <h2
              id={headingId}
              className="mt-2 text-balance font-display text-2xl font-bold leading-snug sm:text-[1.7rem]"
            >
              ما را پیدا کنید
            </h2>

            {addressFa ? (
              <p
                className={cn(
                  'mt-3 flex gap-2 text-xs leading-6',
                  dark ? 'text-cream/70' : 'text-muted',
                )}
              >
                <MapPin aria-hidden="true" className="mt-1 size-4 shrink-0 text-brand-500" />
                <span>{addressFa}</span>
              </p>
            ) : null}

            {tel ? (
              <a
                href={`tel:${tel}`}
                className={cn(
                  'mt-2 inline-flex items-center gap-2 text-xs transition-colors',
                  dark ? 'text-cream/70 hover:text-cream' : 'text-muted hover:text-ink',
                )}
              >
                <Phone aria-hidden="true" className="size-4 text-brand-500" />
                <span dir="ltr" className="num">
                  {phone}
                </span>
              </a>
            ) : null}
          </div>

          <div>
            <NavigateLink
              latitude={latitude}
              longitude={longitude}
              nameFa={nameFa}
              tone={tone}
              className="w-full sm:w-auto"
            />
            <p className={cn('mt-2 text-[10px]', dark ? 'text-cream/45' : 'text-muted')}>
              مسیر با برنامهٔ نقشهٔ گوشی باز می‌شود؛ اندروید فهرست برنامه‌های نصب‌شده را نشان می‌دهد.
            </p>
          </div>
        </div>
      </div>
    </section>
  );
}
