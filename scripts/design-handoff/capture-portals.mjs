// Screenshots of the business portal and admin console, in English and Arabic, for the design
// handoff. Runs against a local stack loaded with the fictional demo data (docs/DEMO_DATA.md):
//   DATABASE_URL=... node scripts/design-handoff/capture-portals.mjs <demo-credentials.json>
// Env: BUSINESS_URL (http://localhost:3001), ADMIN_URL (http://localhost:3002), OUT_DIR
// (docs/design-handoff/screenshots), SCALE (device scale factor, default 2), ONLY (comma ids).
import { mkdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { optimizePng } from './optimize.mjs';
import { ADMIN, BIZ, context, loadAccounts, signInAdmin, signInBusiness } from './portal-session.mjs';
import { SCREENS } from './screens.mjs';

const require = createRequire(import.meta.url);
const { chromium } = require('playwright');

const OUT = process.env.OUT_DIR ?? 'docs/design-handoff/screenshots';
const SCALE = Number(process.env.SCALE ?? 2);
const ONLY = process.env.ONLY ? new Set(process.env.ONLY.split(',')) : null;
const credsFile = process.argv[2];
if (!credsFile || !process.env.DATABASE_URL) {
  console.error('usage: DATABASE_URL=... node capture-portals.mjs <demo-credentials.json>');
  process.exit(1);
}
const account = loadAccounts(credsFile);

const slug = (s) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

async function shoot(ctx, base, screen, ids, lang, results) {
  const page = await ctx.newPage();
  const path = screen.path(ids);
  const res = await page.goto(`${base}${path}`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(300);
  const dir = join(OUT, lang);
  mkdirSync(dir, { recursive: true });
  const file = join(dir, `${screen.id}-${slug(screen.name)}.png`);
  await page.screenshot({ path: file, fullPage: true });
  await optimizePng(file);
  const landed = new URL(page.url()).pathname;
  const rtl = (await page.evaluate(() => document.documentElement.dir)) === 'rtl';
  const ok = (res?.status() ?? 0) < 400 && landed === new URL(`${base}${path}`).pathname;
  results.push({ id: screen.id, lang, file, status: res?.status(), landed, rtl, ok });
  console.log(`${ok ? 'ok  ' : 'WARN'} ${screen.id} ${lang} ${path}${ok ? '' : ` -> ${landed} (${res?.status()})`}`);
  await page.close();
}

const ids = await context(account);
const browser = await chromium.launch();
const results = [];
const viewport = { width: 1440, height: 900 };
try {
  for (const lang of ['en', 'ar']) {
    for (const [app, base] of [['business', BIZ], ['admin', ADMIN]]) {
      const screens = SCREENS.filter((s) => s.app === app && !s.redirect && (!ONLY || ONLY.has(s.id)));
      if (!screens.length) continue;
      const guest = await browser.newContext({ viewport, deviceScaleFactor: SCALE });
      await guest.addCookies([{ name: 'lang', value: lang, url: base }]);
      for (const s of screens.filter((x) => x.guest)) await shoot(guest, base, s, ids, lang, results);
      await guest.close();

      const authed = screens.filter((x) => !x.guest);
      if (!authed.length) continue;
      const ctx = await browser.newContext({ viewport, deviceScaleFactor: SCALE });
      await ctx.addCookies([{ name: 'lang', value: lang, url: base }]);
      if (app === 'business') await signInBusiness(ctx, account('owner.oud-orchid@'));
      else await signInAdmin(ctx, account('admin.superadmin@'));
      for (const s of authed) await shoot(ctx, base, s, ids, lang, results);
      await ctx.close();
    }
  }
} finally {
  await browser.close();
}
const bad = results.filter((r) => !r.ok || (r.lang === 'ar' && !r.rtl));
console.log(`\n${results.length} screenshots, ${bad.length} to check: ${bad.map((b) => `${b.id}/${b.lang}`).join(', ')}`);
