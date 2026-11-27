import { readdir } from 'node:fs/promises';
import {
  adminBusinessDetailSchema,
  auditLogItemSchema,
  documentSchema,
  mediaSchema,
  onboardingSchema,
  pageSchema,
  publicStoreSchema,
  tokenPairSchema,
  uploadTicketSchema,
  type AdminSession,
} from '@jays/contracts';
import { MERCHANT_AGREEMENT_VERSION } from '@jays/domain';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  adminLogin,
  bearer,
  createBusiness,
  type Harness,
  provisionAdmin,
  putUpload,
  signUp,
  startHarness,
  storagePath,
} from '../testing/harness.js';
import { fictionalPdf, renderPng } from '../testing/png.js';
import { eicarTestFile } from '../storage/scanner.js';

let h: Harness;
let reviewer: AdminSession;
let catalogAdmin: AdminSession;
let superadmin: AdminSession;

beforeAll(async () => {
  h = await startHarness();
  reviewer = await adminLogin(h, await provisionAdmin(h, ['compliance']));
  catalogAdmin = await adminLogin(h, await provisionAdmin(h, ['catalog']));
  superadmin = await adminLogin(h, await provisionAdmin(h, ['superadmin']));
});

/** Rotates an admin session, as the console does when its 10-minute access token runs out. */
async function refreshed(session: AdminSession): Promise<AdminSession> {
  const res = await h
    .http()
    .post('/v1/admin/auth/refresh')
    .send({ refreshToken: session.tokens.refreshToken })
    .expect(200);
  return { ...session, tokens: tokenPairSchema.parse(res.body) };
}

// Some tests move the clock past the admin token lifetime, so every test starts with fresh tokens.
beforeEach(async () => {
  reviewer = await refreshed(reviewer);
  catalogAdmin = await refreshed(catalogAdmin);
  superadmin = await refreshed(superadmin);
});
afterAll(async () => {
  await h.close();
});

type Owner = Awaited<ReturnType<typeof signUp>>;
const logo = renderPng(256, 256, {
  from: [120, 60, 110],
  to: [200, 160, 190],
  disc: [255, 255, 255],
});
const banner = renderPng(1200, 400, { from: [80, 40, 70], to: [230, 210, 220] });

async function uploadDocument(
  owner: Owner,
  businessId: string,
  kind: string,
  bytes: Buffer,
  contentType = 'application/pdf',
) {
  const ticket = uploadTicketSchema.parse(
    (
      await h
        .http()
        .post(`/v1/businesses/${businessId}/documents`)
        .set('Authorization', bearer(owner))
        .send({ kind, fileName: `${kind}.pdf`, contentType, sizeBytes: bytes.length })
        .expect(201)
    ).body,
  );
  await putUpload(h, ticket, bytes).expect(200);
  return h
    .http()
    .post(`/v1/businesses/${businessId}/documents/${ticket.id}/complete`)
    .set('Authorization', bearer(owner));
}

async function uploadImage(owner: Owner, businessId: string, purpose: string, bytes: Buffer) {
  const ticket = uploadTicketSchema.parse(
    (
      await h
        .http()
        .post(`/v1/businesses/${businessId}/media`)
        .set('Authorization', bearer(owner))
        .send({ purpose, contentType: 'image/png', sizeBytes: bytes.length })
        .expect(201)
    ).body,
  );
  await putUpload(h, ticket, bytes).expect(200);
  return h
    .http()
    .post(`/v1/businesses/${businessId}/media/${ticket.id}/complete`)
    .set('Authorization', bearer(owner));
}

/** Fills every onboarding step for a business. */
async function completeOnboarding(owner: Owner, businessId: string, name = 'Fictional Store') {
  await h
    .http()
    .patch(`/v1/businesses/${businessId}/onboarding`)
    .set('Authorization', bearer(owner))
    .send({
      legalName: `${name} Trading LLC`,
      tradeLicenseNumber: 'cn-1234567',
      licenseAuthority: 'Fictional Department of Economy',
      licenseExpiry: '2099-12-31',
      taxRegistered: false,
      address: {
        emirate: 'DXB',
        area: 'Al Quoz',
        street: '1 Example Street',
        building: 'Unit Block A',
      },
    })
    .expect(200);
  const doc = await uploadDocument(
    owner,
    businessId,
    'trade_license',
    fictionalPdf('Fictional trade licence'),
  );
  expect(doc.status).toBe(200);
  const logoMedia = mediaSchema.parse(
    (await uploadImage(owner, businessId, 'storefront_logo', logo)).body,
  );
  const bannerMedia = mediaSchema.parse(
    (await uploadImage(owner, businessId, 'storefront_banner', banner)).body,
  );
  await h
    .http()
    .patch(`/v1/businesses/${businessId}/storefront`)
    .set('Authorization', bearer(owner))
    .send({
      name: { en: name, ar: 'متجر تجريبي' },
      description: {
        en: 'Fictional storefront used in automated tests only.',
        ar: 'واجهة متجر تجريبية تستخدم في الاختبارات الآلية فقط.',
      },
      logoMediaId: logoMedia.id,
      bannerMediaId: bannerMedia.id,
    })
    .expect(200);
  await h
    .http()
    .post(`/v1/businesses/${businessId}/agreement`)
    .set('Authorization', bearer(owner))
    .send({ version: MERCHANT_AGREEMENT_VERSION })
    .expect(200);
  return { logoMedia, bannerMedia };
}

async function submit(owner: Owner, businessId: string) {
  const res = await h
    .http()
    .post(`/v1/businesses/${businessId}/submit`)
    .set('Authorization', bearer(owner))
    .expect(200);
  return onboardingSchema.parse(res.body);
}

async function detail(businessId: string, admin: AdminSession = reviewer) {
  const res = await h
    .http()
    .get(`/v1/admin/businesses/${businessId}`)
    .set('Authorization', bearer(admin))
    .expect(200);
  return adminBusinessDetailSchema.parse(res.body);
}

async function act(
  businessId: string,
  body: Record<string, unknown>,
  admin: AdminSession = reviewer,
  expected = 200,
) {
  const current = await detail(businessId, superadmin);
  return h
    .http()
    .post(`/v1/admin/businesses/${businessId}/actions`)
    .set('Authorization', bearer(admin))
    .send({ expectedVersion: current.version, ...body })
    .expect(expected);
}

async function approvedBusiness(
  modes: ('shop' | 'services')[] = ['shop'],
  name = 'Fictional Store',
) {
  const owner = await signUp(h);
  const business = await createBusiness(h, owner, modes);
  const media = await completeOnboarding(owner, business.id, name);
  await submit(owner, business.id);
  await act(business.id, { action: 'start_review' });
  await act(business.id, { action: 'approve' });
  return { owner, business, ...media };
}

const publicStoreIds = async (query = '') => {
  const res = await h.http().get(`/v1/stores?limit=100${query}`).expect(200);
  return pageSchema(publicStoreSchema)
    .parse(res.body)
    .items.map((s) => s.id);
};

describe('onboarding to approval (T02)', () => {
  it('keeps a merchant invisible until approval and shows only live content afterwards', async () => {
    const owner = await signUp(h);
    const business = await createBusiness(h, owner, ['shop']);

    const empty = onboardingSchema.parse(
      (
        await h
          .http()
          .get(`/v1/businesses/${business.id}/onboarding`)
          .set('Authorization', bearer(owner))
          .expect(200)
      ).body,
    );
    expect(empty.status).toBe('draft');
    expect(empty.canSubmit).toBe(false);
    expect(empty.checklist.filter((i) => !i.done).map((i) => i.item)).toContain('license_document');

    const incomplete = await h
      .http()
      .post(`/v1/businesses/${business.id}/submit`)
      .set('Authorization', bearer(owner))
      .expect(422);
    expect(incomplete.body.error.code).toBe('ONBOARDING_INCOMPLETE');
    expect(incomplete.body.error.fieldErrors.checklist).toContain('legal_name');

    const { logoMedia } = await completeOnboarding(owner, business.id);
    const submitted = await submit(owner, business.id);
    expect(submitted.status).toBe('submitted');
    expect(submitted.modes.shop.status).toBe('pending_review');
    expect(submitted.legal.tradeLicenseNumber).toBe('CN-1234567');

    // Pending: not listed, not readable, images not served.
    expect(await publicStoreIds()).not.toContain(business.id);
    await h.http().get(`/v1/stores/${business.id}`).expect(404);
    await h.http().get(`/v1/media/${logoMedia.id}`).expect(404);

    // The queue shows it; approving straight from submitted is refused.
    const queue = await h
      .http()
      .get('/v1/admin/businesses?limit=100')
      .set('Authorization', bearer(reviewer))
      .expect(200);
    expect(queue.body.items.map((b: { id: string }) => b.id)).toContain(business.id);
    const refused = await act(business.id, { action: 'approve' }, reviewer, 409);
    expect(refused.body.error.code).toBe('INVALID_TRANSITION');

    await act(business.id, { action: 'start_review' });
    const stale = await h
      .http()
      .post(`/v1/admin/businesses/${business.id}/actions`)
      .set('Authorization', bearer(reviewer))
      .send({ action: 'approve', expectedVersion: 1 })
      .expect(409);
    expect(stale.body.error.code).toBe('VERSION_CONFLICT');

    const approved = adminBusinessDetailSchema.parse(
      (await act(business.id, { action: 'approve' })).body,
    );
    expect(approved.status).toBe('approved');
    expect(approved.modes).toEqual({ shop: 'active', services: 'not_activated' });

    expect(await publicStoreIds('&mode=shop')).toContain(business.id);
    expect(await publicStoreIds('&mode=services')).not.toContain(business.id);
    const store = publicStoreSchema.parse(
      (await h.http().get(`/v1/stores/${business.id}`).expect(200)).body,
    );
    expect(store).toMatchObject({
      name: { en: 'Fictional Store' },
      modes: ['shop'],
      emirate: 'DXB',
    });
    expect(store.logoUrl).toContain(`/media/${logoMedia.id}`);

    // The public image redirects to a signed URL that serves the real bytes.
    const redirect = await h.http().get(`/v1/media/${logoMedia.id}`).expect(302);
    // The customer app loads it from another origin, so the redirect must allow that.
    expect(redirect.headers['cross-origin-resource-policy']).toBe('cross-origin');
    const image = await h
      .http()
      .get(storagePath(redirect.headers['location'] as string))
      .expect(200);
    expect(image.headers['content-type']).toBe('image/png');
    expect(Buffer.compare(image.body as Buffer, logo)).toBe(0);

    // Every step is in the audit log with the actor.
    const audit = await h
      .http()
      .get('/v1/admin/audit-logs?limit=100')
      .set('Authorization', bearer(superadmin))
      .expect(200);
    const actions = pageSchema(auditLogItemSchema)
      .parse(audit.body)
      .items.filter((e) => e.businessId === business.id)
      .map((e) => `${e.actorType}:${e.action}`);
    expect(actions).toEqual(
      expect.arrayContaining([
        'user:business.submitted',
        'user:document.uploaded',
        'user:business.agreement_accepted',
        'admin:business.review_started',
        'admin:business.approved',
      ]),
    );
  });

  it('requires a reason to reject, shows it to the merchant, and accepts a resubmission', async () => {
    const owner = await signUp(h);
    const business = await createBusiness(h, owner, ['services']);
    await completeOnboarding(owner, business.id);
    await submit(owner, business.id);
    await act(business.id, { action: 'start_review' });
    await act(business.id, { action: 'reject' }, reviewer, 400);
    await act(business.id, { action: 'reject', reason: 'Licence copy is unreadable.' });

    const view = onboardingSchema.parse(
      (
        await h
          .http()
          .get(`/v1/businesses/${business.id}/onboarding`)
          .set('Authorization', bearer(owner))
          .expect(200)
      ).body,
    );
    expect(view).toMatchObject({
      status: 'rejected',
      reviewReason: 'Licence copy is unreadable.',
      editable: true,
      modes: { services: { status: 'rejected', reviewReason: 'Licence copy is unreadable.' } },
    });
    await uploadDocument(
      owner,
      business.id,
      'trade_license',
      fictionalPdf('Clearer fictional licence'),
    ).then((r) => expect(r.status).toBe(200));
    const again = await submit(owner, business.id);
    expect(again.status).toBe('submitted');
    expect(again.modes.services.status).toBe('pending_review');
    const history = (await detail(business.id)).history.map((e) => e.action);
    expect(history).toEqual(expect.arrayContaining(['business.rejected', 'business.resubmitted']));
    const rejected = (await detail(business.id)).history.find(
      (e) => e.action === 'business.rejected',
    );
    expect(rejected?.reason).toBe('Licence copy is unreadable.');
  });

  it('hides a suspended business at once and shows it again after reactivation', async () => {
    const { business, logoMedia } = await approvedBusiness();
    expect(await publicStoreIds()).toContain(business.id);
    await act(business.id, { action: 'suspend' }, reviewer, 400);
    await act(business.id, {
      action: 'suspend',
      reason: 'Customer complaints under investigation.',
    });
    expect(await publicStoreIds()).not.toContain(business.id);
    await h.http().get(`/v1/stores/${business.id}`).expect(404);
    await h.http().get(`/v1/media/${logoMedia.id}`).expect(404);
    await act(business.id, { action: 'reactivate', reason: 'Investigation closed.' });
    expect(await publicStoreIds()).toContain(business.id);
  });

  it('approves a hybrid one mode at a time and lets the other mode be resubmitted alone', async () => {
    const owner = await signUp(h);
    const business = await createBusiness(h, owner, ['shop', 'services']);
    await completeOnboarding(owner, business.id);
    await submit(owner, business.id);
    await act(business.id, { action: 'start_review' });
    await act(business.id, { action: 'approve', modes: ['shop'] }, reviewer, 400);
    const partial = adminBusinessDetailSchema.parse(
      (
        await act(business.id, {
          action: 'approve',
          modes: ['shop'],
          reason: 'Venue photos still needed.',
        })
      ).body,
    );
    expect(partial.modes).toEqual({ shop: 'active', services: 'rejected' });
    expect(await publicStoreIds('&mode=services')).not.toContain(business.id);

    const resubmitted = await submit(owner, business.id);
    expect(resubmitted.status).toBe('approved');
    expect(resubmitted.modes.services.status).toBe('pending_review');
    // Still public for shop while services is reviewed.
    expect(await publicStoreIds('&mode=shop')).toContain(business.id);
    await act(business.id, { action: 'approve_mode', mode: 'services' });
    const store = publicStoreSchema.parse(
      (await h.http().get(`/v1/stores/${business.id}`).expect(200)).body,
    );
    expect(store.modes).toEqual(['services', 'shop']);
  });

  it('lets only one of two concurrent decisions on the same version win', async () => {
    const owner = await signUp(h);
    const business = await createBusiness(h, owner, ['shop']);
    await completeOnboarding(owner, business.id);
    await submit(owner, business.id);
    await act(business.id, { action: 'start_review' });
    const { version } = await detail(business.id);
    const send = (body: Record<string, unknown>) =>
      h
        .http()
        .post(`/v1/admin/businesses/${business.id}/actions`)
        .set('Authorization', bearer(reviewer))
        .send({ expectedVersion: version, ...body });
    const results = await Promise.all([
      send({ action: 'approve' }),
      send({ action: 'reject', reason: 'Duplicate decision attempt.' }),
    ]);
    expect(results.map((r) => r.status).sort()).toEqual([200, 409]);
  });
});

describe('editing rules', () => {
  it('locks the legal profile during review and after approval, and refuses client status fields', async () => {
    const owner = await signUp(h);
    const business = await createBusiness(h, owner, ['shop']);
    await h
      .http()
      .patch(`/v1/businesses/${business.id}/onboarding`)
      .set('Authorization', bearer(owner))
      .send({ legalName: 'Fictional LLC', status: 'approved' })
      .expect(400);
    await completeOnboarding(owner, business.id);
    await submit(owner, business.id);
    const inReview = await h
      .http()
      .patch(`/v1/businesses/${business.id}/onboarding`)
      .set('Authorization', bearer(owner))
      .send({ legalName: 'Changed During Review LLC' })
      .expect(409);
    expect(inReview.body.error.code).toBe('IN_REVIEW');
    await h
      .http()
      .patch(`/v1/businesses/${business.id}/storefront`)
      .set('Authorization', bearer(owner))
      .send({ name: { en: 'Changed', ar: 'تغيير' } })
      .expect(409);
    await act(business.id, { action: 'start_review' });
    await act(business.id, { action: 'approve' });
    const afterApproval = await h
      .http()
      .patch(`/v1/businesses/${business.id}/onboarding`)
      .set('Authorization', bearer(owner))
      .send({ legalName: 'Changed After Approval LLC' })
      .expect(409);
    expect(afterApproval.body.error.code).toBe('PROFILE_LOCKED');
  });

  it('holds storefront edits after approval for review while the live version stays public', async () => {
    const { owner, business } = await approvedBusiness(['shop'], 'Original Name');
    const pending = await h
      .http()
      .patch(`/v1/businesses/${business.id}/storefront`)
      .set('Authorization', bearer(owner))
      .send({ name: { en: 'Renamed Store', ar: 'متجر جديد' } })
      .expect(200);
    expect(pending.body).toMatchObject({
      changesPending: true,
      draft: { name: { en: 'Renamed Store' } },
      live: { name: { en: 'Original Name' } },
    });
    const live = await h.http().get(`/v1/stores/${business.id}`).expect(200);
    expect(live.body.name.en).toBe('Original Name');

    // A catalog admin can review storefront content but not approve a business.
    await act(
      business.id,
      { action: 'reject_storefront_changes', reason: 'Name looks like another brand.' },
      catalogAdmin,
    );
    const rejected = await h
      .http()
      .get(`/v1/businesses/${business.id}/storefront`)
      .set('Authorization', bearer(owner))
      .expect(200);
    expect(rejected.body).toMatchObject({
      changesPending: false,
      changesReviewReason: 'Name looks like another brand.',
    });

    await h
      .http()
      .patch(`/v1/businesses/${business.id}/storefront`)
      .set('Authorization', bearer(owner))
      .send({ name: { en: 'Renamed Store Two', ar: 'متجر جديد ٢' } })
      .expect(200);
    await act(business.id, { action: 'approve_storefront_changes' }, catalogAdmin);
    const updated = await h.http().get(`/v1/stores/${business.id}`).expect(200);
    expect(updated.body.name.en).toBe('Renamed Store Two');
  });
});

describe('uploads (T12 upload rejection)', () => {
  it('refuses wrong types, infected files, oversize bodies, bad headers, tampered and expired links', async () => {
    const owner = await signUp(h);
    const business = await createBusiness(h, owner, ['shop']);
    const base = `/v1/businesses/${business.id}`;

    // Declared PDF, actually PNG bytes: refused after upload and deleted from storage.
    const mismatch = await uploadDocument(owner, business.id, 'trade_license', logo);
    expect(mismatch.status).toBe(422);
    expect(mismatch.body.error.code).toBe('FILE_TYPE_MISMATCH');

    const infected = await uploadDocument(
      owner,
      business.id,
      'other',
      Buffer.concat([fictionalPdf('x'), eicarTestFile()]),
    );
    expect(infected.status).toBe(422);
    expect(infected.body.error.code).toBe('FILE_INFECTED');

    const docs = onboardingSchema.parse(
      (await h.http().get(`${base}/onboarding`).set('Authorization', bearer(owner)).expect(200))
        .body,
    ).documents;
    expect(docs.map((d) => [d.status, d.rejectionReason]).sort()).toEqual([
      ['infected', 'malware'],
      ['rejected', 'type_mismatch'],
    ]);
    const privateFiles = await readdir(`${h.storageDir}/private/${business.id}`).catch(() => []);
    expect(privateFiles.filter((f) => !f.endsWith('.meta.json'))).toEqual([]);

    const pdf = fictionalPdf('Fictional licence');
    const ticket = uploadTicketSchema.parse(
      (
        await h
          .http()
          .post(`${base}/documents`)
          .set('Authorization', bearer(owner))
          .send({
            kind: 'trade_license',
            fileName: 'licence.pdf',
            contentType: 'application/pdf',
            sizeBytes: pdf.length,
          })
          .expect(201)
      ).body,
    );
    await putUpload(h, ticket, pdf, 'image/png').expect(400);
    await putUpload(h, ticket, Buffer.concat([pdf, Buffer.from('extra bytes')])).expect(413);
    const path = storagePath(ticket.uploadUrl);
    const tampered = `${path.slice(0, -3)}${path.endsWith('AAA') ? 'BBB' : 'AAA'}`;
    await h.http().put(tampered).set('Content-Type', 'application/pdf').send(pdf).expect(403);
    // A signed upload URL cannot be used to read.
    await h.http().get(path).expect(403);
    // Completing before uploading: nothing there yet.
    await h
      .http()
      .post(`${base}/documents/${ticket.id}/complete`)
      .set('Authorization', bearer(owner))
      .expect(409);

    h.clock.advance(11 * 60);
    await putUpload(h, ticket, pdf).expect(403);

    // Image rules: a tiny logo is refused.
    const fresh = await signUp(h);
    const other = await createBusiness(h, fresh, ['shop']);
    const tiny = await uploadImage(
      fresh,
      other.id,
      'storefront_logo',
      renderPng(64, 64, { from: [0, 0, 0], to: [9, 9, 9] }),
    );
    expect(tiny.status).toBe(422);
    expect(tiny.body.error.code).toBe('IMAGE_DIMENSIONS');
    // Declared size limits are enforced before any URL is signed.
    await h
      .http()
      .post(`/v1/businesses/${other.id}/media`)
      .set('Authorization', bearer(fresh))
      .send({ purpose: 'storefront_logo', contentType: 'image/gif', sizeBytes: 10 })
      .expect(400);
    await h
      .http()
      .post(`/v1/businesses/${other.id}/documents`)
      .set('Authorization', bearer(fresh))
      .send({
        kind: 'other',
        fileName: 'big.pdf',
        contentType: 'application/pdf',
        sizeBytes: 11 * 1024 * 1024,
      })
      .expect(400);
  });

  it("refuses to use another business's image in a storefront", async () => {
    const a = await signUp(h);
    const b = await signUp(h);
    const businessA = await createBusiness(h, a, ['shop']);
    const businessB = await createBusiness(h, b, ['shop']);
    const media = mediaSchema.parse(
      (await uploadImage(a, businessA.id, 'storefront_logo', logo)).body,
    );
    await h
      .http()
      .patch(`/v1/businesses/${businessB.id}/storefront`)
      .set('Authorization', bearer(b))
      .send({ logoMediaId: media.id })
      .expect(400);
    // And a banner cannot be used as a logo.
    const bannerMedia = mediaSchema.parse(
      (await uploadImage(a, businessA.id, 'storefront_banner', banner)).body,
    );
    await h
      .http()
      .patch(`/v1/businesses/${businessA.id}/storefront`)
      .set('Authorization', bearer(a))
      .send({ logoMediaId: bannerMedia.id })
      .expect(400);
  });
});

describe('private documents and role boundaries (T03)', () => {
  it('keeps documents to the owner and authorised reviewers, and audits every read', async () => {
    const owner = await signUp(h);
    const business = await createBusiness(h, owner, ['shop']);
    const doc = documentSchema.parse(
      (
        await uploadDocument(
          owner,
          business.id,
          'trade_license',
          fictionalPdf('Private fictional licence'),
        )
      ).body,
    );
    expect(doc.status).toBe('clean');

    // A manager can edit the storefront but cannot see legal details or documents.
    const manager = await signUp(h);
    const invite = await h
      .http()
      .post(`/v1/businesses/${business.id}/members`)
      .set('Authorization', bearer(owner))
      .send({ identifier: manager.email, permissions: ['manager'] })
      .expect(201);
    await h
      .http()
      .post(`/v1/me/memberships/${invite.body.id}/accept`)
      .set('Authorization', bearer(manager))
      .expect(200);
    const base = `/v1/businesses/${business.id}`;
    await h.http().get(`${base}/onboarding`).set('Authorization', bearer(manager)).expect(403);
    await h
      .http()
      .get(`${base}/documents/${doc.id}/download`)
      .set('Authorization', bearer(manager))
      .expect(403);
    await h.http().post(`${base}/submit`).set('Authorization', bearer(manager)).expect(403);
    await h.http().get(`${base}/storefront`).set('Authorization', bearer(manager)).expect(200);

    // Another business's owner cannot even tell it exists.
    const stranger = await signUp(h);
    await createBusiness(h, stranger, ['shop']);
    await h.http().get(`${base}/onboarding`).set('Authorization', bearer(stranger)).expect(404);
    await h
      .http()
      .get(`${base}/documents/${doc.id}/download`)
      .set('Authorization', bearer(stranger))
      .expect(404);

    // The owner gets a short-lived attachment link.
    const ownLink = await h
      .http()
      .get(`${base}/documents/${doc.id}/download`)
      .set('Authorization', bearer(owner))
      .expect(200);
    const file = await h.http().get(storagePath(ownLink.body.url)).expect(200);
    expect(file.headers['content-disposition']).toMatch(/^attachment/);
    expect(file.headers['cache-control']).toBe('private, no-store');

    // Admins: only roles with documents.view; user tokens never work on admin routes.
    const adminPath = `/v1/admin/businesses/${business.id}/documents/${doc.id}/download`;
    await h.http().get(adminPath).set('Authorization', bearer(catalogAdmin)).expect(403);
    await h.http().get(adminPath).set('Authorization', bearer(owner)).expect(401);
    const support = await adminLogin(h, await provisionAdmin(h, ['support']));
    await h.http().get(adminPath).set('Authorization', bearer(support)).expect(403);
    await h.http().get(adminPath).set('Authorization', bearer(reviewer)).expect(200);

    const audit = await h
      .http()
      .get('/v1/admin/audit-logs?limit=100')
      .set('Authorization', bearer(superadmin))
      .expect(200);
    const views = pageSchema(auditLogItemSchema)
      .parse(audit.body)
      .items.filter((e) => e.action === 'document.viewed' && e.businessId === business.id)
      .map((e) => e.actorType)
      .sort();
    expect(views).toEqual(['admin', 'user']);
  });

  it('gives each admin role only its own review actions', async () => {
    const owner = await signUp(h);
    const business = await createBusiness(h, owner, ['shop']);
    await completeOnboarding(owner, business.id);
    await submit(owner, business.id);
    const support = await adminLogin(h, await provisionAdmin(h, ['support']));
    const operations = await adminLogin(h, await provisionAdmin(h, ['operations']));
    const analyst = await adminLogin(h, await provisionAdmin(h, ['analyst']));
    // Support can look but not decide; analysts cannot even look.
    await h
      .http()
      .get(`/v1/admin/businesses/${business.id}`)
      .set('Authorization', bearer(support))
      .expect(200);
    await h.http().get('/v1/admin/businesses').set('Authorization', bearer(analyst)).expect(403);
    await act(business.id, { action: 'start_review' }, support, 403);
    await act(business.id, { action: 'start_review' }, operations, 403);
    await act(business.id, { action: 'start_review' }, catalogAdmin, 403);
    await act(business.id, { action: 'start_review' });
    await act(business.id, { action: 'approve' });
    // Operations can suspend; catalog cannot.
    await act(
      business.id,
      { action: 'suspend', reason: 'Testing role boundaries.' },
      catalogAdmin,
      403,
    );
    await act(business.id, { action: 'suspend', reason: 'Testing role boundaries.' }, operations);
  });
});
