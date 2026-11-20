/**
 * Hand a destination to the phone's own map apps.
 *
 * Android understands the `geo:` scheme and shows its system chooser, so a
 * guest can pick any installed map app (Google Maps, Waze, Neshan, …). iOS has
 * no map chooser, but it does have the system share sheet: on iOS the button
 * hands the destination to `navigator.share`, so the guest continues in any app
 * the phone has instead of being pushed into Apple Maps. Desktop browsers get
 * Google Maps directions in a new tab.
 */

export interface MapDestination {
  latitude: number;
  longitude: number;
  label?: string;
}

function encodeLabel(label: string | undefined): string {
  return encodeURIComponent((label ?? 'مقصد').trim() || 'مقصد');
}

export type MapPlatform = 'ios' | 'android' | 'desktop';

export function isAndroidDevice(userAgent = typeof navigator === 'undefined' ? '' : navigator.userAgent): boolean {
  return /Android/i.test(userAgent);
}

export function isIosDevice(userAgent = typeof navigator === 'undefined' ? '' : navigator.userAgent): boolean {
  if (/iPad|iPhone|iPod/i.test(userAgent)) return true;
  // iPadOS reports a desktop Safari user agent; touch points reveal the tablet.
  return (
    typeof navigator !== 'undefined' &&
    /Macintosh/i.test(userAgent) &&
    navigator.maxTouchPoints > 1
  );
}

export function detectPlatform(userAgent = typeof navigator === 'undefined' ? '' : navigator.userAgent): MapPlatform {
  if (isIosDevice(userAgent)) return 'ios';
  if (isAndroidDevice(userAgent)) return 'android';
  return 'desktop';
}

/** The URL handed to the native app for the current platform. */
export function directionsUrl({ latitude, longitude, label }: MapDestination): string {
  const point = `${latitude},${longitude}`;
  if (isAndroidDevice()) {
    return `geo:${point}?q=${point}(${encodeLabel(label)})`;
  }
  if (isIosDevice()) {
    return `https://maps.apple.com/?daddr=${point}&q=${encodeLabel(label)}&dirflg=d`;
  }
  return `https://www.google.com/maps/dir/?api=1&destination=${point}`;
}

/**
 * What iOS gets in the system share sheet: a title, a readable line and a
 * working map link, so any app the guest has (a maps app, a messenger, Notes)
 * can take the destination.
 */
export function sharePayload({ latitude, longitude, label }: MapDestination): ShareData {
  const point = `${latitude},${longitude}`;
  const name = (label ?? '').trim() || 'کافه';
  return {
    title: `مسیر تا ${name}`,
    text: `مسیر تا ${name} — ${point}`,
    url: directionsUrl({ latitude, longitude, label: name }),
  };
}

/**
 * Web Share is a secure-context API: on an `http://` origin other than
 * localhost the browser does not expose `navigator.share` at all. That is why
 * an iPhone opening the LAN address (`http://192.168.x.x:5173`) never sees the
 * share sheet — HTTPS (or localhost) is what turns it on.
 */
export function nativeShareAvailable(): boolean {
  return typeof window !== 'undefined' && typeof navigator.share === 'function';
}

/** Clipboard writing is gated the same way, so a selection copy backs it up. */
async function copyText(text: string): Promise<boolean> {
  try {
    if (typeof navigator.clipboard?.writeText === 'function') {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    // Insecure origin or a denied permission: try the old selection copy.
  }

  try {
    const field = document.createElement('textarea');
    field.value = text;
    field.setAttribute('readonly', '');
    field.style.position = 'fixed';
    field.style.top = '-1000px';
    document.body.appendChild(field);
    field.select();
    const copied = document.execCommand('copy');
    document.body.removeChild(field);
    return copied;
  } catch {
    return false;
  }
}

export type DirectionsOutcome = 'shared' | 'copied' | 'opened' | 'failed';

/** Why the native sheet could not be used, so the page can say it plainly. */
export type DirectionsReason = 'insecure' | 'unsupported' | 'blocked';

export interface DirectionsResult {
  outcome: DirectionsOutcome;
  reason?: DirectionsReason;
}

/**
 * Opens navigation, keeping the desktop link usable without JavaScript.
 *
 * iOS has no map-app chooser of its own, but the system share sheet is one: it
 * lists every installed app that can take a link, plus copy and AirDrop. So on
 * iOS the guest gets that native sheet. When the page is not a secure context
 * the sheet cannot be triggered at all, and hijacking the guest into Apple Maps
 * is exactly what they asked us not to do — the link is copied instead.
 */
export async function openDirections(destination: MapDestination): Promise<DirectionsResult> {
  if (typeof window === 'undefined') return { outcome: 'failed' };

  if (detectPlatform() === 'ios') {
    if (import.meta.env.DEV) {
      // A one-line answer for "why did it copy instead of opening the sheet?".
      console.info('[navigation]', {
        share: typeof navigator.share,
        secure: window.isSecureContext,
        origin: window.location.origin,
      });
    }

    // Try the sheet whenever the browser exposes it, even if the origin looks
    // insecure: only the presence of the function decides.
    if (nativeShareAvailable()) {
      try {
        await navigator.share(sharePayload(destination));
        return { outcome: 'shared' };
      } catch (error) {
        // Dismissing the sheet is a choice, not a failure: stay on the page.
        if (error instanceof DOMException && error.name === 'AbortError') return { outcome: 'shared' };

        const copied = await copyText(directionsUrl(destination));
        return copied ? { outcome: 'copied', reason: 'blocked' } : { outcome: 'failed' };
      }
    }

    const copied = await copyText(directionsUrl(destination));
    return {
      outcome: copied ? 'copied' : 'failed',
      reason: window.isSecureContext ? 'unsupported' : 'insecure',
    };
  }

  const url = directionsUrl(destination);
  if (isAndroidDevice()) {
    window.location.href = url;
    return { outcome: 'opened' };
  }
  window.open(url, '_blank', 'noopener,noreferrer');
  return { outcome: 'opened' };
}
