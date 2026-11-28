// Shared helpers for the design-handoff scripts: demo accounts, demo record ids and portal
// sign-in. Fictional demo data only (docs/DEMO_DATA.md).
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';

const apiRequire = createRequire(new URL('../../apps/api/package.json', import.meta.url));
const pg = apiRequire('pg');
const { totpAt } = await import('../../apps/api/dist/src/auth/totp.js');

export const BIZ = process.env.BUSINESS_URL ?? 'http://localhost:3001';
export const ADMIN = process.env.ADMIN_URL ?? 'http://localhost:3002';

export function loadAccounts(credsFile) {
  const accounts = JSON.parse(readFileSync(credsFile, 'utf8')).accounts;
  return (prefix) => {
    const a = accounts.find((x) => x.email.startsWith(prefix));
    if (!a) throw new Error(`no demo account ${prefix}`);
    return a;
  };
}

// Concrete ids from the demo data. The hybrid business shows both Manage Products and Services.
export async function context(account) {
  const db = new pg.Client({ connectionString: process.env.DATABASE_URL });
  await db.connect();
  const one = async (sql, params = []) => (await db.query(sql, params)).rows[0]?.id ?? null;
  const owner = account('owner.oud-orchid@');
  const biz = await one(
    `SELECT b.id FROM businesses b JOIN memberships m ON m.business_id = b.id
     JOIN users u ON u.id = m.user_id WHERE u.email = $1`,
    [owner.email],
  );
  const c = {
    biz,
    product: await one(`SELECT id FROM products WHERE business_id = $1 ORDER BY created_at LIMIT 1`, [biz]),
    order: await one(
      `SELECT id FROM merchant_orders WHERE business_id = $1 AND status = 'shipped' ORDER BY created_at LIMIT 1`,
      [biz],
    ) ?? await one(`SELECT id FROM merchant_orders WHERE business_id = $1 ORDER BY created_at LIMIT 1`, [biz]),
    service: await one(`SELECT id FROM services WHERE business_id = $1 ORDER BY created_at LIMIT 1`, [biz]),
    branch: await one(`SELECT id FROM branches WHERE business_id = $1 ORDER BY created_at LIMIT 1`, [biz]),
    staff: await one(`SELECT id FROM staff WHERE business_id = $1 ORDER BY created_at LIMIT 1`, [biz]),
    booking: await one(
      `SELECT id FROM bookings WHERE business_id = $1 AND status = 'confirmed' ORDER BY start_at LIMIT 1`,
      [biz],
    ),
    bizTaxDoc: await one(`SELECT id FROM tax_documents WHERE business_id = $1 ORDER BY created_at LIMIT 1`, [biz]),
    queueBiz: await one(`SELECT id FROM businesses WHERE status = 'submitted' LIMIT 1`),
    homeBiz: await one(`SELECT business_id AS id FROM home_service_profiles ORDER BY created_at LIMIT 1`),
    payment: await one(`SELECT id FROM payments ORDER BY created_at DESC LIMIT 1`),
    taxDoc: await one(`SELECT id FROM tax_documents ORDER BY created_at DESC LIMIT 1`),
    ticket: await one(`SELECT id FROM support_tickets WHERE status = 'awaiting_reply' LIMIT 1`),
    legal: await one(`SELECT id FROM legal_documents WHERE kind = 'customer_terms' LIMIT 1`),
  };
  await db.end();
  for (const [k, v] of Object.entries(c)) if (!v) console.warn(`warning: no demo record for ${k}`);
  return c;
}

export async function signInBusiness(ctx, who) {
  const p = await ctx.newPage();
  await p.goto(`${BIZ}/sign-in`);
  await p.fill('input[name=identifier]', who.email);
  await p.fill('input[name=password]', who.password);
  await p.click('main button[type=submit]');
  await p.waitForURL(/gateway|business\//);
  await p.close();
}

let lastCode = '';
export async function signInAdmin(ctx, who) {
  // TOTP codes are single use, so a second sign-in waits for the next 30-second code.
  while (totpAt(who.totpSecret, new Date()) === lastCode) await new Promise((r) => setTimeout(r, 1000));
  lastCode = totpAt(who.totpSecret, new Date());
  const p = await ctx.newPage();
  await p.goto(`${ADMIN}/sign-in`);
  await p.fill('input[name=email]', who.email);
  await p.fill('input[name=password]', who.password);
  await p.fill('input[name=totpCode]', lastCode);
  await p.click('main button[type=submit]');
  await p.waitForURL(/admin\//);
  await p.close();
}

