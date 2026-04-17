type Bucket = { tokens: number; updatedAt: number };

// JS Map preserves insertion order; re-inserting on access gives us O(1) LRU.
const buckets = new Map<string, Bucket>();

const CAPACITY = Number(process.env.RATE_LIMIT_CAPACITY ?? 10);
const REFILL_PER_SEC = Number(process.env.RATE_LIMIT_REFILL_PER_SEC ?? 0.1);
const MAX_ENTRIES = 2_000;

export function take(key: string, cost = 1): { ok: boolean; retryAfter: number } {
  const now = Date.now();
  let b = buckets.get(key);
  if (b) {
    // Touch for LRU.
    buckets.delete(key);
    buckets.set(key, b);
  } else {
    if (buckets.size >= MAX_ENTRIES) {
      const oldestKey = buckets.keys().next().value;
      if (oldestKey !== undefined) buckets.delete(oldestKey);
    }
    b = { tokens: CAPACITY, updatedAt: now };
    buckets.set(key, b);
  }
  const elapsedSec = (now - b.updatedAt) / 1000;
  b.tokens = Math.min(CAPACITY, b.tokens + elapsedSec * REFILL_PER_SEC);
  b.updatedAt = now;
  if (b.tokens >= cost) {
    b.tokens -= cost;
    return { ok: true, retryAfter: 0 };
  }
  const missing = cost - b.tokens;
  const retryAfter = Math.ceil(missing / REFILL_PER_SEC);
  return { ok: false, retryAfter };
}
