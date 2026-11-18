import { randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';

/**
 * Password hashing with Node's built-in scrypt.
 *
 * Format: scrypt$<N>$<saltHex>$<hashHex>. Stored hashes are never logged and
 * verification uses a constant-time comparison.
 */

const KEY_LENGTH = 64;
const SCRYPT_COST = 16384;
const SCRYPT_BLOCK_SIZE = 8;
const SCRYPT_PARALLELISM = 1;

export function hashPassword(password: string): string {
  const salt = randomBytes(16);
  const derived = scryptSync(password.normalize('NFKC'), salt, KEY_LENGTH, {
    N: SCRYPT_COST,
    r: SCRYPT_BLOCK_SIZE,
    p: SCRYPT_PARALLELISM,
  });
  return `scrypt$${SCRYPT_COST}$${salt.toString('hex')}$${derived.toString('hex')}`;
}

export function verifyPassword(password: string, stored: string): boolean {
  const parts = stored.split('$');
  if (parts.length !== 4 || parts[0] !== 'scrypt') return false;

  const cost = Number(parts[1]);
  if (!Number.isFinite(cost) || cost < 1024) return false;

  const salt = Buffer.from(parts[2], 'hex');
  const expected = Buffer.from(parts[3], 'hex');
  if (salt.length === 0 || expected.length === 0) return false;

  const derived = scryptSync(password.normalize('NFKC'), salt, expected.length, {
    N: cost,
    r: SCRYPT_BLOCK_SIZE,
    p: SCRYPT_PARALLELISM,
  });

  return derived.length === expected.length && timingSafeEqual(derived, expected);
}

/** Opaque bearer token for sessions and QR codes. */
export function createOpaqueToken(bytes = 32): string {
  return randomBytes(bytes).toString('base64url');
}
