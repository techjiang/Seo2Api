/**
 * 令牌桶限流：按 key 维度（API key 或 IP），内存实现。
 * 采用「惰性补充」——每次请求按经过时间补 token，无定时器，进程空闲时零开销。
 */
export class RateLimiter {
  constructor({ windowMs = 60_000, max = 60, burst = 10 } = {}) {
    this.windowMs = windowMs;
    this.max = max;
    this.burst = burst;
    this.buckets = new Map();
    this.lastSweep = Date.now();
  }

  /** 返回 { allowed, remaining, resetMs, limit } */
  take(key, limit = this.max) {
    const capacity = limit + this.burst;
    const refillPerMs = limit / this.windowMs;
    const now = Date.now();
    let b = this.buckets.get(key);
    if (!b) {
      b = { tokens: capacity, updated: now };
      this.buckets.set(key, b);
    } else {
      const elapsed = now - b.updated;
      if (elapsed > 0) {
        b.tokens = Math.min(capacity, b.tokens + elapsed * refillPerMs);
        b.updated = now;
      }
    }
    this.maybeSweep(now);

    if (b.tokens >= 1) {
      b.tokens -= 1;
      return {
        allowed: true,
        remaining: Math.floor(b.tokens),
        limit,
        resetMs: Math.ceil((capacity - b.tokens) / refillPerMs),
      };
    }
    return {
      allowed: false,
      remaining: 0,
      limit,
      resetMs: Math.max(1, Math.ceil((1 - b.tokens) / refillPerMs)),
    };
  }

  maybeSweep(now) {
    if (now - this.lastSweep < 60_000) return;
    this.lastSweep = now;
    const idleLimit = now - this.windowMs * 3;
    for (const [k, b] of this.buckets) {
      if (b.updated < idleLimit) this.buckets.delete(k);
    }
  }

  reset(key) { this.buckets.delete(key); }
  get size() { return this.buckets.size; }
}
