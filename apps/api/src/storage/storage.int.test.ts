import { uploadTicketSchema } from '@jays/contracts';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  bearer,
  createBusiness,
  type Harness,
  putUpload,
  signUp,
  startHarness,
} from '../testing/harness.js';
import { fictionalPdf } from '../testing/png.js';
import { MockMalwareScanner } from './scanner.js';
import type { MalwareScanner } from './storage.js';

// Mock test (ADR-0032): a scanner that can be switched off stands in for an unreachable ClamAV.
class SwitchableScanner implements MalwareScanner {
  down = false;
  private readonly inner = new MockMalwareScanner();
  scan(bytes: Uint8Array) {
    if (this.down) return Promise.reject(new Error('scanner unreachable'));
    return this.inner.scan(bytes);
  }
}

const scanner = new SwitchableScanner();
let h: Harness;
beforeAll(async () => {
  h = await startHarness({ scanner });
});
afterAll(async () => {
  await h.close();
});

describe('malware scanning fails closed (ADR-0032)', () => {
  it('keeps an upload pending while the scanner is down and accepts it once it is back', async () => {
    const owner = await signUp(h);
    const business = await createBusiness(h, owner);
    const bytes = fictionalPdf('Fictional trade licence');
    const ticket = uploadTicketSchema.parse(
      (
        await h
          .http()
          .post(`/v1/businesses/${business.id}/documents`)
          .set('Authorization', bearer(owner))
          .send({
            kind: 'trade_license',
            fileName: 'licence.pdf',
            contentType: 'application/pdf',
            sizeBytes: bytes.length,
          })
          .expect(201)
      ).body,
    );
    await putUpload(h, ticket, bytes).expect(200);
    const complete = () =>
      h
        .http()
        .post(`/v1/businesses/${business.id}/documents/${ticket.id}/complete`)
        .set('Authorization', bearer(owner));

    scanner.down = true;
    try {
      const refused = await complete().expect(503);
      expect(refused.body.error.code).toBe('SCANNER_UNAVAILABLE');
    } finally {
      scanner.down = false;
    }
    // The file was neither accepted nor deleted, so the same upload completes now.
    await complete().expect(200);
  });
});
