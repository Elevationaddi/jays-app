// Accessibility audit of the business portal and admin console in English and Arabic (T11).
// Runs axe-core (WCAG 2.1 A and AA rules) on each page against a locally seeded stack:
//   pnpm db:seed && start the API and both portals (next build && next start), then
//   node scripts/a11y/audit.mjs
// Env: BUSINESS_URL (default http://localhost:3001), ADMIN_URL (http://localhost:3002).
// Exits 1 if any page has a serious or critical violation. Needs Playwright with Chromium.
import { execSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { chromium } = require('playwright');
const AXE = readFileSync(require.resolve('axe-core/axe.min.js'), 'utf8');

const BIZ = process.env.BUSINESS_URL ?? 'http://localhost:3001';
const ADMIN = process.env.ADMIN_URL ?? 'http://localhost:3002';
// Fictional local seed credentials (apps/api/scripts/seed-data.ts). Never real accounts.
const PASS = 'Local-Dev-Passw0rd!';
const OWNER = 'owner.oud@example.test';
const ADMIN_EMAIL = 'superadmin@admin.example.test';

const BUSINESS_PAGES = [
  'dashboard',
  'onboarding',
  'storefront',
  'products',
  'products/new',
  'inventory',
  'delivery',
  'orders',
  'returns',
  'reviews',
  'calendar',
  'services',
  'staff',
  'finance',
  'team',
];
const ADMIN_PAGES = [
  'dashboard',
  'businesses',
  'products',
  'services',
  'bookings',
  'orders',
  'finance',
  'finance/payments',
  'finance/refunds',
  'finance/payouts',
  'finance/disputes',
  'finance/reconciliation',
  'finance/earnings',
  'support',
  'reviews',
  'notifications',
  'content',
  'security',
];

async function audit(page, url) {
  await page.goto(url, { waitUntil: 'networkidle' });
  await page.addScriptTag({ content: AXE });
  const result = await page.evaluate(() =>
    // eslint-disable-next-line no-undef
    axe.run(document, { runOnly: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'] }),
  );
  return result.violations.map((v) => ({
    id: v.id,
    impact: v.impact,
    help: v.help,
    nodes: v.nodes.slice(0, 3).map((n) => n.target.join(' ')),
    count: v.nodes.length,
  }));
}

async function run(context, base, paths, label) {
  const page = await context.newPage();
  const findings = [];
  for (const lang of ['en', 'ar']) {
    await context.addCookies([{ name: 'lang', value: lang, url: base }]);
    for (const path of paths) {
      const violations = await audit(page, `${base}${path}`);
      const landed = new URL(page.url()).pathname;
      if (landed !== path && !path.startsWith(landed)) {
        violations.push({
          id: 'redirected',
          impact: 'critical',
          help: `page redirected to ${landed}`,
          nodes: [],
          count: 1,
        });
      }
      const dir = await page.evaluate(() => document.documentElement.dir);
      if (lang === 'ar' && dir !== 'rtl')
        violations.push({
          id: 'rtl',
          impact: 'serious',
          help: 'Arabic page is not right-to-left',
          nodes: [],
          count: 1,
        });
      findings.push({ label, lang, path, violations });
      const bad = violations.filter((v) => v.impact === 'serious' || v.impact === 'critical');
      console.log(
        `${bad.length ? 'FAIL' : 'ok  '} ${label} ${lang} ${path}${violations.length ? ` (${violations.map((v) => `${v.id}:${v.impact}`).join(', ')})` : ''}`,
      );
      for (const v of violations)
        console.log(`       ${v.id} [${v.impact}] ${v.help} x${v.count} ${v.nodes.join(' | ')}`);
    }
  }
  await page.close();
  return findings;
}

const browser = await chromium.launch();
const all = [];
try {
  // Business portal, signed in as the hybrid seed owner.
  const biz = await browser.newContext();
  const p = await biz.newPage();
  await p.goto(`${BIZ}/sign-in`);
  all.push(...(await run(biz, BIZ, ['/sign-in', '/register'], 'business')));
  await p.goto(`${BIZ}/sign-in`);
  await p.fill('input[name=identifier]', OWNER);
  await p.fill('input[name=password]', PASS);
  await p.click('main button[type=submit]');
  await p.waitForURL(/gateway|business\//);
  await p.goto(`${BIZ}/business/gateway`);
  const href = await p.getAttribute(
    'a[href^="/business/"][href$="/dashboard"], a[href*="/business/"][href*="-"]',
    'href',
  );
  const id = /\/business\/([0-9a-f-]{36})/.exec(href ?? '')?.[1];
  if (!id) throw new Error('no business found for the seed owner; run pnpm db:seed');
  all.push(
    ...(await run(
      biz,
      BIZ,
      ['/business/gateway', ...BUSINESS_PAGES.map((x) => `/business/${id}/${x}`)],
      'business',
    )),
  );
  await biz.close();

  // Admin console, signed in as the seed superadmin with a fresh TOTP code.
  const adm = await browser.newContext();
  const a = await adm.newPage();
  all.push(...(await run(adm, ADMIN, ['/sign-in'], 'admin')));
  await a.goto(`${ADMIN}/sign-in`);
  await a.fill('input[name=email]', ADMIN_EMAIL);
  await a.fill('input[name=password]', PASS);
  const code = execSync(`pnpm --silent --filter @jays/api totp ${ADMIN_EMAIL}`)
    .toString()
    .trim()
    .split('\n')
    .pop()
    .trim();
  await a.fill('input[name=totpCode]', code);
  await a.click('main button[type=submit]');
  await a.waitForURL(/admin\//);
  all.push(
    ...(await run(
      adm,
      ADMIN,
      ADMIN_PAGES.map((x) => `/admin/${x}`),
      'admin',
    )),
  );
  await adm.close();
} finally {
  await browser.close();
}

const serious = all.flatMap((f) =>
  f.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical'),
);
console.log(
  `\n${all.length} page views audited, ${serious.length} serious or critical violations.`,
);
process.exit(serious.length ? 1 : 0);
