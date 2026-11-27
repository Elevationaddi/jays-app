import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { defaultCodeForStatus, errorEnvelopeSchema } from './errors.js';
import { pageQuerySchema, pageSchema } from './pagination.js';
import { readinessSchema } from './health.js';

describe('error envelope', () => {
  it('requires a request id', () => {
    expect(
      errorEnvelopeSchema.safeParse({ error: { code: 'NOT_FOUND', message: 'x', requestId: 'r1' } })
        .success,
    ).toBe(true);
    expect(
      errorEnvelopeSchema.safeParse({ error: { code: 'NOT_FOUND', message: 'x' } }).success,
    ).toBe(false);
  });

  it('maps statuses to codes', () => {
    expect(defaultCodeForStatus(404)).toBe('NOT_FOUND');
    expect(defaultCodeForStatus(409)).toBe('CONFLICT');
    expect(defaultCodeForStatus(502)).toBe('INTERNAL');
    expect(defaultCodeForStatus(418)).toBe('VALIDATION_FAILED');
  });
});

describe('pagination', () => {
  it('wraps items with a nullable cursor', () => {
    const schema = pageSchema(z.object({ id: z.string() }));
    expect(schema.parse({ items: [{ id: 'a' }], nextCursor: null }).items).toHaveLength(1);
  });

  it('caps the page size', () => {
    expect(pageQuerySchema.parse({}).limit).toBe(20);
    expect(pageQuerySchema.safeParse({ limit: '101' }).success).toBe(false);
  });
});

describe('readiness', () => {
  it('accepts up/down checks only', () => {
    expect(
      readinessSchema.safeParse({ status: 'ready', checks: { database: 'up', redis: 'up' } })
        .success,
    ).toBe(true);
    expect(
      readinessSchema.safeParse({ status: 'ready', checks: { database: 'ok', redis: 'up' } })
        .success,
    ).toBe(false);
  });
});
