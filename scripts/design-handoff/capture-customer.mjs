// Screenshots of the customer app (Expo web build) in English and Arabic, for the design handoff.
// The app has no URL routes, so this walks through it like a person, clicking by accessible
// names taken from the translation files (the same script works in both languages).
//
//   pnpm --filter @jays/customer export:web        # builds apps/customer/dist
//   node scripts/design-handoff/capture-customer.mjs <demo-credentials.json>
// Needs the local API on EXPO_PUBLIC_API_URL (http://localhost:3000/v1) with the demo data.
// Env: OUT_DIR (docs/design-handoff/screenshots), CUSTOMER_EMAIL_EN, CUSTOMER_EMAIL_AR, ONLY.
import { createReadStream, existsSync, mkdirSync, readFileSync, statSync } from 'node:fs';
import { createServer } from 'node:http';
import { createRequire } from 'node:module';
import { extname, join, normalize } from 'node:path';
import { catalogs as messages } from '../../packages/i18n/dist/index.js';
import { optimizePng } from './optimize.mjs';
import { SCREENS } from './screens.mjs';

const require = createRequire(import.meta.url);
const { chromium, devices } = require('playwright');

const OUT = process.env.OUT_DIR ?? 'docs/design-handoff/screenshots';
// ONLY=C-11,C-19 re-runs some scenarios (ids of the scenario's first screen).
const ONLY = process.env.ONLY ? new Set(process.env.ONLY.split(',')) : null;
const DIST = new URL('../../apps/customer/dist/', import.meta.url).pathname;
const credsFile = process.argv[2];
if (!credsFile) {
  console.error('usage: node capture-customer.mjs <demo-credentials.json>');
  process.exit(1);
}
const accounts = JSON.parse(readFileSync(credsFile, 'utf8')).accounts;
// The app switches to the account's saved language after sign-in, so each language uses a demo
// customer whose profile is in that language.
const CUSTOMERS = {
  en: process.env.CUSTOMER_EMAIL_EN ?? 'customer.nina@demo.jays.example',
  ar: process.env.CUSTOMER_EMAIL_AR ?? 'customer.maha@demo.jays.example',
};
const customerFor = (lang) => {
  const c = accounts.find((a) => a.email === CUSTOMERS[lang]);
  if (!c) throw new Error(`demo customer ${CUSTOMERS[lang]} not found in the credentials file`);
  return c;
};

// Fictional demo names in both languages (apps/api/scripts/demo/demo-data.ts).
const DATA = {
  emirate: { en: /^Abu Dhabi$/, ar: /^أبو ?ظبي$/ },
  product: { en: 'Colour Care Shampoo', ar: 'شامبو العناية بالشعر المصبوغ' },
  shop: { en: 'Oud & Orchid Salon and Shop', ar: 'صالون ومتجر العود والأوركيد' },
  venue: { en: 'Luma Hair Studio', ar: 'استوديو لوما للشعر' },
};

// A small static server with a fallback to index.html, so deep links (unsubscribe) load the app.
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png', '.ttf': 'font/ttf', '.ico': 'image/x-icon' };
const server = createServer((req, res) => {
  const path = normalize(decodeURIComponent(new URL(req.url, 'http://x').pathname)).replace(/^(\.\.[/\\])+/, '');
  let file = join(DIST, path);
  if (!existsSync(file) || statSync(file).isDirectory()) file = join(DIST, 'index.html');
  res.setHeader('Content-Type', TYPES[extname(file)] ?? 'application/octet-stream');
  createReadStream(file).pipe(res);
});
// The API's CORS list allows the customer app at localhost:8081 (.env.example).
const PORT = Number(process.env.CUSTOMER_PORT ?? 8081);
await new Promise((r) => server.listen(PORT, 'localhost', r));
const BASE = `http://localhost:${PORT}`;

const slug = (s) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
const byId = Object.fromEntries(SCREENS.filter((s) => s.app === 'customer').map((s) => [s.id, s]));
const escape = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

async function walk(browser, lang, results) {
  const t = (key, vars = {}) =>
    Object.entries(vars).reduce((s, [k, v]) => s.replace(`{${k}}`, v), messages[lang][key] ?? key);
  const device = devices['iPhone 13'];
  const ctx = await browser.newContext({ ...device, locale: lang === 'ar' ? 'ar-AE' : 'en-AE' });
  const dir = join(OUT, lang);
  mkdirSync(dir, { recursive: true });
  let page = null;

  const btn = (name, exact = false) =>
    page.getByRole('button', { name: typeof name === 'string' ? (exact ? new RegExp(`^${escape(name)}$`) : name) : name }).first();
  const tab = (key) => page.getByRole('tab', { name: new RegExp(`^${escape(t(key))}`) }).first();
  const settle = async (ms = 900) => {
    await page.waitForLoadState('networkidle').catch(() => undefined);
    await page.waitForTimeout(ms);
  };

  async function shot(id, suffix = '') {
    const screen = byId[id];
    await settle();
    const name = `${id}-${slug(screen.name)}${suffix}`;
    const file = join(dir, `${name}.png`);
    await page.screenshot({ path: file });
    await optimizePng(file);
    // Full length: grow the viewport to the tallest scrolling area, then restore it.
    const tall = await page.evaluate(() => {
      let max = document.documentElement.scrollHeight;
      for (const el of document.querySelectorAll('*')) {
        if (el.scrollHeight > el.clientHeight + 4 && getComputedStyle(el).overflowY !== 'visible') {
          max = Math.max(max, el.scrollHeight + (window.innerHeight - el.clientHeight));
        }
      }
      return Math.min(max, 6000);
    });
    let fullFile = null;
    if (tall > device.viewport.height + 40) {
      await page.setViewportSize({ width: device.viewport.width, height: tall });
      await page.waitForTimeout(400);
      fullFile = join(dir, `${name}-full.png`);
      await page.screenshot({ path: fullFile });
      await optimizePng(fullFile);
      await page.setViewportSize(device.viewport);
      await page.waitForTimeout(300);
    }
    const rtl = await page.evaluate(() => !!document.querySelector('[dir=rtl]') || document.documentElement.dir === 'rtl');
    results.push({ id: id + suffix, lang, file, fullFile, rtl });
    console.log(`ok   ${id}${suffix} ${lang}${fullFile ? ' (+full)' : ''}`);
  }

  const customer = customerFor(lang);
  const signIn = async () => {
    await page.getByLabel(t('auth.identifier')).fill(customer.email);
    await page.getByLabel(t('auth.password'), { exact: true }).fill(customer.password);
    await btn(t('common.continue'), true).click();
    await settle(2500);
  };

  // Guest scenarios start from a fresh load. Signed-in scenarios share one session (signing in
  // again and again would trip the sign-in rate limit) and step back to the tab bar instead.
  let signedInPage = null;
  async function toTabBar() {
    // Sub-screens have a back button labelled with an arrow and the parent's name ("← Account").
    for (let i = 0; i < 6; i += 1) {
      const backBtn = page.getByRole('button', { name: /^[←→]/ }).first();
      if (!(await backBtn.isVisible().catch(() => false))) break;
      await backBtn.click();
      await settle(600);
    }
  }
  async function start({ signedIn = false, mode = 'shop' } = {}) {
    if (signedIn && signedInPage && !signedInPage.isClosed()) {
      page = signedInPage;
      await toTabBar();
    } else {
      if (page && page !== signedInPage) await page.close();
      page = await ctx.newPage();
      page.setDefaultTimeout(10000);
      await page.goto(BASE, { waitUntil: 'networkidle' });
      await page.getByText(DATA.emirate[lang]).first().click();
      await page.getByText(t('mode.shop'), { exact: true }).first().click();
      await settle();
      if (signedIn) {
        await tab('account.title').click();
        await settle();
        await btn(t('common.signIn'), true).click();
        await settle();
        await signIn();
        signedInPage = page;
      }
    }
    // The Shop Products / Book Services switch shows on the Home tab.
    await tab('tab.home').click().catch(() => undefined);
    await settle(400);
    const want = mode === 'services' ? t('mode.services') : t('mode.shop');
    await page.getByRole('tab', { name: want }).first().click();
    await settle();
    await tab('tab.home').click().catch(() => undefined);
    await settle(400);
  }

  async function scenario(id, fn) {
    if (ONLY && !ONLY.has(id)) return;
    try {
      await fn();
    } catch (error) {
      console.log(`WARN ${id} ${lang}: ${String(error.message).split('\n')[0]}`);
      const names = await page
        ?.evaluate(() =>
          [...document.querySelectorAll('[role=button],[role=tab],[role=link],input')]
            .map((e) => (e.getAttribute('aria-label') || e.innerText || e.placeholder || '').replace(/\s+/g, ' ').slice(0, 50))
            .filter(Boolean)
            .slice(0, 30),
        )
        .catch(() => []);
      console.log(`     visible: ${(names ?? []).join(' | ')}`);
      results.push({ id, lang, failed: true });
    }
  }
  const openAccountItem = async (label) => {
    await tab('account.title').click();
    await settle();
    await btn(label).click();
    await settle();
  };

  // --- Guest: gateway, shop, product, basket, checkout ---------------------------------------
  await scenario('C-01', async () => {
    page = await ctx.newPage();
    await page.goto(BASE, { waitUntil: 'networkidle' });
    await shot('C-01');
  });
  await scenario('C-02', async () => {
    await start();
    await shot('C-02');
  });
  await scenario('C-03', async () => {
    await start();
    await btn(t('search.query'), true).click();
    await shot('C-03');
  });
  await scenario('C-04', async () => {
    await start();
    await btn(DATA.shop[lang], true).click();
    await shot('C-04');
  });
  await scenario('C-05', async () => {
    await start();
    await btn(new RegExp(`^${escape(DATA.product[lang])}`)).click();
    await shot('C-05');
  });
  await scenario('C-07', async () => {
    await start();
    await btn(new RegExp(`^${escape(DATA.product[lang])}`)).click();
    await settle();
    await btn(t('shop.addToCart'), true).click();
    await settle();
    await tab('cart.title').click();
    await shot('C-07');
    await btn(t('cart.checkout'), true).click();
    await shot('C-13');
    await signIn();
    await shot('C-08');
    await btn(t('checkout.review'), true).click();
    await settle(2000);
    await shot('C-08', '-quote');
  });

  // --- Signed in: account area ---------------------------------------------------------------
  await scenario('C-16', async () => {
    await start({ signedIn: true });
    await tab('account.title').click();
    await shot('C-16');
  });
  await scenario('C-06', async () => {
    await start({ signedIn: true });
    await openAccountItem(new RegExp(`^${escape(t('wishlist.title'))}`));
    await shot('C-06');
  });
  await scenario('C-25', async () => {
    await start({ signedIn: true });
    await openAccountItem(new RegExp(`^${escape(t('inbox.title'))}`));
    await shot('C-25');
  });
  await scenario('C-21', async () => {
    await start({ signedIn: true });
    await openAccountItem(new RegExp(`^${escape(t('support.title'))}`));
    await shot('C-21');
    await btn(new RegExp(escape(t('support.new')))).click();
    await shot('C-22');
  });
  await scenario('C-23', async () => {
    await start({ signedIn: true });
    await openAccountItem(new RegExp(`^${escape(t('support.title'))}`));
    // The newest conversation: the first button below the "new request" button.
    const all = page.getByRole('button');
    const n = await all.count();
    let seenNew = false;
    for (let i = 0; i < n; i += 1) {
      const label = ((await all.nth(i).getAttribute('aria-label')) ?? (await all.nth(i).innerText())).trim();
      if (label.includes(t('support.new'))) seenNew = true;
      else if (seenNew && label.length > 3) {
        await all.nth(i).click();
        break;
      }
    }
    await shot('C-23');
  });
  await scenario('C-26', async () => {
    await start({ signedIn: true });
    await openAccountItem(new RegExp(`^${escape(t('account.privacy'))}`));
    await shot('C-26');
  });
  await scenario('C-27', async () => {
    await start({ signedIn: true });
    await openAccountItem(new RegExp(`^${escape(t('legal.title'))}`));
    await shot('C-27');
    // The first document in the list (titles come from the published drafts).
    const docs = page.getByRole('button').filter({ hasNotText: t('common.back') });
    for (let i = 0; i < (await docs.count()); i += 1) {
      const label = ((await docs.nth(i).getAttribute('aria-label')) ?? (await docs.nth(i).innerText())).trim();
      if (label.length > 8) {
        await docs.nth(i).click();
        break;
      }
    }
    await shot('C-28');
  });

  // --- Orders and after-sales ----------------------------------------------------------------
  await scenario('C-17', async () => {
    await start({ signedIn: true });
    await tab('myOrders.title').click();
    await shot('C-17');
    await page.getByRole('button', { name: /^#/ }).nth(1).click();
    await shot('C-18');
    await btn(new RegExp(`^${escape(t('tax.title.invoice'))}`)).click();
    await shot('C-24');
  });

  // --- Services: discovery, venue, booking, appointments -------------------------------------
  await scenario('C-09', async () => {
    await start({ mode: 'services' });
    await shot('C-09');
    await btn(t('serviceSearch.atHome'), true).click();
    await shot('C-10');
  });
  await scenario('C-11', async () => {
    await start({ signedIn: true, mode: 'services' });
    await tab('tab.home').click();
    await settle();
    await btn(DATA.venue[lang], true).click();
    await shot('C-11');
    await btn(t('venue.book'), true).click();
    await settle(1500);
    await shot('C-12');
  });
  await scenario('C-19', async () => {
    await start({ signedIn: true, mode: 'services' });
    await tab('tab.appointments').click();
    await shot('C-19');
    await page.getByRole('button', { name: new RegExp(escape(t('bookingStatus.confirmed'))) }).first().click();
    await shot('C-20');
  });

  // --- Signed out: reset password, register and verify --------------------------------------
  await scenario('C-15', async () => {
    await start();
    await tab('account.title').click();
    await settle();
    await btn(t('common.signIn'), true).click();
    await settle();
    await btn(t('auth.forgot'), true).click();
    await shot('C-15');
  });
  await scenario('C-14', async () => {
    await start();
    await tab('account.title').click();
    await settle();
    await btn(t('common.signIn'), true).click();
    await settle();
    await btn(t('auth.noAccount'), true).click();
    await settle();
    await shot('C-13', '-register');
    // A fictional address on the reserved .example domain; the local API only logs the code.
    const inputs = page.locator('input');
    const count = await inputs.count();
    for (let i = 0; i < count; i += 1) {
      const input = inputs.nth(i);
      const type = await input.getAttribute('type');
      if (type === 'checkbox') continue;
      const label = `${(await input.getAttribute('aria-label')) ?? ''}`;
      if (label === t('auth.password') || type === 'password') await input.fill('Design-Preview-Only-9x');
      else if (label === t('auth.email') || label === t('auth.identifier') || type === 'email') await input.fill(`design.preview.${lang}.${Date.now()}@demo.jays.example`);
      else await input.fill(lang === 'ar' ? 'معاينة التصميم' : 'Design Preview');
    }
    // Only the required terms box; marketing consent stays off.
    await page.getByRole('checkbox', { name: new RegExp(`^${escape(t('auth.terms').slice(0, 20))}`) }).first().click();
    await btn(t('common.continue'), true).click();
    await settle(2500);
    await shot('C-14');
  });

  // --- Unsubscribe link (opens without signing in) ------------------------------------------
  await scenario('C-29', async () => {
    if (page) await page.close();
    page = await ctx.newPage();
    await page.goto(`${BASE}/unsubscribe?token=demo-invalid-token`, { waitUntil: 'networkidle' });
    await shot('C-29');
  });
  await ctx.close();
}

const browser = await chromium.launch();
const results = [];
try {
  for (const lang of ['en', 'ar']) await walk(browser, lang, results);
} finally {
  await browser.close();
  server.close();
}
const missing = Object.keys(byId).flatMap((id) =>
  ['en', 'ar'].filter((lang) => !results.some((r) => r.id === id && r.lang === lang && !r.failed)).map((lang) => `${id}/${lang}`),
);
console.log(`\n${results.filter((r) => !r.failed).length} customer screenshots; missing: ${missing.join(', ') || 'none'}`);
