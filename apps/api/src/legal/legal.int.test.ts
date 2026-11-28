import {
  adminLegalDocumentSchema,
  legalDocumentListSchema,
  merchantAgreementSchema,
  myLegalSchema,
} from '@jays/contracts';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  adminLogin,
  bearer,
  createBusiness,
  type Harness,
  provisionAdmin,
  signUp,
  startHarness,
} from '../testing/harness.js';
import { LegalService } from './legal.service.js';

// Runs in the sequential group: it publishes documents everyone else would see. Afterwards it
// retires what it published so a rerun against the same database starts clean.
let h: Harness;
let admin: string;
const published: string[] = [];
beforeAll(async () => {
  h = await startHarness();
  admin = bearer(await adminLogin(h, await provisionAdmin(h, ['compliance'])));
});
afterAll(async () => {
  if (published.length > 0) {
    await h.db
      .updateTable('legal_documents')
      .set({ status: 'retired', retired_at: new Date() })
      .where('id', 'in', published)
      .where('status', '=', 'published')
      .execute();
  }
  await h.close();
});

const text = (en: string) => ({ en, ar: `${en} (مسودة)` });

async function draft(kind: string, title: string) {
  const res = await h
    .http()
    .post('/v1/admin/legal')
    .set('Authorization', admin)
    .send({ kind, title: text(title), body: text(`# ${title}\n\nDraft for legal review.`) })
    .expect(201);
  return adminLegalDocumentSchema.parse(res.body);
}

async function publish(id: string) {
  const res = await h
    .http()
    .post(`/v1/admin/legal/${id}/publish`)
    .set('Authorization', admin)
    .send({})
    .expect(200);
  published.push(id);
  return adminLegalDocumentSchema.parse(res.body);
}

describe('legal documents (D13, ADR-0028)', () => {
  it('versions drafts, freezes what is published and records acceptances', async () => {
    const terms = await draft('customer_terms', 'Customer terms');
    expect(terms).toMatchObject({ status: 'draft', legalReview: 'pending' });
    const again = await h
      .http()
      .post('/v1/admin/legal')
      .set('Authorization', admin)
      .send({ kind: 'customer_terms', title: text('Other'), body: text('Other') })
      .expect(409);
    expect(again.body.error.code).toBe('DRAFT_EXISTS');
    await h
      .http()
      .patch(`/v1/admin/legal/${terms.id}`)
      .set('Authorization', admin)
      .send({ summaryOfChanges: 'First draft' })
      .expect(200);

    const termsV1 = await publish(terms.id);
    expect(termsV1.status).toBe('published');
    const privacy = await publish((await draft('privacy_policy', 'Privacy policy')).id);

    const frozen = await h
      .http()
      .patch(`/v1/admin/legal/${terms.id}`)
      .set('Authorization', admin)
      .send({ summaryOfChanges: 'Sneaky edit' })
      .expect(409);
    expect(frozen.body.error.code).toBe('DOCUMENT_FROZEN');
    await expect(
      h.db
        .updateTable('legal_documents')
        .set({ body: JSON.stringify(text('Changed')) })
        .where('id', '=', terms.id)
        .execute(),
    ).rejects.toThrow(/frozen/);

    const list = legalDocumentListSchema.parse((await h.http().get('/v1/legal').expect(200)).body);
    expect(list.items.map((d) => d.kind)).toEqual(
      expect.arrayContaining(['customer_terms', 'privacy_policy']),
    );
    const current = await h.http().get('/v1/legal/customer_terms').expect(200);
    expect(current.body).toMatchObject({ version: termsV1.version, legalReview: 'pending' });
    await h.http().get('/v1/legal/not_a_document').expect(404);

    // Signing up accepts the documents in force.
    const user = await signUp(h);
    const rows = await h.db
      .selectFrom('legal_acceptances')
      .select(['kind', 'version', 'source'])
      .where('user_id', '=', user.user.id)
      .orderBy('kind')
      .execute();
    expect(rows).toEqual([
      { kind: 'customer_terms', version: termsV1.version, source: 'sign_up' },
      { kind: 'privacy_policy', version: privacy.version, source: 'sign_up' },
    ]);
    const me = () =>
      h
        .http()
        .get('/v1/me/legal')
        .set('Authorization', bearer(user))
        .expect(200)
        .then((r) => myLegalSchema.parse(r.body));
    expect((await me()).pending).toEqual([]);

    // A new version asks again; only the version in force can be accepted.
    const termsV2 = await publish((await draft('customer_terms', 'Customer terms v2')).id);
    expect(termsV2.version).toBe(termsV1.version + 1);
    expect(
      (await h.http().get(`/v1/admin/legal/${terms.id}`).set('Authorization', admin)).body.status,
    ).toBe('retired');
    expect((await me()).pending).toMatchObject([
      { kind: 'customer_terms', version: termsV2.version },
    ]);
    const old = await h
      .http()
      .post('/v1/me/legal/accept')
      .set('Authorization', bearer(user))
      .send({ documents: [{ kind: 'customer_terms', version: termsV1.version }] })
      .expect(409);
    expect(old.body.error.code).toBe('VERSION_NOT_CURRENT');
    const accepted = myLegalSchema.parse(
      (
        await h
          .http()
          .post('/v1/me/legal/accept')
          .set('Authorization', bearer(user))
          .send({ documents: [{ kind: 'customer_terms', version: termsV2.version }] })
          .expect(200)
      ).body,
    );
    expect(accepted.pending).toEqual([]);
    expect(accepted.accepted.filter((a) => a.current)).toHaveLength(2);
    // The old version is still readable for the record; acceptances cannot be edited.
    await h.http().get(`/v1/legal/customer_terms/versions/${termsV1.version}`).expect(200);
    await expect(
      h.db.deleteFrom('legal_acceptances').where('user_id', '=', user.user.id).execute(),
    ).rejects.toThrow(/append-only/);
  });

  it('asks the business owner to accept the merchant agreement before submitting', async () => {
    const owner = await signUp(h);
    const business = await createBusiness(h, owner, ['shop']);
    const base = `/v1/businesses/${business.id}/legal/merchant-agreement`;
    const agreement = await publish((await draft('merchant_agreement', 'Merchant agreement')).id);
    const before = merchantAgreementSchema.parse(
      (await h.http().get(base).set('Authorization', bearer(owner)).expect(200)).body,
    );
    expect(before).toMatchObject({ required: true, accepted: null });
    const legal = h.app.get(LegalService);
    await expect(legal.assertMerchantAgreementAccepted(h.db, business.id)).rejects.toMatchObject({
      code: 'MERCHANT_AGREEMENT_REQUIRED',
    });
    // Not through the customer route.
    const wrong = await h
      .http()
      .post('/v1/me/legal/accept')
      .set('Authorization', bearer(owner))
      .send({ documents: [{ kind: 'merchant_agreement', version: agreement.version }] })
      .expect(422);
    expect(wrong.body.error.code).toBe('WRONG_ACCEPTANCE_ROUTE');
    const after = merchantAgreementSchema.parse(
      (
        await h
          .http()
          .post(`${base}/accept`)
          .set('Authorization', bearer(owner))
          .send({ version: agreement.version })
          .expect(200)
      ).body,
    );
    expect(after).toMatchObject({ required: false, accepted: { version: agreement.version } });
    await expect(legal.assertMerchantAgreementAccepted(h.db, business.id)).resolves.toBeUndefined();
    // Someone outside the business cannot even see it.
    await h
      .http()
      .post(`${base}/accept`)
      .set('Authorization', bearer(await signUp(h)))
      .send({ version: agreement.version })
      .expect(404);
  });

  it('refuses to publish in production until a lawyer has reviewed the documents', async () => {
    const d = await draft('review_moderation', 'Review moderation policy');
    const prod = new LegalService(h.db, h.clock, { APP_ENV: 'production' } as never);
    await expect(
      prod.publish('x', d.id, {}, { requestId: null, ip: '127.0.0.1', userAgent: null }),
    ).rejects.toMatchObject({
      code: 'LEGAL_REVIEW_REQUIRED',
    });
    // Leave nothing behind: publish it here so the next run can draft again.
    await publish(d.id);
  });
});
