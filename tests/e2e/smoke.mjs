// Browser smoke tests for the portals and the customer web build (phase 11, ADR-0033).
//
// Runs against locally started apps with the fictional seed data (pnpm db:seed):
//   API on 3000, business portal on 3001, admin console on 3002, and optionally the customer
//   web build served at WEB_URL. Uses Playwright when it is installed on the machine; it is not
//   a repository dependency. Usage: node tests/e2e/smoke.mjs
//
// Covers parts of T03 (role boundaries), T11 (Arabic RTL and English; no location permission
// prompt on load) and T12 (direct upload with server checks), plus security headers.
import { createRequire } from 'node:module';
import { writeFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const require = createRequire(import.meta.url);
let chromium;
try {
  ({ chromium } = require('playwright'));
} catch {
  console.log('SKIP: Playwright is not installed on this machine');
  process.exit(0);
}

const API = process.env.API_URL ?? 'http://localhost:3000/v1';
const BUSINESS = process.env.BUSINESS_URL ?? 'http://localhost:3001';
const ADMIN = process.env.ADMIN_URL ?? 'http://localhost:3002';
const WEB = process.env.WEB_URL;
const PASSWORD = process.env.SEED_PASSWORD ?? 'Local-Dev-Passw0rd!';

const results = [];
async function check(name, fn) {
  try {
    await fn();
    results.push(['PASS', name]);
  } catch (error) {
    results.push(['FAIL', `${name}: ${error instanceof Error ? error.message : error}`]);
  }
}
const assert = (ok, message) => {
  if (!ok) throw new Error(message);
};

async function apiLogin(email) {
  const res = await fetch(`${API}/auth/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ identifier: email, password: PASSWORD }),
  });
  const body = await res.json();
  assert(res.ok, `API sign-in for ${email} answered ${res.status}`);
  return body.tokens.accessToken;
}

async function myBusinesses(token) {
  const res = await fetch(`${API}/me/memberships`, {
    headers: { authorization: `Bearer ${token}` },
  });
  const body = await res.json();
  return (body.items ?? [])
    .filter((m) => m.status === 'active' && m.business.status === 'approved')
    .map((m) => m.business.id);
}

const browser = await chromium.launch();
try {
  await check('security headers on both portals', async () => {
    for (const base of [BUSINESS, ADMIN]) {
      const res = await fetch(`${base}/sign-in`);
      for (const header of [
        'x-frame-options',
        'x-content-type-options',
        'content-security-policy',
      ]) {
        assert(res.headers.get(header), `${base} is missing ${header}`);
      }
      assert(
        res.headers.get('content-security-policy').includes("frame-ancestors 'none'"),
        `${base} allows framing`,
      );
    }
  });

  await check('Arabic is right to left and English left to right (T11)', async () => {
    const context = await browser.newContext({ locale: 'ar-AE' });
    const page = await context.newPage();
    await page.goto(`${BUSINESS}/sign-in`);
    const ar = await page.evaluate(() => [
      document.documentElement.lang,
      document.documentElement.dir,
    ]);
    assert(ar[0] === 'ar' && ar[1] === 'rtl', `Arabic page is ${ar.join('/')}`);
    await page.locator('header form button', { hasText: 'English' }).click();
    await page.waitForFunction(() => document.documentElement.dir === 'ltr');
    const en = await page.evaluate(() => document.documentElement.lang);
    assert(en === 'en', `English page lang is ${en}`);
    await context.close();
  });

  const ownToken = await apiLogin('owner.noor@example.test');
  const otherToken = await apiLogin('owner.lumiere@example.test');
  const own = (await myBusinesses(ownToken))[0];
  const other = (await myBusinesses(otherToken))[0];

  const context = await browser.newContext({ locale: 'en-AE' });
  const page = await context.newPage();
  await page.goto(`${BUSINESS}/sign-in`);
  await page.fill('input[name="identifier"]', 'owner.noor@example.test');
  await page.fill('input[name="password"]', PASSWORD);
  await page.click('form:has(input[name="password"]) button[type="submit"]');
  await page.waitForURL((u) => !u.pathname.startsWith('/sign-in'), { timeout: 20000 });

  await check('an owner opens their own workspace', async () => {
    const res = await page.goto(`${BUSINESS}/business/${own}/finance`);
    assert(res && res.status() < 400, `own finance page answered ${res?.status()}`);
    assert(page.url().includes(own), `own finance page redirected to ${page.url()}`);
  });

  await check("an owner cannot open another business's workspace (T03)", async () => {
    assert(own && other && own !== other, 'seed data lacks two businesses');
    const res = await page.goto(`${BUSINESS}/business/${other}/finance`);
    const status = res?.status() ?? 0;
    const text = await page
      .locator('main')
      .innerText()
      .catch(() => '');
    assert(
      status === 404 ||
        status === 403 ||
        !page.url().includes(other) ||
        /not found|404/i.test(text),
      `another business's finance page answered ${status} at ${page.url()}`,
    );
  });

  await check('a business document uploads straight to storage and is checked (T12)', async () => {
    const res = await fetch(`${API}/businesses`, {
      method: 'POST',
      headers: { authorization: `Bearer ${ownToken}`, 'content-type': 'application/json' },
      body: JSON.stringify({
        displayName: { en: 'Fictional Smoke Test', ar: 'اختبار' },
        modes: ['shop'],
      }),
    });
    const draft = (await res.json()).id;
    assert(draft, 'could not create a draft business');
    const dir = mkdtempSync(join(tmpdir(), 'jays-e2e-'));
    const file = join(dir, 'licence.pdf');
    writeFileSync(
      file,
      Buffer.concat([
        Buffer.from('%PDF-1.4\n'),
        Buffer.alloc(6 * 1024 * 1024, 0x20),
        Buffer.from('\n%%EOF\n'),
      ]),
    );
    const puts = [];
    page.on('request', (r) => r.method() === 'PUT' && puts.push(r.url()));
    await page.goto(`${BUSINESS}/business/${draft}/onboarding`);
    await page.setInputFiles('form.upload input[type="file"]', file);
    await page.click('form.upload button[type="submit"]');
    await page.waitForURL(/saved=document|error=/, { timeout: 30000 });
    assert(page.url().includes('saved=document'), `upload ended at ${page.url()}`);
    assert(puts.length === 1, `expected one browser PUT, saw ${puts.length}`);
  });
  await context.close();

  await check('the admin console needs an authenticator code (T03)', async () => {
    const ctx = await browser.newContext({ locale: 'en-AE' });
    const p = await ctx.newPage();
    const res = await p.goto(`${ADMIN}/admin/dashboard`);
    assert(
      new URL(p.url()).pathname.startsWith('/sign-in'),
      `dashboard without sign-in reached ${p.url()} (${res?.status()})`,
    );
    assert(
      (await p.locator('input[name="totpCode"]').count()) === 1,
      'no authenticator code field',
    );
    await p.fill('input[name="email"]', 'superadmin@admin.example.test');
    await p.fill('input[name="password"]', PASSWORD);
    await p.fill('input[name="totpCode"]', '000000');
    await p.click('form:has(input[name="totpCode"]) button[type="submit"]');
    await p.waitForLoadState('networkidle');
    assert(new URL(p.url()).pathname.startsWith('/sign-in'), `a wrong code reached ${p.url()}`);
    await ctx.close();
  });

  if (WEB) {
    await check('the customer web build opens without asking for location (T11)', async () => {
      const ctx = await browser.newContext({ locale: 'en-AE' });
      const p = await ctx.newPage();
      await p.addInitScript(() => {
        window.__geo = 0;
        const g = navigator.geolocation;
        if (g) {
          g.getCurrentPosition = () => {
            window.__geo += 1;
          };
          g.watchPosition = () => {
            window.__geo += 1;
            return 0;
          };
        }
      });
      await p.goto(WEB);
      await p.waitForLoadState('networkidle');
      const text = await p.locator('body').innerText();
      assert(text.trim().length > 0, 'the page is empty');
      assert((await p.evaluate(() => window.__geo)) === 0, 'location was requested on load');
      await ctx.close();
    });
  }
} finally {
  await browser.close();
}

for (const [status, name] of results) console.log(`${status}  ${name}`);
process.exit(results.some(([s]) => s === 'FAIL') ? 1 : 0);
