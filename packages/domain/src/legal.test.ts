import { describe, expect, it } from 'vitest';
import { CUSTOMER_REQUIRED_LEGAL, LEGAL_DOCUMENT_KINDS, pendingAcceptances } from './legal.js';

describe('legal documents', () => {
  it('covers the twelve documents the founder listed', () => {
    expect(LEGAL_DOCUMENT_KINDS).toHaveLength(12);
  });

  it('asks again only for a newer published version', () => {
    const published = [
      { kind: 'customer_terms' as const, version: 2 },
      { kind: 'privacy_policy' as const, version: 1 },
    ];
    expect(
      pendingAcceptances(CUSTOMER_REQUIRED_LEGAL, published, [
        { kind: 'customer_terms', version: 1 },
        { kind: 'privacy_policy', version: 1 },
      ]),
    ).toEqual([{ kind: 'customer_terms', version: 2 }]);
    expect(pendingAcceptances(CUSTOMER_REQUIRED_LEGAL, [], [])).toEqual([]);
  });
});
