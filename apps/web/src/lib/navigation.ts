/**
 * Hand a destination to the phone's own map apps.
 *
 * Android understands the `geo:` scheme and shows its system chooser, so a
 * guest can pick any installed map app (Google Maps, Waze, Neshan, …). iOS has
 * no equivalent chooser: a website can only open one app, so the Apple Maps
 * link goes straight to the system Maps app. Desktop browsers get Google Maps
 * directions in a new tab.
 */

export interface MapDestination {
  latitude: number;
  longitude: number;
  label?: string;
}

function encodeLabel(label: string | undefined): string {
  return encodeURIComponent((label ?? 'مقصد').trim() || 'مقصد');
}

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

/** Opens navigation, keeping the desktop link usable without JavaScript. */
export function openDirections(destination: MapDestination): void {
  if (typeof window === 'undefined') return;
  const url = directionsUrl(destination);
  if (isAndroidDevice() || isIosDevice()) {
    window.location.href = url;
    return;
  }
  window.open(url, '_blank', 'noopener,noreferrer');
}
