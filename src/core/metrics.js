/** 进程内指标：计数、耗时直方图、缓存命中。无需外部 TSDB。 */
export class Metrics {
  constructor() {
    this.startedAt = Date.now();
    this.counters = new Map();
    this.observations = new Map();
    this.http = { total: 0, byStatus: new Map(), byPath: new Map() };
  }

  incr(name, by = 1) {
    this.counters.set(name, (this.counters.get(name) || 0) + by);
  }

  observe(name, value) {
    let o = this.observations.get(name);
    if (!o) {
      o = { count: 0, sum: 0, min: Infinity, max: -Infinity, buckets: new Map() };
      this.observations.set(name, o);
    }
    o.count++;
    o.sum += value;
    if (value < o.min) o.min = value;
    if (value > o.max) o.max = value;
    const bucket = value < 100 ? '<100' : value < 300 ? '<300' : value < 1000 ? '<1s' : value < 3000 ? '<3s' : '<10s';
    o.buckets.set(bucket, (o.buckets.get(bucket) || 0) + 1);
  }

  recordHttp(path, status, durationMs) {
    this.http.total++;
    const key = `${Math.floor(status / 100)}xx`;
    this.http.byStatus.set(key, (this.http.byStatus.get(key) || 0) + 1);
    const p = this.http.byPath.get(path) || { count: 0, sum: 0, errors: 0 };
    p.count++;
    p.sum += durationMs;
    if (status >= 400) p.errors++;
    this.http.byPath.set(path, p);
    this.observe('http.duration_ms', durationMs);
  }

  snapshot(extra = {}) {
    const mem = process.memoryUsage();
    return {
      uptimeSeconds: Math.round((Date.now() - this.startedAt) / 1000),
      counters: Object.fromEntries(this.counters),
      latencies: Object.fromEntries([...this.observations].map(([k, o]) => [k, {
        count: o.count,
        avgMs: o.count ? Math.round(o.sum / o.count) : 0,
        minMs: o.min === Infinity ? 0 : o.min,
        maxMs: o.max === -Infinity ? 0 : o.max,
        buckets: Object.fromEntries(o.buckets),
      }])),
      http: {
        total: this.http.total,
        byStatus: Object.fromEntries(this.http.byStatus),
        slowest: [...this.http.byPath.entries()]
          .map(([path, v]) => ({ path, count: v.count, avgMs: Math.round(v.sum / v.count), errors: v.errors }))
          .sort((a, b) => b.avgMs - a.avgMs)
          .slice(0, 10),
      },
      memory: {
        rssMb: Math.round(mem.rss / 1048576),
        heapUsedMb: Math.round(mem.heapUsed / 1048576),
        heapTotalMb: Math.round(mem.heapTotal / 1048576),
      },
      ...extra,
    };
  }

  /** Prometheus 文本格式，方便接入现有监控 */
  prometheus(extraLabels = {}) {
    const lines = [];
    for (const [k, v] of this.counters) {
      lines.push(`seo2api_${k.replace(/[^a-zA-Z0-9]/g, '_')}_total ${v}`);
    }
    for (const [k, o] of this.observations) {
      const name = `seo2api_${k.replace(/[^a-zA-Z0-9]/g, '_')}`;
      lines.push(`${name}_count ${o.count}`);
      lines.push(`${name}_sum ${o.sum}`);
      if (o.count) lines.push(`${name}_avg ${(o.sum / o.count).toFixed(2)}`);
    }
    lines.push(`seo2api_http_requests_total ${this.http.total}`);
    for (const [k, v] of this.http.byStatus) lines.push(`seo2api_http_responses_total{status="${k}"} ${v}`);
    lines.push(`seo2api_uptime_seconds ${Math.round((Date.now() - this.startedAt) / 1000)}`);
    const mem = process.memoryUsage();
    lines.push(`seo2api_memory_rss_bytes ${mem.rss}`);
    return lines.join('\n') + '\n';
  }
}
