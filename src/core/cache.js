/** 带 TTL 与容量上限的 LRU 缓存。用于避免重复抓取同一 URL。 */
export class TtlCache {
  constructor({ ttlMs = 300_000, maxEntries = 512 } = {}) {
    this.ttlMs = ttlMs;
    this.maxEntries = maxEntries;
    this.map = new Map();
    this.hits = 0;
    this.misses = 0;
  }

  get(key) {
    const entry = this.map.get(key);
    if (!entry) { this.misses++; return undefined; }
    if (entry.expires <= Date.now()) {
      this.map.delete(key);
      this.misses++;
      return undefined;
    }
    // LRU：命中后移到末尾
    this.map.delete(key);
    this.map.set(key, entry);
    this.hits++;
    return entry.value;
  }

  set(key, value, ttlMs = this.ttlMs) {
    if (this.map.has(key)) this.map.delete(key);
    this.map.set(key, { value, expires: Date.now() + ttlMs });
    while (this.map.size > this.maxEntries) {
      const oldest = this.map.keys().next().value;
      this.map.delete(oldest);
    }
    return value;
  }

  delete(key) { return this.map.delete(key); }
  clear() { this.map.clear(); }
  get size() { return this.map.size; }
  stats() {
    const total = this.hits + this.misses;
    return {
      size: this.map.size,
      maxEntries: this.maxEntries,
      ttlMs: this.ttlMs,
      hits: this.hits,
      misses: this.misses,
      hitRate: total ? Math.round((this.hits / total) * 1000) / 1000 : 0,
    };
  }
}

/** 同一 URL 的并发请求合并（single-flight），防止缓存击穿 */
export class SingleFlight {
  constructor() { this.inflight = new Map(); }
  async run(key, fn) {
    const existing = this.inflight.get(key);
    if (existing) return existing;
    const p = (async () => fn())().finally(() => this.inflight.delete(key));
    this.inflight.set(key, p);
    return p;
  }
  get size() { return this.inflight.size; }
}
