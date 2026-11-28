import { describe, expect, it } from 'vitest';
import { fileMeta, uploadTarget } from './uploads';

const form = (entries: Record<string, string>) => {
  const f = new FormData();
  for (const [k, v] of Object.entries(entries)) f.set(k, v);
  return f;
};

describe('direct uploads', () => {
  it('reads the file description and refuses a missing or bad size', () => {
    expect(
      fileMeta(form({ fileName: 'licence.pdf', contentType: 'application/pdf', sizeBytes: '42' })),
    ).toEqual({ fileName: 'licence.pdf', contentType: 'application/pdf', sizeBytes: 42 });
    expect(fileMeta(form({ contentType: 'application/pdf', sizeBytes: '0' }))).toBeNull();
    expect(fileMeta(form({ contentType: 'application/pdf', sizeBytes: 'x' }))).toBeNull();
    expect(fileMeta(form({ sizeBytes: '5' }))).toBeNull();
  });

  it('passes only the signed target to the browser', () => {
    const target = uploadTarget({
      id: '11111111-1111-4111-8111-111111111111',
      uploadUrl: 'https://storage.example.test/upload?token=t',
      method: 'PUT',
      headers: { 'content-type': 'application/pdf' },
      maxBytes: 10,
      expiresAt: '2030-01-01T00:00:00.000Z',
    });
    expect(Object.keys(target).sort()).toEqual(['headers', 'id', 'method', 'uploadUrl']);
  });
});
