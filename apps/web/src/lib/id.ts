/**
 * A client-generated id for idempotency keys and local drafts.
 *
 * `crypto.randomUUID` only exists in a secure context. A phone that opens the
 * app over plain HTTP on the café's LAN is not a secure context, so the
 * function is undefined there and an unguarded call throws while the page is
 * rendering — which leaves the whole screen blank. This returns an
 * UUID-shaped id in both cases: the browser's own when it has it, otherwise
 * bytes from `crypto.getRandomValues` and, as the last resort, Math.random.
 */
export function randomId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }

  const bytes = new Uint8Array(16);
  if (typeof crypto !== 'undefined' && typeof crypto.getRandomValues === 'function') {
    crypto.getRandomValues(bytes);
  } else {
    for (let index = 0; index < bytes.length; index += 1) {
      bytes[index] = Math.floor(Math.random() * 256);
    }
  }

  // Version 4 and the RFC 4122 variant, so the string is a real UUID.
  bytes[6] = ((bytes[6] as number) & 0x0f) | 0x40;
  bytes[8] = ((bytes[8] as number) & 0x3f) | 0x80;

  const hex = Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}
