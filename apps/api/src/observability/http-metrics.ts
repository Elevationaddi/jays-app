import type { NextFunction, Request, Response } from 'express';

/** Request duration buckets in seconds. The p95 target for reads is 0.5 s (docs/10-build-plan.md). */
export const DURATION_BUCKETS = [0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10] as const;

interface Series {
  count: number;
  sum: number;
  buckets: number[];
}

/**
 * In-process HTTP request metrics, exposed in Prometheus text format by GET /v1/metrics.
 * Labels use the matched route pattern (never the raw path), so ids cannot blow up cardinality.
 */
export class HttpMetrics {
  private readonly requests = new Map<string, number>();
  private readonly durations = new Map<string, Series>();
  private readonly startedAt = Date.now();

  middleware() {
    return (req: Request, res: Response, next: NextFunction) => {
      const start = process.hrtime.bigint();
      res.on('finish', () => {
        const seconds = Number(process.hrtime.bigint() - start) / 1e9;
        const route = routeOf(req);
        this.observe(req.method, route, res.statusCode, seconds);
      });
      next();
    };
  }

  observe(method: string, route: string, status: number, seconds: number) {
    const reqKey = labels({ method, route, status: String(status) });
    this.requests.set(reqKey, (this.requests.get(reqKey) ?? 0) + 1);
    const durKey = labels({ method, route });
    const series = this.durations.get(durKey) ?? {
      count: 0,
      sum: 0,
      buckets: DURATION_BUCKETS.map(() => 0),
    };
    series.count += 1;
    series.sum += seconds;
    DURATION_BUCKETS.forEach((le, i) => {
      if (seconds <= le) series.buckets[i] = (series.buckets[i] ?? 0) + 1;
    });
    this.durations.set(durKey, series);
  }

  render(): string {
    const out: string[] = [];
    out.push('# HELP jays_http_requests_total HTTP requests by method, route and status.');
    out.push('# TYPE jays_http_requests_total counter');
    for (const [key, value] of this.requests) out.push(`jays_http_requests_total{${key}} ${value}`);
    out.push('# HELP jays_http_request_duration_seconds HTTP request duration.');
    out.push('# TYPE jays_http_request_duration_seconds histogram');
    for (const [key, s] of this.durations) {
      DURATION_BUCKETS.forEach((le, i) => {
        out.push(`jays_http_request_duration_seconds_bucket{${key},le="${le}"} ${s.buckets[i]}`);
      });
      out.push(`jays_http_request_duration_seconds_bucket{${key},le="+Inf"} ${s.count}`);
      out.push(`jays_http_request_duration_seconds_sum{${key}} ${round(s.sum)}`);
      out.push(`jays_http_request_duration_seconds_count{${key}} ${s.count}`);
    }
    const mem = process.memoryUsage();
    gauge(
      out,
      'process_uptime_seconds',
      'Seconds since the API started.',
      (Date.now() - this.startedAt) / 1000,
    );
    gauge(out, 'process_resident_memory_bytes', 'Resident memory.', mem.rss);
    gauge(out, 'nodejs_heap_used_bytes', 'V8 heap in use.', mem.heapUsed);
    return out.join('\n') + '\n';
  }
}

/** The matched route pattern, such as /v1/businesses/:businessId/orders. */
export function routeOf(req: Request): string {
  const pattern = (req.route as { path?: unknown } | undefined)?.path;
  // Nest answers unknown paths through a wildcard route; never label those by path.
  if (typeof pattern !== 'string' || pattern.includes('*')) return 'unmatched';
  return `${req.baseUrl ?? ''}${pattern}`;
}

export function gauge(out: string[], name: string, help: string, value: number) {
  out.push(`# HELP ${name} ${help}`);
  out.push(`# TYPE ${name} gauge`);
  out.push(`${name} ${round(value)}`);
}

function labels(values: Record<string, string>): string {
  return Object.entries(values)
    .map(
      ([k, v]) => `${k}="${v.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\n/g, '\\n')}"`,
    )
    .join(',');
}

function round(n: number): number {
  return Math.round(n * 1e6) / 1e6;
}
