// Loads the staging demonstration dataset (docs/DEMO_DATA.md, ADR-0038).
//
// Everything is FICTIONAL. The data is created through the application's own API flows (in this
// process, with the mock payment provider and a capturing notifier), so orders, payments, refunds,
// ledger entries, bookings, reviews and notifications follow the real business rules. Nothing is
// sent to a real person: every address is on the reserved `.example` domain and the notifier and
// push sender are in-memory.
//
// Usage (from a trusted machine or the staging GitHub Actions workflow, never inside Vercel):
//   DATABASE_URL=... MFA_ENCRYPTION_KEY=<same as the API's> APP_ENV=staging \
//   DEMO_DATA_CONFIRM=fictional-demo-data pnpm --filter @jays/api demo:load
//
// Credentials: every demo account gets its own random password; admins also get a TOTP secret.
// They are written ONLY to DEMO_CREDENTIALS_FILE (default ./demo-credentials.json, mode 0600),
// never to the log. Keep that file out of git and in a password manager.
import { randomBytes, randomInt, randomUUID } from 'node:crypto';
import { writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import {
  bookingSchema,
  branchSchema,
  createOrderResponseSchema,
  mediaSchema,
  merchantProductSchema,
  orderSchema,
  quoteSchema,
  serviceSchema,
  sessionSchema,
  staffSchema,
  ticketSchema,
  uploadTicketSchema,
  type Session,
  type UploadTicket,
} from '@jays/contracts';
import { addDays, localDateOf, localToUtc } from '@jays/domain';
import { sql } from 'kysely';
import { z } from 'zod';
import { hashPassword, SecretBox } from '../../src/auth/crypto.js';
import { generateTotpSecret, totpAt } from '../../src/auth/totp.js';
import {
  bearer,
  createBusiness,
  type Harness,
  lastCode,
  startHarness,
} from '../../src/testing/harness.js';
import { fictionalPdf, renderPng } from '../../src/testing/png.js';
import {
  DEMO_ADMIN_ROLES,
  DEMO_BUSINESSES,
  DEMO_CUSTOMERS,
  DEMO_EMAIL_DOMAIN,
  DEMO_LABEL,
  type DemoBusiness,
  demoEmail,
  type Emirate,
  REVIEW_TEXTS,
} from './demo-data.js';

/** A supertest assertion that includes the response body when the status is wrong. */
function status(expected: number) {
  return (res: { status: number; body: unknown; req?: { method?: string; path?: string } }) => {
    if (res.status !== expected) {
      throw new Error(
        `expected ${expected}, got ${res.status} for ${res.req?.method ?? ''} ${res.req?.path ?? ''}: ${JSON.stringify(res.body)}`,
      );
    }
  };
}

const ALL_EMIRATES: Emirate[] = ['AUH', 'DXB', 'SHJ', 'AJM', 'RAK', 'FUJ', 'UAQ'];
const TZ = 'Asia/Dubai';
const CONFIRM = 'fictional-demo-data';

const env = z
  .object({
    APP_ENV: z.enum(['local', 'test', 'staging', 'production']).default('local'),
    DATABASE_URL: z.string().min(1),
    MFA_ENCRYPTION_KEY: z.string().min(32),
    DEMO_DATA_CONFIRM: z.string().optional(),
    DEMO_CREDENTIALS_FILE: z.string().default('demo-credentials.json'),
    /** Smaller dataset for CI (fewer orders and bookings), same coverage of every flow. */
    DEMO_SIZE: z.enum(['full', 'small']).default('full'),
  })
  .parse(process.env);

// --- Safety checks ---------------------------------------------------------------------------

if (env.APP_ENV === 'production') {
  console.error('Refusing: demonstration data never goes into production.');
  process.exit(1);
}
if (env.APP_ENV === 'staging' && env.DEMO_DATA_CONFIRM !== CONFIRM) {
  console.error(`Refusing: set DEMO_DATA_CONFIRM=${CONFIRM} to load fictional data into staging.`);
  process.exit(1);
}

// Each user gets a fresh random IP inside the harness; the harness also needs these for itself.
const cronSecret = randomBytes(32).toString('base64url');
const h: Harness = await startHarness({
  env: {
    MFA_ENCRYPTION_KEY: env.MFA_ENCRYPTION_KEY,
    SCHEDULERS: 'off',
    CRON_SECRET: cronSecret,
    RATE_LIMIT_STORE: process.env['REDIS_URL'] ? 'redis' : 'postgres',
    DELIVERY_PARTNER: 'none',
    // Pass storage settings through, so images land where the staging API will look for them.
    ...pick(process.env, [
      'STORAGE_PROVIDER',
      'STORAGE_BUCKET',
      'STORAGE_LOCAL_DIR',
      'STORAGE_SIGNING_SECRET',
      'SUPABASE_URL',
      'SUPABASE_SERVICE_ROLE_KEY',
      'API_PUBLIC_URL',
    ]),
  },
});

function pick(source: NodeJS.ProcessEnv, keys: string[]): Record<string, string> {
  const out: Record<string, string> = {};
  for (const key of keys) {
    const value = source[key];
    if (value) out[key] = value;
  }
  return out;
}

const marker = await h.db.selectFrom('environment_marker').select('environment').executeTakeFirst();
if (marker && marker.environment !== env.APP_ENV) {
  await h.close();
  console.error(`Refusing: this database is marked as ${marker.environment}, not ${env.APP_ENV}.`);
  process.exit(1);
}
if (!marker && env.APP_ENV === 'staging') {
  await h.db.insertInto('environment_marker').values({ environment: 'staging' }).execute();
}
// Any demo account, even from a run that stopped half-way, means the database must be reset first.
const already = await h.db
  .selectFrom('admin_accounts')
  .select('id')
  .where('email', 'like', `%@${DEMO_EMAIL_DOMAIN}`)
  .union(h.db.selectFrom('users').select('id').where('email', 'like', `%@${DEMO_EMAIL_DOMAIN}`))
  .executeTakeFirst();
if (already) {
  await h.close();
  console.error('Refusing: demonstration accounts already exist. Reset the database to reload.');
  process.exit(1);
}

// --- Small helpers ---------------------------------------------------------------------------

const small = env.DEMO_SIZE === 'small';
const credentials: Record<string, unknown>[] = [];
const newPassword = () => `${randomBytes(15).toString('base64url')}-Aa1`;
const pickOne = <T>(items: readonly T[]): T => items[randomInt(items.length)] as T;
const json = (body: unknown) => body as Record<string, unknown>;
let step = 0;
const log = (message: string) =>
  console.log(`[demo ${String(++step).padStart(3, '0')}] ${message}`);

interface Account {
  key: string;
  email: string;
  password: string;
  session: Session;
  at: number;
}

/** Signs up through the real registration flow (the code comes from the in-memory notifier). */
async function signUpAccount(
  key: string,
  email: string,
  name: string,
  locale: 'en' | 'ar',
  role: string,
): Promise<Account> {
  const password = newPassword();
  const reg = await h
    .http()
    .post('/v1/auth/register')
    .send({ email, password, acceptTerms: true })
    .expect(status(202));
  const res = await h
    .http()
    .post('/v1/auth/verify')
    .send({ challengeId: reg.body.challengeId, code: lastCode(h, email) })
    .expect(status(200));
  const session = sessionSchema.parse(res.body);
  await h.db
    .updateTable('users')
    .set({ display_name: name, locale })
    .where('id', '=', session.user.id)
    .execute();
  credentials.push({
    role,
    key,
    email,
    password,
    signIn: role.startsWith('customer') ? 'customer app' : 'business portal',
  });
  return { key, email, password, session, at: Date.now() };
}

/** A fresh access token when the current one is older than 10 minutes. */
async function auth(a: Account): Promise<string> {
  if (Date.now() - a.at > 10 * 60_000) {
    const res = await h
      .http()
      .post('/v1/auth/login')
      .send({ email: a.email, password: a.password })
      .expect(status(200));
    a.session = sessionSchema.parse(res.body);
    a.at = Date.now();
  }
  return bearer(a.session);
}

/** PUTs bytes to a signed upload URL: the local storage route, or Supabase directly. */
async function upload(ticket: UploadTicket, bytes: Buffer): Promise<void> {
  const url = new URL(ticket.uploadUrl);
  const local = url.pathname.startsWith('/v1/storage/');
  if (local) {
    await h
      .http()
      .put(url.pathname + url.search)
      .set('Content-Type', ticket.headers['content-type'] ?? 'application/octet-stream')
      .send(bytes)
      .expect(status(200));
  } else {
    const res = await fetch(ticket.uploadUrl, {
      method: 'PUT',
      headers: ticket.headers,
      body: bytes,
    });
    if (!res.ok) throw new Error(`upload failed: ${res.status}`);
  }
}

type Rgb = [number, number, number];
const shade = (c: Rgb, d: number): Rgb => c.map((x) => Math.max(0, Math.min(255, x + d))) as Rgb;

// --- Admins ----------------------------------------------------------------------------------

const box = new SecretBox(env.MFA_ENCRYPTION_KEY);
const admins = new Map<
  string,
  { email: string; password: string; secret: string; token?: string; at: number }
>();
for (const role of DEMO_ADMIN_ROLES) {
  const email = demoEmail(`admin.${role}`);
  const password = newPassword();
  const secret = generateTotpSecret();
  const row = await h.db
    .insertInto('admin_accounts')
    .values({
      email,
      display_name: `Demo ${role} admin`,
      password_hash: await hashPassword(password),
      status: 'active',
      mfa_secret_enc: box.seal(secret),
      mfa_enabled_at: new Date(),
    })
    .returning('id')
    .executeTakeFirstOrThrow();
  await h.db.insertInto('admin_roles').values({ admin_id: row.id, role }).execute();
  admins.set(role, { email, password, secret, at: 0 });
  credentials.push({
    role: `admin:${role}`,
    email,
    password,
    totpSecret: secret,
    otpauth: `otpauth://totp/JAYS%20Staging:${encodeURIComponent(email)}?secret=${secret}&issuer=JAYS%20Staging`,
    signIn: 'admin console',
  });
}
log(`created ${admins.size} admin accounts (one per role)`);

async function adminAuth(role: (typeof DEMO_ADMIN_ROLES)[number]): Promise<string> {
  const a = admins.get(role);
  if (!a) throw new Error(role);
  if (!a.token || Date.now() - a.at > 10 * 60_000) {
    h.clock.advance(30); // each TOTP step can be used once
    const res = await h
      .http()
      .post('/v1/admin/auth/login')
      .send({ email: a.email, password: a.password, totpCode: totpAt(a.secret, h.clock.now()) })
      .expect(status(200));
    a.token = `Bearer ${res.body.tokens.accessToken as string}`;
    a.at = Date.now();
  }
  return a.token;
}

// --- Businesses ------------------------------------------------------------------------------

interface Built {
  def: DemoBusiness;
  owner: Account;
  businessId: string;
  variants: { variantId: string; priceFils: number; stock: number }[];
  branches: { id: string; emirate: Emirate; area: string; open: string; close: string }[];
  services: {
    id: string;
    branchIds: string[];
    durationMin: number;
    home: boolean;
    addonIds: string[];
  }[];
  staff: { id: string; branchIds: string[] }[];
}

const categoryIds = new Map<string, string>();
for (const row of await h.db.selectFrom('categories').select(['id', 'mode', 'slug']).execute()) {
  categoryIds.set(`${row.mode}:${row.slug}`, row.id);
}
const category = (mode: 'shop' | 'services', slug: string) => {
  const id = categoryIds.get(`${mode}:${slug}`);
  if (!id) throw new Error(`unknown category ${mode}:${slug}`);
  return id;
};

async function storefrontImage(
  b: Built,
  purpose: 'storefront_logo' | 'storefront_banner',
): Promise<string> {
  const [w, hgt] = purpose === 'storefront_logo' ? [400, 400] : [1500, 500];
  const png = renderPng(w, hgt, {
    from: b.def.colors.from,
    to: b.def.colors.to,
    ...(purpose === 'storefront_logo' ? { disc: shade(b.def.colors.from, -40) } : {}),
  });
  const ticket = uploadTicketSchema.parse(
    (
      await h
        .http()
        .post(`/v1/businesses/${b.businessId}/media`)
        .set('Authorization', await auth(b.owner))
        .send({ purpose, contentType: 'image/png', sizeBytes: png.length })
        .expect(status(201))
    ).body,
  );
  await upload(ticket, png);
  const media = mediaSchema.parse(
    (
      await h
        .http()
        .post(`/v1/businesses/${b.businessId}/media/${ticket.id}/complete`)
        .set('Authorization', await auth(b.owner))
        .expect(status(200))
    ).body,
  );
  return media.id;
}

async function buildBusiness(def: DemoBusiness): Promise<Built> {
  const owner = await signUpAccount(
    `owner.${def.key}`,
    demoEmail(`owner.${def.key}`),
    def.ownerName,
    'en',
    def.shop && def.services
      ? 'business:hybrid'
      : def.shop
        ? 'business:products'
        : 'business:services',
  );
  const modes: ('shop' | 'services')[] = [
    ...(def.shop ? (['shop'] as const) : []),
    ...(def.services ? (['services'] as const) : []),
  ];
  const business = await createBusiness(h, owner.session, modes, def.name);
  const b: Built = {
    def,
    owner,
    businessId: business.id,
    variants: [],
    branches: [],
    services: [],
    staff: [],
  };
  const ownerAuth = await auth(owner);
  const base = `/v1/businesses/${b.businessId}`;

  // A clearly fictional trade licence, through the real (scanned) document upload.
  const pdf = fictionalPdf(`FICTIONAL DEMO trade licence for ${def.name.en}. Not a real document.`);
  const doc = uploadTicketSchema.parse(
    (
      await h
        .http()
        .post(`${base}/documents`)
        .set('Authorization', ownerAuth)
        .send({
          kind: 'trade_license',
          fileName: `demo-licence-${def.key}.pdf`,
          contentType: 'application/pdf',
          sizeBytes: pdf.length,
        })
        .expect(status(201))
    ).body,
  );
  await upload(doc, pdf);
  await h
    .http()
    .post(`${base}/documents/${doc.id}/complete`)
    .set('Authorization', ownerAuth)
    .expect(status(200));
  const logo = await storefrontImage(b, 'storefront_logo');
  const banner = await storefrontImage(b, 'storefront_banner');

  // Approval is recorded directly, as the onboarding tests' fixtures do (the review flow itself is
  // demonstrated by the businesses left in the review queue below).
  const now = new Date();
  const compliance = await h.db
    .selectFrom('admin_accounts')
    .select('id')
    .where('email', '=', demoEmail('admin.compliance'))
    .executeTakeFirstOrThrow();
  await h.db
    .updateTable('businesses')
    .set({
      status: 'approved',
      legal_name: `${def.name.en} (Demo) LLC`,
      tax_registered: false,
      trade_license_number: `DEMO-${def.key.toUpperCase()}`,
      license_authority: 'Fictional Licensing Authority (demo data)',
      license_expiry: '2099-12-31',
      address_emirate_code: def.emirate,
      address_area: def.area,
      address_street: 'Fictional Street',
      address_building: 'Demo Building',
      agreement_version: 'merchant-draft-2026-11',
      agreement_accepted_at: now,
      agreement_accepted_by: owner.session.user.id,
      submitted_at: now,
      reviewed_at: now,
      reviewed_by: compliance.id,
    })
    .where('id', '=', b.businessId)
    .execute();
  await h.db
    .updateTable('business_modes')
    .set({ status: 'active', submitted_at: now, reviewed_at: now })
    .where('business_id', '=', b.businessId)
    .execute();
  const name = JSON.stringify(def.name);
  const description = JSON.stringify({
    en: `${DEMO_LABEL.en}${def.tagline.en}`,
    ar: `${DEMO_LABEL.ar}${def.tagline.ar}`,
  });
  await h.db
    .insertInto('storefronts')
    .values({
      business_id: b.businessId,
      name,
      description,
      logo_media_id: logo,
      banner_media_id: banner,
      live_name: name,
      live_description: description,
      live_logo_media_id: logo,
      live_banner_media_id: banner,
      published_at: now,
    })
    .onConflict((oc) =>
      oc.column('business_id').doUpdateSet({
        name,
        description,
        logo_media_id: logo,
        banner_media_id: banner,
        live_name: name,
        live_description: description,
        live_logo_media_id: logo,
        live_banner_media_id: banner,
        published_at: now,
      }),
    )
    .execute();

  if (def.shop) await buildShop(b);
  if (def.services) await buildServices(b);
  return b;
}

async function buildShop(b: Built): Promise<void> {
  const shop = b.def.shop;
  if (!shop) return;
  const base = `/v1/businesses/${b.businessId}`;
  await h
    .http()
    .put(`${base}/delivery-zones`)
    .set('Authorization', await auth(b.owner))
    .send({
      zones: ALL_EMIRATES.map((emirate) => ({
        emirate,
        feeFils: emirate === b.def.emirate ? 1_500 : 2_500,
        freeOverFils: 25_000,
        minDays: emirate === b.def.emirate ? 1 : 2,
        maxDays: emirate === b.def.emirate ? 2 : 4,
      })),
    })
    .expect(status(200));
  const catalog = await adminAuth('catalog');
  for (const [index, product] of shop.products.entries()) {
    const png = renderPng(800, 800, {
      from: shade(b.def.colors.from, index * 12),
      to: shade(b.def.colors.to, -index * 8),
      disc: shade(b.def.colors.to, 30),
    });
    const ticket = uploadTicketSchema.parse(
      (
        await h
          .http()
          .post(`${base}/product-images`)
          .set('Authorization', await auth(b.owner))
          .send({ contentType: 'image/png', sizeBytes: png.length })
          .expect(status(201))
      ).body,
    );
    await upload(ticket, png);
    await h
      .http()
      .post(`${base}/product-images/${ticket.id}/complete`)
      .set('Authorization', await auth(b.owner))
      .expect(status(200));
    const created = merchantProductSchema.parse(
      (
        await h
          .http()
          .post(`${base}/products`)
          .set('Authorization', await auth(b.owner))
          .send({
            categoryId: category('shop', shop.category),
            title: product.title,
            description: {
              en: `${product.description.en} (Fictional demo product.)`,
              ar: `${product.description.ar} (منتج تجريبي وهمي.)`,
            },
            returnEligible: product.returnEligible ?? true,
            mediaIds: [ticket.id],
            variants: product.variants.map((variant, i) => ({
              sku: `DEMO-${b.def.key}-${index + 1}-${i + 1}`.toUpperCase(),
              name: variant.name,
              priceFils: variant.priceFils,
              compareAtFils: variant.compareAtFils ?? null,
              taxClass: 'standard',
              lowStockThreshold: 5,
            })),
          })
          .expect(status(201))
      ).body,
    );
    await h
      .http()
      .post(`${base}/products/${created.id}/submit`)
      .set('Authorization', await auth(b.owner))
      .expect(status(200));
    const { version } = await productVersion(created.id);
    await h
      .http()
      .post(`/v1/admin/products/${created.id}/actions`)
      .set('Authorization', catalog)
      .send({ action: 'approve', expectedVersion: version })
      .expect(status(200));
    for (const [i, variant] of product.variants.entries()) {
      const variantId = created.variants[i]?.id as string;
      if (variant.stock > 0) {
        await h
          .http()
          .post(`${base}/inventory/adjust`)
          .set('Authorization', await auth(b.owner))
          .set('Idempotency-Key', `demo-stock-${randomUUID()}`)
          .send({ variantId, delta: variant.stock, reason: 'initial_stock' })
          .expect(status(200));
      }
      b.variants.push({ variantId, priceFils: variant.priceFils, stock: variant.stock });
    }
  }
}

const ALL_WEEK = (start: string, end: string) =>
  [0, 1, 2, 3, 4, 5, 6].map((weekday) => ({ weekday, start, end }));

async function buildServices(b: Built): Promise<void> {
  const svc = b.def.services;
  if (!svc) return;
  const base = `/v1/businesses/${b.businessId}`;
  for (const branch of svc.branches) {
    const created = branchSchema.parse(
      (
        await h
          .http()
          .post(`${base}/branches`)
          .set('Authorization', await auth(b.owner))
          .send({
            name: branch.name,
            emirate: branch.emirate,
            area: branch.area,
            street: 'Fictional Street',
            building: 'Demo Building',
            hours: ALL_WEEK(branch.open, branch.close),
          })
          .expect(status(201))
      ).body,
    );
    b.branches.push({ id: created.id, ...branch });
  }
  const branchIds = b.branches.map((x) => x.id);

  // Home visits need a licence reviewed by compliance (D9).
  let homeApproved = false;
  if (svc.home) {
    const pdf = fictionalPdf(`FICTIONAL DEMO home-service licence for ${b.def.name.en}.`);
    const doc = uploadTicketSchema.parse(
      (
        await h
          .http()
          .post(`${base}/documents`)
          .set('Authorization', await auth(b.owner))
          .send({
            kind: 'home_service_license',
            fileName: 'demo-home-licence.pdf',
            contentType: 'application/pdf',
            sizeBytes: pdf.length,
          })
          .expect(status(201))
      ).body,
    );
    await upload(doc, pdf);
    await h
      .http()
      .post(`${base}/documents/${doc.id}/complete`)
      .set('Authorization', await auth(b.owner))
      .expect(status(200));
    await h
      .http()
      .put(`${base}/home-services`)
      .set('Authorization', await auth(b.owner))
      .send({
        licenseNumber: `DEMO-HS-${b.def.key.toUpperCase()}`,
        licenseAuthority: 'Fictional Licensing Authority (demo data)',
        licenseExpiry: '2099-12-31',
        licenseDocumentId: doc.id,
        travelBufferMin: 30,
        minOrderFils: 15_000,
        areas: svc.home.areas,
      })
      .expect(status(200));
    const submitted = await h
      .http()
      .post(`${base}/home-services/submit`)
      .set('Authorization', await auth(b.owner))
      .expect(status(200));
    await h
      .http()
      .post(`/v1/admin/home-services/${b.businessId}/decision`)
      .set('Authorization', await adminAuth('compliance'))
      .send({ decision: 'approve', expectedVersion: json(submitted.body)['version'] })
      .expect(status(200));
    homeApproved = true;
  }

  for (const service of svc.services) {
    const created = serviceSchema.parse(
      (
        await h
          .http()
          .post(`${base}/services`)
          .set('Authorization', await auth(b.owner))
          .send({
            categoryId: category('services', service.category),
            title: service.title,
            description: service.description,
            priceFils: service.priceFils,
            durationMin: service.durationMin,
            bufferBeforeMin: 0,
            bufferAfterMin: service.bufferAfterMin ?? 10,
            cancelCutoffHours: service.cancelCutoffHours ?? 24,
            lateCancelRefundBps: service.lateCancelRefundBps ?? 5_000,
            branchIds,
            ...(service.home && homeApproved ? { locationMode: 'both' } : {}),
          })
          .expect(status(201))
      ).body,
    );
    const addonIds: string[] = [];
    for (const [i, addon] of (service.addons ?? []).entries()) {
      const res = await h
        .http()
        .post(`${base}/services/${created.id}/addons`)
        .set('Authorization', await auth(b.owner))
        .send({
          title: addon.name,
          priceFils: addon.priceFils,
          durationMin: addon.durationMin,
          sortOrder: i,
        })
        .expect(status(201));
      addonIds.push(json(res.body)['id'] as string);
    }
    b.services.push({
      id: created.id,
      branchIds,
      durationMin: service.durationMin,
      home: !!service.home && homeApproved,
      addonIds,
    });
  }

  for (const [i, person] of svc.staff.entries()) {
    // Staff spread across branches; everyone offers every service.
    const branch = b.branches[i % b.branches.length] as Built['branches'][number];
    const created = staffSchema.parse(
      (
        await h
          .http()
          .post(`${base}/staff`)
          .set('Authorization', await auth(b.owner))
          .send({
            displayName: `${person.name} (${person.title})`,
            branchIds: [branch.id],
            serviceIds: b.services.map((x) => x.id),
          })
          .expect(status(201))
      ).body,
    );
    // Five working days each, rotating days off, within the branch's hours.
    const off = [i % 7, (i + 3) % 7];
    await h
      .http()
      .put(`${base}/staff/${created.id}/shifts`)
      .set('Authorization', await auth(b.owner))
      .send({
        shifts: ALL_WEEK(branch.open, branch.close)
          .filter((s) => !off.includes(s.weekday))
          .map((s) => ({ ...s, branchId: branch.id })),
      })
      .expect(status(200));
    b.staff.push({ id: created.id, branchIds: [branch.id] });
  }
}

// The admin catalog action needs the product's version after submission.
function productVersion(productId: string) {
  return h.db
    .selectFrom('products')
    .select('version')
    .where('id', '=', productId)
    .executeTakeFirstOrThrow();
}

// Empties a customer's active cart so the next order starts clean.
async function clearCart(userId: string) {
  await h.db
    .deleteFrom('cart_items')
    .where('cart_id', 'in', h.db.selectFrom('carts').select('id').where('user_id', '=', userId))
    .execute();
}

const built: Built[] = [];
for (const def of DEMO_BUSINESSES) {
  built.push(await buildBusiness(def));
  log(`business ready: ${def.name.en}`);
}

// Businesses in the review queue, so compliance admins have something to review.
for (const [key, name, status] of [
  [
    'pending-bloom',
    { en: 'Bloom Bar Florist Beauty (pending review)', ar: 'بلوم بار (قيد المراجعة)' },
    'submitted',
  ],
  ['draft-henna', { en: 'Henna House (draft)', ar: 'بيت الحناء (مسودة)' }, 'draft'],
] as const) {
  const owner = await signUpAccount(
    `owner.${key}`,
    demoEmail(`owner.${key}`),
    'Demo Owner',
    'en',
    'business:onboarding',
  );
  const business = await createBusiness(h, owner.session, ['shop'], name);
  if (status === 'submitted') {
    const now = new Date();
    await h.db
      .updateTable('businesses')
      .set({
        status: 'submitted',
        legal_name: `${name.en} (Demo) LLC`,
        trade_license_number: `DEMO-${key.toUpperCase()}`,
        license_authority: 'Fictional Licensing Authority (demo data)',
        license_expiry: '2099-12-31',
        address_emirate_code: 'AUH',
        address_area: 'Al Zahiyah',
        address_street: 'Fictional Street',
        address_building: 'Demo Building',
        agreement_version: 'merchant-draft-2026-11',
        agreement_accepted_at: now,
        agreement_accepted_by: owner.session.user.id,
        submitted_at: now,
      })
      .where('id', '=', business.id)
      .execute();
    await h.db
      .updateTable('business_modes')
      .set({ status: 'pending_review', submitted_at: now })
      .where('business_id', '=', business.id)
      .execute();
  }
}
log('review-queue businesses added');

// --- Customers -------------------------------------------------------------------------------

const customers: (Account & { addressId: string; emirate: Emirate })[] = [];
for (const c of DEMO_CUSTOMERS) {
  const account = await signUpAccount(c.key, demoEmail(c.key), c.name, c.locale, 'customer');
  const res = await h
    .http()
    .post('/v1/me/addresses')
    .set('Authorization', await auth(account))
    .send({
      emirate: c.emirate,
      area: c.area,
      street: 'Fictional Street 12',
      building: 'Demo Villa 3',
    })
    .expect(status(201));
  customers.push({ ...account, addressId: json(res.body)['id'] as string, emirate: c.emirate });
}
log(`created ${customers.length} customers with addresses`);

// --- Orders, fulfilment, returns, refunds and product reviews -------------------------------

const shops = built.filter((b) => b.variants.some((x) => x.stock > 2));
const counts = {
  orders: 0,
  failedPayments: 0,
  delivered: 0,
  shipped: 0,
  cancelled: 0,
  returns: 0,
  reviews: 0,
  bookings: 0,
  completed: 0,
  noShows: 0,
  cancelledBookings: 0,
  tickets: 0,
};
const deliveredOrders: {
  customer: (typeof customers)[number];
  orderId: string;
  mo: { id: string; businessId: string; items: { id: string }[] };
  shop: Built;
}[] = [];

async function fulfil(shop: Built, moId: string, body: Record<string, unknown>) {
  await h
    .http()
    .post(`/v1/businesses/${shop.businessId}/orders/${moId}/fulfillment`)
    .set('Authorization', await auth(shop.owner))
    .send(body)
    .expect(status(201));
}

const orderTarget = small ? 12 : 70;
for (let n = 0; n < orderTarget; n += 1) {
  const customer = pickOne(customers);
  const shop = pickOne(shops);
  const inStock = shop.variants.filter((x) => x.stock > 2);
  const lines = new Set([pickOne(inStock), ...(randomInt(3) === 0 ? [pickOne(inStock)] : [])]);
  try {
    for (const line of lines) {
      await h
        .http()
        .put(`/v1/cart/items/${line.variantId}`)
        .set('Authorization', await auth(customer))
        .send({ qty: randomInt(4) === 0 ? 2 : 1 })
        .expect(status(200));
      line.stock -= 2;
    }
    const quote = quoteSchema.parse(
      (
        await h
          .http()
          .post('/v1/checkout/quote')
          .set('Authorization', await auth(customer))
          .send({ addressId: customer.addressId })
          .expect(status(201))
      ).body,
    );
    const order = createOrderResponseSchema.parse(
      (
        await h
          .http()
          .post('/v1/orders')
          .set('Authorization', await auth(customer))
          .set('Idempotency-Key', `demo-order-${randomUUID()}`)
          .send({ quoteId: quote.quoteId })
          .expect(status(201))
      ).body,
    );
    const fail = n % 12 === 5; // about 8% declined test payments
    await h
      .http()
      .post(`/v1/mock-psp/intents/${order.paymentIntentId}/confirm`)
      .send({ clientSecret: order.paymentClientSecret, outcome: fail ? 'fail' : 'success' })
      .expect(status(200));
    await h.deliverWebhooks();
    counts.orders += 1;
    if (fail) {
      counts.failedPayments += 1;
      // Clear the cart so the next order starts empty.
      await clearCart(customer.session.user.id);
      continue;
    }
    const view = orderSchema.parse(
      (
        await h
          .http()
          .get(`/v1/orders/${order.orderId}`)
          .set('Authorization', await auth(customer))
          .expect(status(200))
      ).body,
    );
    for (const mo of view.merchants) {
      const seller = built.find((b) => b.businessId === mo.store.id) ?? shop;
      const roll = randomInt(100);
      if (roll < 12) {
        continue; // paid, waiting for the merchant
      }
      if (roll < 18) {
        await fulfil(seller, mo.id, {
          action: 'cancel',
          expectedStatus: 'paid',
          reason: 'Item damaged in the warehouse (demo).',
        });
        counts.cancelled += 1;
        continue;
      }
      await fulfil(seller, mo.id, { action: 'process', expectedStatus: 'paid' });
      if (roll < 28) continue; // processing
      await fulfil(seller, mo.id, {
        action: 'ship',
        expectedStatus: 'processing',
        carrier: 'Fictional Express (demo)',
        trackingNumber: `DEMO${randomInt(1e6, 9e6)}`,
      });
      if (roll < 40) {
        counts.shipped += 1;
        continue;
      }
      await fulfil(seller, mo.id, { action: 'deliver', expectedStatus: 'shipped' });
      counts.delivered += 1;
      deliveredOrders.push({
        customer,
        orderId: order.orderId,
        mo: { id: mo.id, businessId: mo.store.id, items: mo.items.map((i) => ({ id: i.id })) },
        shop: seller,
      });
    }
    await h.deliverWebhooks();
  } catch (error) {
    // A line went out of stock between picks: skip this order, keep going.
    await clearCart(customer.session.user.id);
    if (!(error instanceof Error && /expected (201|200)/.test(error.message))) throw error;
  }
}
log(`orders: ${JSON.stringify(counts)}`);

// Returns: approved and refunded (partial refunds), and one rejected.
for (const [i, o] of deliveredOrders.slice(0, small ? 2 : 8).entries()) {
  const item = o.mo.items[0];
  if (!item) continue;
  const res = await h
    .http()
    .post(`/v1/orders/${o.orderId}/returns`)
    .set('Authorization', await auth(o.customer))
    .send({
      merchantOrderId: o.mo.id,
      items: [{ orderItemId: item.id, qty: 1 }],
      reason: i % 2 ? 'Wrong shade (demo)' : 'Changed my mind (demo)',
    });
  if (res.status !== 201) continue; // the product may not be returnable
  const base = `/v1/businesses/${o.shop.businessId}/returns/${json(res.body)['id'] as string}/actions`;
  if (i === 3) {
    await h
      .http()
      .post(base)
      .set('Authorization', await auth(o.shop.owner))
      .send({ action: 'reject', reason: 'Item was used (demo).' })
      .expect(status(201));
  } else if (i % 4 !== 1) {
    await h
      .http()
      .post(base)
      .set('Authorization', await auth(o.shop.owner))
      .send({ action: 'approve' })
      .expect(status(201));
    if (i % 4 !== 2) {
      await h
        .http()
        .post(base)
        .set('Authorization', await auth(o.shop.owner))
        .send({ action: 'receive' })
        .expect(status(201));
    }
  }
  counts.returns += 1;
}
await h.deliverWebhooks();
log(`returns created: ${counts.returns}`);

// Product reviews on most delivered items, with some merchant replies.
for (const o of deliveredOrders) {
  if (randomInt(10) < 3) continue;
  const item = o.mo.items[0];
  if (!item) continue;
  const text = pickOne(REVIEW_TEXTS);
  const res = await h
    .http()
    .post('/v1/reviews')
    .set('Authorization', await auth(o.customer))
    .send({ orderItemId: item.id, rating: text.rating, body: text.en });
  if (res.status !== 201) continue;
  counts.reviews += 1;
  if (text.rating <= 3 || randomInt(3) === 0) {
    await h
      .http()
      .post(`/v1/businesses/${o.shop.businessId}/reviews/${json(res.body)['id'] as string}/replies`)
      .set('Authorization', await auth(o.shop.owner))
      .send({ body: 'Thank you for the feedback. We have shared it with our team. (demo reply)' });
  }
}
log(`product reviews: ${counts.reviews}`);

// --- Bookings: upcoming calendars, completed history, no-shows, cancellations ----------------

const venues = built.filter((b) => b.services.length > 0 && b.staff.length > 0);
const today = localDateOf(h.clock.now(), TZ);
const slotAt = (dayOffset: number, minutes: number) =>
  localToUtc(addDays(today, dayOffset), minutes, TZ).toISOString();

async function book(
  venue: Built,
  customer: (typeof customers)[number],
  dayOffset: number,
  minutes: number,
): Promise<{ id: string } | null> {
  const service = pickOne(venue.services);
  const staff =
    venue.staff.find((s) => service.branchIds.includes(s.branchIds[0] as string)) ??
    pickOne(venue.staff);
  const home = service.home && randomInt(3) === 0 && customer.emirate === venue.def.emirate;
  const res = await h
    .http()
    .post('/v1/bookings/hold')
    .set('Authorization', await auth(customer))
    .set('Idempotency-Key', `demo-hold-${randomUUID()}`)
    .send({
      branchId: staff.branchIds[0],
      serviceId: service.id,
      staffId: staff.id,
      startAt: slotAt(dayOffset, minutes),
      location: home ? 'home' : 'venue',
      ...(home ? { addressId: customer.addressId } : {}),
      addonIds: service.addonIds.length && randomInt(2) === 0 ? [service.addonIds[0]] : [],
    });
  if (res.status !== 201) return null; // slot unavailable (day off, overlap, outside coverage)
  const booking = bookingSchema.parse(res.body);
  const pay = await h
    .http()
    .post(`/v1/bookings/${booking.id}/pay`)
    .set('Authorization', await auth(customer))
    .expect(status(200));
  await h
    .http()
    .post(`/v1/mock-psp/intents/${json(pay.body)['paymentIntentId'] as string}/confirm`)
    .send({ clientSecret: json(pay.body)['paymentClientSecret'], outcome: 'success' })
    .expect(status(200));
  await h.deliverWebhooks();
  counts.bookings += 1;
  return { id: booking.id };
}

const perVenue = small ? 3 : 10;
const past: { venue: Built; customer: (typeof customers)[number]; id: string }[] = [];
for (const venue of venues) {
  // Upcoming: the next 14 days.
  for (let i = 0; i < perVenue; i += 1) {
    const customer = pickOne(customers);
    const booked = await book(venue, customer, 1 + randomInt(14), (11 + randomInt(7)) * 60);
    if (booked && i % 5 === 2) {
      const cancelled = await h
        .http()
        .post(`/v1/bookings/${booked.id}/cancel`)
        .set('Authorization', await auth(customer))
        .send({ reason: 'Plans changed (demo).' });
      if (cancelled.status === 200) counts.cancelledBookings += 1;
    }
  }
  // History: booked into days 15-28, then moved back 28 days (as the booking tests do) and closed
  // through the business's own check-in / complete / no-show actions.
  for (let i = 0; i < perVenue; i += 1) {
    const customer = pickOne(customers);
    const booked = await book(venue, customer, 15 + randomInt(14), (11 + randomInt(7)) * 60);
    if (booked) past.push({ venue, customer, id: booked.id });
  }
}
// Move all history bookings back together, so they keep the non-overlap they were booked with.
const shiftMs = 28 * 24 * 3600 * 1000;
await sql`
  UPDATE bookings SET start_at = start_at - ${`${shiftMs} milliseconds`}::interval,
                      end_at = end_at - ${`${shiftMs} milliseconds`}::interval,
                      occupied_start = occupied_start - ${`${shiftMs} milliseconds`}::interval,
                      occupied_end = occupied_end - ${`${shiftMs} milliseconds`}::interval
  WHERE id = ANY(${past.map((p) => p.id)}::uuid[])`.execute(h.db);
for (const [i, p] of past.entries()) {
  const base = `/v1/businesses/${p.venue.businessId}/bookings/${p.id}/actions`;
  const version = async () =>
    (
      await h.db
        .selectFrom('bookings')
        .select('version')
        .where('id', '=', p.id)
        .executeTakeFirstOrThrow()
    ).version;
  if (i % 9 === 4) {
    const res = await h
      .http()
      .post(base)
      .set('Authorization', await auth(p.venue.owner))
      .send({ action: 'no_show', expectedVersion: await version() });
    if (res.status < 300) counts.noShows += 1;
    continue;
  }
  const checkIn = await h
    .http()
    .post(base)
    .set('Authorization', await auth(p.venue.owner))
    .send({ action: 'check_in', expectedVersion: await version() });
  if (checkIn.status >= 300) continue;
  const done = await h
    .http()
    .post(base)
    .set('Authorization', await auth(p.venue.owner))
    .send({ action: 'complete', expectedVersion: await version() });
  if (done.status >= 300) continue;
  counts.completed += 1;
  if (randomInt(10) < 7) {
    const text = pickOne(REVIEW_TEXTS);
    const res = await h
      .http()
      .post('/v1/reviews')
      .set('Authorization', await auth(p.customer))
      .send({ bookingId: p.id, rating: text.rating, body: text.en });
    if (res.status === 201) counts.reviews += 1;
  }
}
await h.deliverWebhooks();
log(
  `bookings: ${counts.bookings} (completed ${counts.completed}, no-shows ${counts.noShows}, cancelled ${counts.cancelledBookings})`,
);

// --- Support tickets -------------------------------------------------------------------------

const supportAuth = await adminAuth('support');
const ticketSubjects = [
  ['order', 'Where is my order?', 'The tracking has not updated for two days.'],
  ['payment', 'Charged twice?', 'I see two pending amounts on my card for one order.'],
  [
    'booking',
    'Can I change my stylist?',
    'I would like a different professional for my appointment.',
  ],
  ['account', 'Change my email address', 'I would like to use a different email for my account.'],
  ['other', 'Gift wrapping', 'Do shops offer gift wrapping for orders?'],
] as const;
for (let i = 0; i < (small ? 3 : 12); i += 1) {
  const [type, subject, body] = ticketSubjects[
    i % ticketSubjects.length
  ] as (typeof ticketSubjects)[number];
  const o = deliveredOrders[i % Math.max(1, deliveredOrders.length)];
  const customer = type === 'order' && o ? o.customer : pickOne(customers);
  const res = await h
    .http()
    .post('/v1/support/tickets')
    .set('Authorization', await auth(customer))
    .send({
      type,
      subject: `${subject} (demo)`,
      body,
      ...(type === 'order' && o ? { orderId: o.orderId } : {}),
    });
  if (res.status !== 201) continue;
  counts.tickets += 1;
  const ticket = ticketSchema.parse(res.body);
  const path = `/v1/admin/support/tickets/${ticket.id}`;
  if (i % 3 === 2) continue; // left open for the support queue
  await h
    .http()
    .post(`${path}/actions`)
    .set('Authorization', supportAuth)
    .send({ action: 'assign_to_me' });
  await h.http().post(`${path}/messages`).set('Authorization', supportAuth).send({
    body: 'Thank you for contacting us. We are looking into this for you. (demo reply)',
    internal: false,
  });
  if (i % 3 === 0)
    await h
      .http()
      .post(`${path}/actions`)
      .set('Authorization', supportAuth)
      .send({ action: 'resolve' });
}
log(`support tickets: ${counts.tickets}`);

// --- Notifications: process the outbox in-process (mock email and push only) -----------------

for (let round = 0; round < 40; round += 1) {
  const pending = await h.db
    .selectFrom('outbox')
    .select('id')
    .where('status', '=', 'pending')
    .executeTakeFirst();
  if (!pending) break;
  await h.http().get('/v1/internal/cron/minute').set('Authorization', `Bearer ${cronSecret}`);
}
// Anything still pending (for example events with no template) must never reach real email.
await h.db
  .updateTable('outbox')
  .set({ status: 'sent', last_error: 'demo data: not sent' })
  .where('status', 'in', ['pending', 'processing'])
  .execute();
log('notifications processed in-process (no real email or push)');

// --- Mark everything as demonstration data ---------------------------------------------------

await h.db
  .updateTable('users')
  .set({ is_demo: true })
  .where('email', 'like', `%@${DEMO_EMAIL_DOMAIN}`)
  .execute();
await sql`
  UPDATE businesses SET is_demo = true
  WHERE id IN (SELECT bm.business_id FROM memberships bm JOIN users u ON u.id = bm.user_id WHERE u.is_demo)`.execute(
  h.db,
);
const marked = await h.db
  .selectFrom('businesses')
  .select(sql<number>`count(*)`.as('n'))
  .where('is_demo', '=', true)
  .executeTakeFirstOrThrow();
log(`marked ${Number(marked.n)} businesses and all demo users as demonstration data`);

await h.close();

// --- Credentials file (never printed) --------------------------------------------------------

const path = resolve(env.DEMO_CREDENTIALS_FILE);
await writeFile(
  path,
  `${JSON.stringify(
    {
      notice:
        'FICTIONAL STAGING DEMO ACCOUNTS. Store in a password manager, never in git or chat. Admins need the TOTP secret in an authenticator app.',
      generatedAt: new Date().toISOString(),
      environment: env.APP_ENV,
      accounts: credentials,
    },
    null,
    2,
  )}\n`,
  { mode: 0o600 },
);
console.log(`[demo] done: ${JSON.stringify(counts)}`);
console.log(`[demo] ${credentials.length} account credentials written to ${path} (mode 0600).`);
