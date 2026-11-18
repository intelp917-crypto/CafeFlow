/**
 * Sliding-window limiter for the unauthenticated endpoints.
 *
 * The customer surface has no login, so it needs a cheap guard against a
 * malicious or broken client hammering order creation. State is per-process
 * and intentionally simple: this is application-level abuse protection, not a
 * substitute for an edge rate limiter in production.
 */
export class SlidingWindowLimiter {
  private readonly hits = new Map<string, number[]>();

  constructor(
    private readonly windowMs: number,
    private readonly maxHits: number,
  ) {}

  /** Records a hit for `key`; returns false when the limit is exceeded. */
  hit(key: string): boolean {
    const now = Date.now();
    const cutoff = now - this.windowMs;
    const history = (this.hits.get(key) ?? []).filter((timestamp) => timestamp > cutoff);

    if (history.length >= this.maxHits) {
      this.hits.set(key, history);
      return false;
    }

    history.push(now);
    this.hits.set(key, history);

    // Opportunistic cleanup so the map cannot grow without bound.
    if (this.hits.size > 5_000) {
      for (const [entryKey, timestamps] of this.hits) {
        if (timestamps.every((timestamp) => timestamp <= cutoff)) this.hits.delete(entryKey);
      }
    }

    return true;
  }
}
