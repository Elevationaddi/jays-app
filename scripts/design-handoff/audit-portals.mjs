// Automated audit of every business-portal and admin-console screen, in English and Arabic, at
// desktop (1440 px) and phone (390 px) widths, against the local stack with the demo data.
//   DATABASE_URL=... node scripts/design-handoff/audit-portals.mjs <demo-credentials.json>
// Checks, per page:
//   - the page loads (no error status, no redirect away from it);
//   - every internal link on it resolves (no 404 or 500);
//   - accessibility with axe-core (WCAG 2.0/2.1 A and AA);
//   - sideways overflow (content wider than the screen);
//   - Arabic pages: right-to-left, and English words left in the interface text.
// Writes docs/design-handoff/data/audit-portals.json.
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { ADMIN, BIZ, context, loadAccounts, signInAdmin, signInBusiness } from './portal-session.mjs';
import { SCREENS } from './screens.mjs';

const require = createRequire(import.meta.url);
const { chromium } = require('playwright');
const AXE = readFileSync(require.resolve('axe-core/axe.min.js'), 'utf8');
const credsFile = process.argv[2];
if (!credsFile || !process.env.DATABASE_URL) {
  console.error('usage: DATABASE_URL=... node audit-portals.mjs <demo-credentials.json>');
  process.exit(1);
}
const account = loadAccounts(credsFile);
const ids = await context(account);

// Fictional demo names and codes that are legitimately Latin in Arabic pages are excluded below.
const ALLOWED_LATIN = /^(JAYS|AED|VAT|TRN|SKU|CSV|PDF|ID|OK|TOTP|URL|API|PSP|Stripe|Resend|Firebase|English|DEMO[-\w]*|[A-Z0-9-]{4,}|[\w.+-]+@[\w.-]+|https?:\S+|ml|g|kg|cm|AM|PM)$/;

async function auditPage(page, base, path, lang, viewport, linkCache) {
  const res = await page.goto(`${base}${path}`, { waitUntil: 'networkidle' });
  const landed = new URL(page.url()).pathname;
  const finding = { path, lang, viewport, status: res?.status(), landed, issues: [] };
  if ((res?.status() ?? 0) >= 400) finding.issues.push({ kind: 'load', detail: `status ${res?.status()}` });
  if (landed !== new URL(`${base}${path}`).pathname) finding.issues.push({ kind: 'redirect', detail: landed });

  const overflow = await page.evaluate(() => {
    const doc = document.documentElement;
    const width = doc.clientWidth;
    const wide = [];
    for (const el of document.querySelectorAll('body *')) {
      const r = el.getBoundingClientRect();
      if (r.width > 0 && (r.right > width + 1 || r.left < -1)) {
        // Only report the outermost offender inside a scrollable table wrapper or not.
        let p = el.parentElement;
        let inScroller = false;
        while (p) {
          const ox = getComputedStyle(p).overflowX;
          if (ox === 'auto' || ox === 'scroll') { inScroller = true; break; }
          p = p.parentElement;
        }
        if (!inScroller) wide.push(`${el.tagName.toLowerCase()}${el.className && typeof el.className === 'string' ? '.' + el.className.split(' ').join('.') : ''}`);
      }
    }
    return { scrollWidth: doc.scrollWidth, width, wide: [...new Set(wide)].slice(0, 6) };
  });
  if (overflow.scrollWidth > overflow.width + 1) {
    finding.issues.push({ kind: 'overflow', detail: `page is ${overflow.scrollWidth}px wide in a ${overflow.width}px window: ${overflow.wide.join(', ')}` });
  }

  if (lang === 'ar') {
    const dir = await page.evaluate(() => document.documentElement.dir);
    if (dir !== 'rtl') finding.issues.push({ kind: 'rtl', detail: `<html dir="${dir}">` });
    const latin = await page.evaluate(() => {
      const out = [];
      const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
      while (walker.nextNode()) {
        const node = walker.currentNode;
        const el = node.parentElement;
        if (!el || el.closest('script,style,.ltr,code,[dir=ltr],input,textarea,option')) continue;
        const style = getComputedStyle(el);
        if (style.display === 'none' || style.visibility === 'hidden') continue;
        const text = node.textContent.trim();
        if (text && /[A-Za-z]{3,}/.test(text) && !/[؀-ۿ]/.test(text)) out.push(text.slice(0, 60));
      }
      return [...new Set(out)];
    });
    const leaks = latin.filter((t) => !t.split(/\s+/).every((w) => /^[^A-Za-z]*$/.test(w) || ALLOWED_LATIN_TEST(w)));
    if (leaks.length) finding.issues.push({ kind: 'english-in-arabic', detail: leaks.slice(0, 8).join(' | ') });
  }

  if (viewport === 'desktop') {
    await page.addScriptTag({ content: AXE });
    const axe = await page.evaluate(() =>
      // eslint-disable-next-line no-undef
      axe.run(document, { runOnly: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'] }),
    );
    for (const v of axe.violations) {
      finding.issues.push({ kind: 'a11y', impact: v.impact, detail: `${v.id}: ${v.help} (x${v.nodes.length}) ${v.nodes.slice(0, 2).map((n) => n.target.join(' ')).join(' | ')}` });
    }
    if (lang === 'en') {
      const hrefs = await page.evaluate(() =>
        [...document.querySelectorAll('a[href]')]
          .map((a) => a.getAttribute('href'))
          .filter((h) => h && h.startsWith('/') && !h.startsWith('//')),
      );
      for (const href of [...new Set(hrefs)]) {
        if (!linkCache.has(href)) {
          const r = await page.request.get(`${base}${href}`, { maxRedirects: 5 }).catch(() => null);
          linkCache.set(href, r ? r.status() : 0);
        }
        const status = linkCache.get(href);
        if (status >= 400 || status === 0) finding.issues.push({ kind: 'broken-link', detail: `${href} -> ${status}` });
      }
    }
  }
  return finding;
}
function ALLOWED_LATIN_TEST(word) {
  return ALLOWED_LATIN.test(word.replace(/[()[\],.:;!?·#%'"]/g, ''));
}

const browser = await chromium.launch();
const findings = [];
try {
  for (const [app, base] of [['business', BIZ], ['admin', ADMIN]]) {
    const screens = SCREENS.filter((s) => s.app === app && !s.redirect);
    for (const lang of ['en', 'ar']) {
      for (const [viewport, size] of [['desktop', { width: 1440, height: 900 }], ['phone', { width: 390, height: 844 }]]) {
        const ctx = await browser.newContext({ viewport: size });
        await ctx.addCookies([{ name: 'lang', value: lang, url: base }]);
        const page = await ctx.newPage();
        const linkCache = new Map();
        for (const s of screens.filter((x) => x.guest)) findings.push({ id: s.id, app, ...(await auditPage(page, base, s.path(ids), lang, viewport, linkCache)) });
        if (app === 'business') await signInBusiness(ctx, account('owner.oud-orchid@'));
        else await signInAdmin(ctx, account('admin.superadmin@'));
        for (const s of screens.filter((x) => !x.guest)) {
          const f = await auditPage(page, base, s.path(ids), lang, viewport, linkCache);
          findings.push({ id: s.id, app, ...f });
          if (f.issues.length) console.log(`${s.id} ${lang} ${viewport}: ${f.issues.map((i) => i.kind).join(', ')}`);
        }
        await ctx.close();
      }
    }
  }
} finally {
  await browser.close();
}
mkdirSync('docs/design-handoff/data', { recursive: true });
writeFileSync(join('docs/design-handoff/data', 'audit-portals.json'), JSON.stringify(findings, null, 2));
const counts = {};
for (const f of findings) for (const i of f.issues) counts[i.kind] = (counts[i.kind] ?? 0) + 1;
console.log(`\n${findings.length} page views audited. Issues by kind: ${JSON.stringify(counts)}`);
