import { brandListSchema, categoryListSchema, categorySchema } from '@jays/contracts';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  adminLogin,
  bearer,
  type Harness,
  provisionAdmin,
  signUp,
  startHarness,
} from '../testing/harness.js';

let h: Harness;
beforeAll(async () => {
  h = await startHarness();
});
afterAll(async () => {
  await h.close();
});

const unique = () => `t${process.pid}-${Date.now()}-${Math.floor(Math.random() * 1e6)}`;

describe('category taxonomy', () => {
  it('serves the MVP tree for both modes without medical categories', async () => {
    const shop = categoryListSchema.parse(
      (await h.http().get('/v1/categories?mode=shop').expect(200)).body,
    );
    expect(shop.items.filter((c) => c.depth === 0).map((c) => c.slug)).toEqual(
      expect.arrayContaining([
        'makeup',
        'skincare',
        'haircare',
        'fragrance',
        'fashion',
        'accessories',
        'bath-body',
      ]),
    );
    const services = categoryListSchema.parse(
      (await h.http().get('/v1/categories?mode=services').expect(200)).body,
    );
    expect(services.items.every((c) => c.mode === 'services')).toBe(true);
    expect(services.items.map((c) => c.slug)).toEqual(
      expect.arrayContaining(['hair', 'nails', 'makeup', 'brows-lashes', 'spa', 'wellness']),
    );
    expect(services.items.some((c) => /medical|botox|filler/.test(c.slug))).toBe(false);
    await h.http().get('/v1/categories?mode=admin').expect(400);
  });

  it('lets catalog admins grow and archive the tree within its rules, audited', async () => {
    const admin = await adminLogin(h, await provisionAdmin(h, ['catalog']));
    const auth = bearer(admin);
    const root = categorySchema.parse(
      (
        await h
          .http()
          .post('/v1/admin/categories')
          .set('Authorization', auth)
          .send({
            mode: 'shop',
            slug: `root-${unique()}`,
            name: { en: 'Fictional root', ar: 'جذر تجريبي' },
          })
          .expect(201)
      ).body,
    );
    const child = categorySchema.parse(
      (
        await h
          .http()
          .post('/v1/admin/categories')
          .set('Authorization', auth)
          .send({
            mode: 'shop',
            parentId: root.id,
            slug: `child-${unique()}`,
            name: { en: 'Child', ar: 'فرعي' },
          })
          .expect(201)
      ).body,
    );
    expect(child.depth).toBe(1);
    const leaf = categorySchema.parse(
      (
        await h
          .http()
          .post('/v1/admin/categories')
          .set('Authorization', auth)
          .send({
            mode: 'shop',
            parentId: child.id,
            slug: `leaf-${unique()}`,
            name: { en: 'Leaf', ar: 'ورقة' },
          })
          .expect(201)
      ).body,
    );
    const tooDeep = await h
      .http()
      .post('/v1/admin/categories')
      .set('Authorization', auth)
      .send({
        mode: 'shop',
        parentId: leaf.id,
        slug: `deep-${unique()}`,
        name: { en: 'Deep', ar: 'عميق' },
      })
      .expect(422);
    expect(tooDeep.body.error.code).toBe('DEPTH_LIMIT');
    const wrongMode = await h
      .http()
      .post('/v1/admin/categories')
      .set('Authorization', auth)
      .send({
        mode: 'services',
        parentId: root.id,
        slug: `x-${unique()}`,
        name: { en: 'X', ar: 'س' },
      })
      .expect(422);
    expect(wrongMode.body.error.code).toBe('PARENT_INVALID');
    await h
      .http()
      .post('/v1/admin/categories')
      .set('Authorization', auth)
      .send({ mode: 'shop', slug: 'makeup', name: { en: 'Again', ar: 'مجددا' } })
      .expect(409);

    // Archiving goes leaf first; archived entries leave the public tree.
    const blocked = await h
      .http()
      .patch(`/v1/admin/categories/${child.id}`)
      .set('Authorization', auth)
      .send({ status: 'archived' })
      .expect(409);
    expect(blocked.body.error.code).toBe('HAS_ACTIVE_CHILDREN');
    await h
      .http()
      .patch(`/v1/admin/categories/${leaf.id}`)
      .set('Authorization', auth)
      .send({ status: 'archived' })
      .expect(200);
    await h
      .http()
      .patch(`/v1/admin/categories/${child.id}`)
      .set('Authorization', auth)
      .send({ status: 'archived', name: { en: 'Renamed child', ar: 'فرعي معدل' } })
      .expect(200);
    const visible = categoryListSchema.parse(
      (await h.http().get('/v1/categories?mode=shop').expect(200)).body,
    );
    expect(visible.items.map((c) => c.id)).toContain(root.id);
    expect(visible.items.map((c) => c.id)).not.toContain(child.id);
    const all = categoryListSchema.parse(
      (await h.http().get('/v1/admin/categories?mode=shop').set('Authorization', auth).expect(200))
        .body,
    );
    expect(all.items.find((c) => c.id === child.id)?.status).toBe('archived');

    const audit = await h.db
      .selectFrom('audit_logs')
      .select(['action', 'actor_type'])
      .where('target_id', 'in', [root.id, child.id, leaf.id])
      .execute();
    expect(audit.map((a) => a.action).sort()).toEqual([
      'category.archived',
      'category.archived',
      'category.created',
      'category.created',
      'category.created',
    ]);
  });

  it('keeps taxonomy management to catalog and superadmin roles', async () => {
    const support = await adminLogin(h, await provisionAdmin(h, ['support']));
    await h
      .http()
      .post('/v1/admin/categories')
      .set('Authorization', bearer(support))
      .send({ mode: 'shop', slug: `nope-${unique()}`, name: { en: 'No', ar: 'لا' } })
      .expect(403);
    const user = await signUp(h);
    await h.http().get('/v1/admin/categories').set('Authorization', bearer(user)).expect(401);
  });
});

describe('brands', () => {
  it('creates, lists and archives brands; only active brands are public', async () => {
    const admin = await adminLogin(h, await provisionAdmin(h, ['superadmin']));
    const slug = `brand-${unique()}`;
    const created = await h
      .http()
      .post('/v1/admin/brands')
      .set('Authorization', bearer(admin))
      .send({ slug, name: { en: 'Fictional Brand', ar: 'علامة تجريبية' } })
      .expect(201);
    await h
      .http()
      .post('/v1/admin/brands')
      .set('Authorization', bearer(admin))
      .send({ slug, name: { en: 'Duplicate', ar: 'مكرر' } })
      .expect(409);
    let publicBrands = brandListSchema.parse((await h.http().get('/v1/brands').expect(200)).body);
    expect(publicBrands.items.map((b) => b.slug)).toContain(slug);
    await h
      .http()
      .patch(`/v1/admin/brands/${created.body.id}`)
      .set('Authorization', bearer(admin))
      .send({ status: 'archived' })
      .expect(200);
    publicBrands = brandListSchema.parse((await h.http().get('/v1/brands').expect(200)).body);
    expect(publicBrands.items.map((b) => b.slug)).not.toContain(slug);
  });
});
