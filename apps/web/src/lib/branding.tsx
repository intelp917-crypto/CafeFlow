import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import type { PublicBrandingResponse } from '@cafeflow/shared';
import { api } from './api';

/**
 * The café's own name, everywhere.
 *
 * The name is edited once in Settings and stored in the `settings` table; the
 * public branding endpoint exposes it to the shell (sidebar, breadcrumbs, intro,
 * login, document title and the installed-app manifest). `کافه‌فلو` remains the
 * product name only as the fallback before the first fetch, and the last known
 * value is cached so a reload never flashes a stale name.
 */

export const FALLBACK_BRAND = 'کافه‌فلو';
const STORAGE_KEY = 'cafeflow:brand';

interface BrandingState {
  nameFa: string;
  logoUrl: string;
  addressFa: string;
  phone: string;
  latitude: number | null;
  longitude: number | null;
}

interface BrandingContextValue extends BrandingState {
  refresh: () => Promise<void>;
}

function readCoordinate(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function readStoredBranding(): BrandingState {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as Partial<BrandingState>;
      if (typeof parsed.nameFa === 'string' && parsed.nameFa.trim() !== '') {
        return {
          nameFa: parsed.nameFa,
          logoUrl: typeof parsed.logoUrl === 'string' ? parsed.logoUrl : '',
          addressFa: typeof parsed.addressFa === 'string' ? parsed.addressFa : '',
          phone: typeof parsed.phone === 'string' ? parsed.phone : '',
          latitude: readCoordinate(parsed.latitude),
          longitude: readCoordinate(parsed.longitude),
        };
      }
    }
  } catch {
    // Blocked storage: the fallback name still renders.
  }
  return { nameFa: FALLBACK_BRAND, logoUrl: '', addressFa: '', phone: '', latitude: null, longitude: null };
}

const BrandingContext = createContext<BrandingContextValue>({
  nameFa: FALLBACK_BRAND,
  logoUrl: '',
  addressFa: '',
  phone: '',
  latitude: null,
  longitude: null,
  refresh: async () => undefined,
});

export function BrandingProvider({ children }: { children: ReactNode }) {
  const [branding, setBranding] = useState<BrandingState>(readStoredBranding);

  const refresh = useCallback(async () => {
    try {
      const next = await api.get<PublicBrandingResponse>('/public/branding');
      if (typeof next?.nameFa === 'string' && next.nameFa.trim() !== '') {
        setBranding({
          nameFa: next.nameFa,
          logoUrl: next.logoUrl ?? '',
          addressFa: next.addressFa ?? '',
          phone: next.phone ?? '',
          latitude: readCoordinate(next.latitude),
          longitude: readCoordinate(next.longitude),
        });
      }
    } catch {
      // Offline or API unreachable: keep the last known name rather than blanking it.
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  // Title and description follow the café, so a renamed installation does not
  // keep the old name in the browser tab.
  useEffect(() => {
    document.title = `${branding.nameFa} | مدیریت کافه و رستوران`;
    const description = document.querySelector('meta[name="description"]');
    description?.setAttribute(
      'content',
      `${branding.nameFa}؛ سامانه یکپارچه مدیریت کافه و رستوران`,
    );

    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(branding));
    } catch {
      // Nothing to cache.
    }
  }, [branding]);

  const value = useMemo<BrandingContextValue>(
    () => ({ ...branding, refresh }),
    [branding, refresh],
  );

  return <BrandingContext.Provider value={value}>{children}</BrandingContext.Provider>;
}

export function useBranding(): BrandingContextValue {
  return useContext(BrandingContext);
}

/** «کافه‌فلو / صندوق» with the current café name. */
export function Breadcrumb({ page }: { page: string }) {
  const { nameFa } = useBranding();
  return (
    <>
      {nameFa} / {page}
    </>
  );
}
