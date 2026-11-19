import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

/**
 * Dependency-free TOTP (RFC 6238) with the defaults every authenticator app
 * assumes: SHA-1, six digits, 30-second steps and a base32 secret.
 *
 * Only the server generates secrets; the client never computes a code in a way
 * that the server trusts. Verification accepts one step of clock drift on each
 * side, which is the usual compromise for phones that are slightly late.
 */

const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
const STEP_SECONDS = 30;
const DIGITS = 6;

export function base32Encode(buffer: Buffer): string {
  let bits = 0;
  let value = 0;
  let output = '';

  for (const byte of buffer) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      output += ALPHABET[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }

  if (bits > 0) {
    output += ALPHABET[(value << (5 - bits)) & 31];
  }
  return output;
}

export function base32Decode(input: string): Buffer {
  const clean = input
    .replace(/\s+/g, '')
    .replace(/=+$/g, '')
    .toUpperCase();

  let bits = 0;
  let value = 0;
  const bytes: number[] = [];

  for (const character of clean) {
    const index = ALPHABET.indexOf(character);
    if (index === -1) throw new Error('کد base32 نامعتبر است.');
    value = (value << 5) | index;
    bits += 5;
    if (bits >= 8) {
      bytes.push((value >>> (bits - 8)) & 0xff);
      bits -= 8;
    }
  }

  return Buffer.from(bytes);
}

export function generateTotpSecret(bytes = 20): string {
  return base32Encode(randomBytes(bytes));
}

/** Six-digit code for a given moment; exported so tests can act as a phone. */
export function totpCode(secret: string, timestamp = Date.now()): string {
  const counter = Math.floor(timestamp / 1000 / STEP_SECONDS);
  const message = Buffer.alloc(8);
  message.writeUInt32BE(Math.floor(counter / 2 ** 32), 0);
  message.writeUInt32BE(counter % 2 ** 32, 4);

  const digest = createHmac('sha1', base32Decode(secret)).update(message).digest();
  const offset = digest[digest.length - 1] & 0x0f;
  const binary =
    ((digest[offset] & 0x7f) << 24) |
    ((digest[offset + 1] & 0xff) << 16) |
    ((digest[offset + 2] & 0xff) << 8) |
    (digest[offset + 3] & 0xff);

  return String(binary % 10 ** DIGITS).padStart(DIGITS, '0');
}

export function verifyTotp(secret: string, code: string, window = 1): boolean {
  const normalized = code.replace(/\D/g, '');
  if (normalized.length !== DIGITS) return false;

  const now = Date.now();
  const expected = Buffer.from(normalized);
  for (let step = -window; step <= window; step += 1) {
    const candidate = Buffer.from(totpCode(secret, now + step * STEP_SECONDS * 1000));
    if (candidate.length === expected.length && timingSafeEqual(candidate, expected)) return true;
  }
  return false;
}

/** `otpauth://` URI understood by Google Authenticator, Aegis, 1Password, … */
export function totpUri(secret: string, account: string, issuer = 'CafeFlow'): string {
  const label = encodeURIComponent(`${issuer}:${account}`);
  const params = new URLSearchParams({
    secret,
    issuer,
    algorithm: 'SHA1',
    digits: String(DIGITS),
    period: String(STEP_SECONDS),
  });
  return `otpauth://totp/${label}?${params.toString()}`;
}
