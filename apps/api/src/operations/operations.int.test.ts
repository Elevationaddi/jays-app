import {
  adminTicketSchema,
  categorySchema,
  platformUsageSchema,
  supportInfoSchema,
  ticketSchema,
} from '@jays/contracts';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { approvedVenue } from '../testing/booking.js';
import { approvedShop, catalogAdminSession, listedProduct } from '../testing/commerce.js';
import {
  adminLogin,
  bearer,
  type Harness,
  provisionAdmin,
  putUpload,
  signUp,
  startHarness,
} from '../testing/harness.js';
import { fictionalPdf } from '../testing/png.js';

let h: Harness;
beforeAll(async () => {
  h = await startHarness();
});
afterAll(async () => {
  await h.close();
});

describe('categories (D10, D11)', () => {
  it('has the founder’s product and service lists and no medical services', async () => {
    const shop = await h.http().get('/v1/categories?mode=shop').expect(200);
    const shopSlugs = shop.body.items.map((c: { slug: string }) => c.slug);
    for (const slug of [
      'beauty',
      'makeup',
      'skincare',
      'haircare',
      'fragrance',
      'fashion',
      'footwear',
      'accessories',
      'jewelry',
      'lifestyle',
    ]) {
      expect(shopSlugs).toContain(slug);
    }
    const services = await h.http().get('/v1/categories?mode=services').expect(200);
    const serviceSlugs = services.body.items.map((c: { slug: string }) => c.slug);
    for (const slug of ['hair', 'nails', 'makeup', 'brows-lashes', 'waxing', 'spa', 'barbering']) {
      expect(serviceSlugs).toContain(slug);
    }
    expect(serviceSlugs.some((s: string) => /medical|clinic|botox|filler/.test(s))).toBe(false);
  });

  it('hides a switched-off category, its subcategories and their products, and brings them back', async () => {
    const admin = bearer(await catalogAdminSession(h));
    const parent = await h.db
      .selectFrom('categories')
      .select('id')
      .where('mode', '=', 'shop')
      .where('slug', '=', 'skincare')
      .executeTakeFirstOrThrow();
    const child = categorySchema.parse(
      (
        await h
          .http()
          .post('/v1/admin/categories')
          .set('Authorization', admin)
          .send({
            mode: 'shop',
            parentId: parent.id,
            slug: `serums-${Date.now()}`,
            name: { en: 'Fictional serums', ar: 'أمصال تجريبية' },
          })
          .expect(201)
      ).body,
    );
    expect(child.enabled).toBe(true);
    const shop = await approvedShop(h);
    const product = await listedProduct(h, shop);
    await h.db
      .updateTable('products')
      .set({ live_category_id: child.id })
      .where('id', '=', product.productId)
      .execute();
    await h.http().get(`/v1/products/${product.productId}`).expect(200);

    const off = await h
      .http()
      .patch(`/v1/admin/categories/${child.id}`)
      .set('Authorization', admin)
      .send({ enabled: false })
      .expect(200);
    expect(off.body).toMatchObject({ enabled: false, status: 'active' });
    await h.http().get(`/v1/products/${product.productId}`).expect(404);
    const listed = await h.http().get('/v1/categories?mode=shop').expect(200);
    expect(listed.body.items.map((c: { id: string }) => c.id)).not.toContain(child.id);
    // Admins still see it, switched off.
    const all = await h
      .http()
      .get('/v1/admin/categories?mode=shop')
      .set('Authorization', admin)
      .expect(200);
    expect(all.body.items.find((c: { id: string }) => c.id === child.id)).toMatchObject({
      enabled: false,
    });

    await h
      .http()
      .patch(`/v1/admin/categories/${child.id}`)
      .set('Authorization', admin)
      .send({ enabled: true })
      .expect(200);
    await h.http().get(`/v1/products/${product.productId}`).expect(200);
    const audit = await h.db
      .selectFrom('audit_logs')
      .select('action')
      .where('target_id', '=', child.id)
      .orderBy('created_at')
      .execute();
    expect(audit.map((a) => a.action)).toEqual([
      'category.created',
      'category.disabled',
      'category.enabled',
    ]);
  });

  it('stops booking services in a switched-off category', async () => {
    const v = await approvedVenue(h);
    const service = await h.db
      .selectFrom('services')
      .select('category_id')
      .where('id', '=', v.serviceId)
      .executeTakeFirstOrThrow();
    const child = await h.db
      .insertInto('categories')
      .values({
        mode: 'services',
        parent_id: service.category_id,
        slug: `test-${Date.now()}`,
        name: JSON.stringify({ en: 'Fictional', ar: 'تجريبي' }),
        enabled: false,
      })
      .returning('id')
      .executeTakeFirstOrThrow();
    await h.db
      .updateTable('services')
      .set({ category_id: child.id })
      .where('id', '=', v.serviceId)
      .execute();
    const venue = await h.http().get(`/v1/venues/${v.businessId}`).expect(200);
    expect(venue.body.services).toEqual([]);
  });
});

describe('support operations (D12)', () => {
  it('publishes the proposed hours and first-reply target', async () => {
    const res = await h.http().get('/v1/support/info').expect(200);
    expect(supportInfoSchema.parse(res.body)).toMatchObject({
      hours: { opens: '09:00', closes: '21:00', timeZone: 'Asia/Dubai' },
      firstResponseHours: 24,
    });
  });

  it('starts payment tickets high, escalates security incidents to urgent with a private reason, and records the first reply', async () => {
    const customer = await signUp(h);
    const auth = bearer(customer);
    const ticket = ticketSchema.parse(
      (
        await h
          .http()
          .post('/v1/support/tickets')
          .set('Authorization', auth)
          .send({ type: 'payment', subject: 'Charged twice', body: 'I see two charges.' })
          .expect(201)
      ).body,
    );
    expect(ticket.priority).toBe('high');
    const sup = bearer(await adminLogin(h, await provisionAdmin(h, ['support'])));
    const path = `/v1/admin/support/tickets/${ticket.id}`;
    let res = await h
      .http()
      .post(`${path}/actions`)
      .set('Authorization', sup)
      .send({ action: 'escalate', escalation: 'security', reason: 'Possible account takeover.' })
      .expect(201);
    let view = adminTicketSchema.parse(res.body);
    expect(view).toMatchObject({
      priority: 'urgent',
      escalation: 'security',
      firstResponseAt: null,
    });
    expect(view.messages.at(-1)).toMatchObject({
      internal: true,
      body: 'Escalated (security): Possible account takeover.',
    });

    const queue = await h
      .http()
      .get('/v1/admin/support/tickets?queue=escalated&limit=100')
      .set('Authorization', sup)
      .expect(200);
    expect(queue.body.items.map((t: { id: string }) => t.id)).toContain(ticket.id);

    res = await h
      .http()
      .post(`${path}/messages`)
      .set('Authorization', sup)
      .send({ body: 'We are looking into it now.' })
      .expect(201);
    view = adminTicketSchema.parse(res.body);
    expect(view.firstResponseAt).not.toBeNull();

    res = await h
      .http()
      .post(`${path}/actions`)
      .set('Authorization', sup)
      .send({ action: 'set_priority', priority: 'normal' })
      .expect(201);
    expect(res.body.priority).toBe('normal');

    // The customer never sees the escalation note.
    const mine = ticketSchema.parse(
      (
        await h
          .http()
          .get(`/v1/support/tickets/${ticket.id}`)
          .set('Authorization', auth)
          .expect(200)
      ).body,
    );
    expect(mine.messages.map((m) => m.body)).not.toContain(
      'Escalated (security): Possible account takeover.',
    );
    await h
      .http()
      .post(`${path}/actions`)
      .set('Authorization', sup)
      .send({ action: 'escalate', escalation: 'payment' })
      .expect(400);
  });

  it('attaches scanned files for the customer and support only', async () => {
    const customer = await signUp(h);
    const auth = bearer(customer);
    const ticket = ticketSchema.parse(
      (
        await h
          .http()
          .post('/v1/support/tickets')
          .set('Authorization', auth)
          .send({ type: 'order', subject: 'Damaged box', body: 'Photo attached.' })
          .expect(201)
      ).body,
    );
    const pdf = fictionalPdf('Fictional receipt');
    const upload = await h
      .http()
      .post(`/v1/support/tickets/${ticket.id}/attachments`)
      .set('Authorization', auth)
      .send({ fileName: 'receipt.pdf', contentType: 'application/pdf', sizeBytes: pdf.length })
      .expect(201);
    await putUpload(h, upload.body, pdf).expect(200);
    const done = await h
      .http()
      .post(`/v1/support/tickets/${ticket.id}/attachments/${upload.body.id}/complete`)
      .set('Authorization', auth)
      .expect(200);
    expect(ticketSchema.parse(done.body).attachments).toEqual([
      expect.objectContaining({
        fileName: 'receipt.pdf',
        author: 'customer',
        sizeBytes: pdf.length,
      }),
    ]);

    // A file that is not what it claims is refused and never listed.
    const fake = Buffer.from('not really a pdf');
    const bad = await h
      .http()
      .post(`/v1/support/tickets/${ticket.id}/attachments`)
      .set('Authorization', auth)
      .send({ fileName: 'x.pdf', contentType: 'application/pdf', sizeBytes: fake.length })
      .expect(201);
    await putUpload(h, bad.body, fake).expect(200);
    await h
      .http()
      .post(`/v1/support/tickets/${ticket.id}/attachments/${bad.body.id}/complete`)
      .set('Authorization', auth)
      .expect(422);

    const other = await signUp(h);
    await h
      .http()
      .post(`/v1/support/tickets/${ticket.id}/attachments`)
      .set('Authorization', bearer(other))
      .send({ fileName: 'y.pdf', contentType: 'application/pdf', sizeBytes: 10 })
      .expect(404);
    await h
      .http()
      .get(`/v1/support/tickets/${ticket.id}/attachments/${upload.body.id}/download`)
      .set('Authorization', bearer(other))
      .expect(404);
    const mine = await h
      .http()
      .get(`/v1/support/tickets/${ticket.id}/attachments/${upload.body.id}/download`)
      .set('Authorization', auth)
      .expect(200);
    expect(mine.body.url).toMatch(/^http/);

    const sup = bearer(await adminLogin(h, await provisionAdmin(h, ['support'])));
    await h
      .http()
      .get(`/v1/admin/support/tickets/${ticket.id}/attachments/${upload.body.id}/download`)
      .set('Authorization', sup)
      .expect(200);
    const audit = await h.db
      .selectFrom('audit_logs')
      .select('action')
      .where('target_id', '=', ticket.id)
      .execute();
    expect(audit.map((a) => a.action)).toContain('ticket.attachment_viewed');
  });
});

describe('free-tier usage (ADR-0033)', () => {
  it('shows database, files and email against the plan limits to operations admins only', async () => {
    const ops = bearer(await adminLogin(h, await provisionAdmin(h, ['operations'])));
    const usage = platformUsageSchema.parse(
      (await h.http().get('/v1/admin/operations/usage').set('Authorization', ops).expect(200)).body,
    );
    expect(usage.databaseBytes.used).toBeGreaterThan(0);
    expect(usage.databaseBytes.limit).toBe(500 * 1024 * 1024);
    expect(usage.storageBytes.limit).toBe(1024 * 1024 * 1024);
    expect(usage.emailsToday.limit).toBe(100);
    expect(usage.emailsThisMonth.limit).toBe(3000);
    expect(usage.warnAt).toBe(0.8);
    const analyst = bearer(await adminLogin(h, await provisionAdmin(h, ['analyst'])));
    await h.http().get('/v1/admin/operations/usage').set('Authorization', analyst).expect(403);
  });
});
