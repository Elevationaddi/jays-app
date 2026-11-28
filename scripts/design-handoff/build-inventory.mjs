// Builds the screen inventory for the design handoff from the code itself.
//   node scripts/design-handoff/build-inventory.mjs
// Reads scripts/design-handoff/screens.mjs (hand-written purpose, users, journeys) and, for each
// screen, the page or screen component plus the server actions and local components it imports.
// Writes docs/design-handoff/data/screens.json and docs/design-handoff/screen-inventory.csv.
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { catalogs } from '../../packages/i18n/dist/index.js';
import { JOURNEYS, SCREENS } from './screens.mjs';

const ROOT = resolve(new URL('../..', import.meta.url).pathname);
const OUT = join(ROOT, 'docs/design-handoff');
const en = catalogs.en;
const ar = catalogs.ar;
const read = (f) => readFileSync(f, 'utf8');
const rel = (f) => relative(ROOT, f);

// --- API client: method name -> HTTP method and path ------------------------------------------
const clientSrc = read(join(ROOT, 'packages/api-client/src/index.ts'));
const API = {};
{
  const body = clientSrc.slice(clientSrc.indexOf('return {', clientSrc.indexOf('export function createApiClient')));
  const entries = body.split(/\n {4}(?=[a-zA-Z]+: )/);
  for (const entry of entries) {
    const name = /^([a-zA-Z]+): /.exec(entry)?.[1];
    if (!name) continue;
    const m = /call\(\s*'([A-Z]+)',\s*(`[^`]*`|'[^']*')/.exec(entry);
    const d = /download\(\s*(`[^`]*`|'[^']*')/.exec(entry);
    const raw = m?.[2] ?? d?.[1];
    if (!raw) continue;
    const path = raw
      .slice(1, -1)
      .replace(/\$\{biz\((\w+)\)\}/g, '/businesses/{businessId}')
      .replace(/\$\{(query|q)\([^}]*\)\}/g, '')
      .replace(/\$\{encodeURIComponent\((\w+)\)\}/g, '{$1}')
      .replace(/\$\{(\w+)\}/g, '{$1}');
    API[name] = { method: m?.[1] ?? 'GET', path: `/v1${path}` };
  }
}
const API_NAMES = new Set(Object.keys(API));

// --- Source resolution ---------------------------------------------------------------------
function resolveImport(from, spec) {
  if (!spec.startsWith('.')) return null;
  const base = resolve(dirname(from), spec);
  for (const ext of ['', '.ts', '.tsx', '/index.ts', '/index.tsx']) {
    if (existsSync(base + ext) && !base.endsWith('/') && (ext || /\.(ts|tsx)$/.test(base))) return base + ext;
  }
  return null;
}
function importsOf(file) {
  const src = read(file);
  const out = [];
  for (const m of src.matchAll(/import\s+(?:type\s+)?\{([^}]*)\}\s+from\s+'([^']+)'/g)) {
    out.push({ names: m[1].split(',').map((s) => s.replace(/^type\s+/, '').trim().split(/\s+as\s+/)[0]).filter(Boolean), spec: m[2] });
  }
  for (const m of src.matchAll(/import\s+(\w+)\s+from\s+'([^']+)'/g)) out.push({ names: [m[1]], spec: m[2] });
  return out;
}
/** The text of one exported function or component in a file. */
function functionBody(src, name) {
  const re = new RegExp(`export\\s+(?:async\\s+)?function\\s+${name}\\b|export\\s+const\\s+${name}\\b`);
  const m = re.exec(src);
  if (!m) return '';
  const rest = src.slice(m.index + 1);
  const next = rest.search(/\nexport\s/);
  return src.slice(m.index, next === -1 ? undefined : m.index + 1 + next);
}

/** Code that belongs to a screen: its own file and the parts of local modules it uses. */
function screenCode(screen) {
  let file;
  let own;
  if (screen.app === 'customer') {
    const dir = join(ROOT, 'apps/customer/src/screens');
    file = readdirSync(dir)
      .map((f) => join(dir, f))
      .find((f) => new RegExp(`export function ${screen.component}\\b`).test(read(f)));
    own = functionBody(read(file), screen.component);
  } else {
    const appDir = join(ROOT, `apps/${screen.app}/src/app`);
    const route = screen.route === '/' ? '' : screen.route;
    file = join(appDir, route, 'page.tsx');
    own = read(file);
  }
  const parts = [own];
  const used = [];
  const fileSrc = read(file);
  // Local helper functions in the same file (customer screens files hold several components).
  if (screen.app === 'customer') {
    for (const m of fileSrc.matchAll(/\nfunction (\w+)\(/g)) {
      if (own.includes(`<${m[1]}`) || own.includes(`${m[1]}(`)) {
        const start = fileSrc.indexOf(m[0]);
        const end = fileSrc.indexOf('\n}', start);
        parts.push(fileSrc.slice(start, end));
      }
    }
  }
  for (const imp of importsOf(file)) {
    const target = resolveImport(file, imp.spec);
    if (!target || /\/(lib|i18n|locale|format|errors|state|context)\b/.test(target)) continue;
    const src = read(target);
    for (const name of imp.names) {
      if (!own.includes(name)) continue;
      const body = functionBody(src, name);
      if (body) {
        parts.push(body);
        used.push({ name, file: rel(target) });
      }
    }
  }
  return { file: rel(file), code: parts.join('\n'), used };
}

// --- Extraction helpers --------------------------------------------------------------------
const uniq = (xs) => [...new Set(xs.filter(Boolean))];
const keysIn = (code) => uniq([...code.matchAll(/\btr\(\s*[`']([a-zA-Z0-9_.]+)[`'$]/g)].map((m) => m[1]));
const label = (key) => (key && en[key] ? en[key].replace(/\s+/g, ' ') : null);
const labelAr = (key) => (key && ar[key] ? ar[key].replace(/\s+/g, ' ') : null);
function keysFrom(re, code) {
  return uniq([...code.matchAll(re)].map((m) => m[1]));
}

function analyse(screen) {
  const { file, code, used } = screenCode(screen);
  const keys = keysIn(code);
  const api = uniq([...code.matchAll(/\.\s*([a-zA-Z]+)\s*\(/g)].map((m) => m[1]).filter((n) => API_NAMES.has(n)));
  const permissions = uniq([
    ...[...code.matchAll(/myCapabilities\.includes\(\s*'([a-z_.]+)'/g)].map((m) => m[1]),
    ...[...code.matchAll(/(?:can|hasPermission|requirePermission|has)\(\s*[^,)]*,?\s*'([a-z_]+\.[a-z_.]+)'/g)].map((m) => m[1]),
  ]);
  const headings = uniq([
    ...keysFrom(/<h[1-3][^>]*>\s*\{tr\('([^']+)'/g, code),
    ...keysFrom(/<Title>\s*\{tr\('([^']+)'/g, code),
    ...keysFrom(/<legend[^>]*>\s*\{tr\('([^']+)'/g, code),
    ...keysFrom(/title:\s*tr\('([^']+)'/g, code),
  ]).map(label).filter(Boolean);
  const buttons = uniq([
    ...keysFrom(/<button[^>]*>\s*\{tr\('([^']+)'/g, code),
    ...keysFrom(/<Button[^>]*label=\{tr\('([^']+)'/g, code),
    ...keysFrom(/<Button[^>]*>\s*\{tr\('([^']+)'/g, code),
    ...keysFrom(/label=\{tr\('([^']+)'\)\}[^>]*onPress/g, code),
    ...keysFrom(/onPress=[^>]*label=\{tr\('([^']+)'/g, code),
    ...keysFrom(/<Link[^>]*className="button[^"]*"[^>]*>\s*\{tr\('([^']+)'/g, code),
  ]).map(label).filter(Boolean);
  const links = uniq(keysFrom(/<Link[^>]*>\s*\{tr\('([^']+)'/g, code)).map(label).filter(Boolean);
  const fields = uniq([
    ...[...code.matchAll(/<(input|textarea|select)\b([^>]*)>/g)]
      .filter((m) => !/type="hidden"/.test(m[2]))
      .map((m) => /\bname="([a-zA-Z0-9_]+)"/.exec(m[2])?.[1]),
    ...[...code.matchAll(/<Field[^>]*label=\{tr\('([^']+)'/g)].map((m) => label(m[1])),
  ]);
  const fieldTypes = uniq([...code.matchAll(/<input[^>]*\btype="([a-z-]+)"/g)].map((m) => m[1]));
  const selects = (code.match(/<select\b/g) ?? []).length + (code.match(/<Picker\b/g) ?? []).length;
  const forms = (code.match(/<form\b/g) ?? []).length;
  const tables = (code.match(/<table\b/g) ?? []).length;
  const cards = (code.match(/className="[^"]*\bcard\b/g) ?? []).length + (code.match(/<Card\b|ProductCard|styles\.card/g) ?? []).length;
  const lists = (code.match(/className="list"|<FlatList|\.map\(\(/g) ?? []).length;
  const modals = uniq([
    (code.match(/<details\b/g) ?? []).length ? 'expandable panel (details)' : '',
    (code.match(/<dialog\b|<Modal\b/g) ?? []).length ? 'modal dialog' : '',
    /confirm\(/.test(code) ? 'browser confirm dialog' : '',
  ]);
  const validation = uniq([
    ...[...code.matchAll(/\b(required|minLength=\{?\d+|maxLength=\{?\d+|min=\{?[\d"]+|max=\{?[\d"]+|pattern="[^"]+"|step="[^"]+")/g)].map((m) => m[1].replace(/[{"]/g, '')),
    /\.parse\(|safeParse\(/.test(code) ? 'schema validation (Zod) before calling the API' : '',
    /errorMessage|ErrorAlert|error=\{|errorCode|apiError/.test(code) ? 'API errors shown as translated messages' : '',
  ]);
  const states = {
    loading: screen.app === 'customer'
      ? (/ActivityIndicator|loading/.test(code) ? 'Spinner with the "Loading" label while data loads' : 'No explicit loading state')
      : 'Server-rendered: the page arrives with its data (no client loading state); slow responses show the browser progress only',
    empty: uniq(keys.filter((k) => /(empty|none|noResults|nothing|noItems|zero)/i.test(k)).map(label)).join(' / ') || null,
    error: /Banner kind="error"|ErrorAlert|alert error|error=\{query\['error'\]\}|errorMessage|notFound\(\)/.test(code)
      ? uniq([
          /notFound\(\)/.test(code) ? 'Not-found page when the record does not exist or belongs to another business' : '',
          /ErrorAlert|alert error|error=\{query\['error'\]\}/.test(code) ? 'Error banner from the ?error= code after a failed action' : '',
          /Banner kind="error"/.test(code) ? 'Error banner' : '',
        ]).join('; ')
      : null,
    success: uniq(keys.filter((k) => /(saved|success|sent|done|updated|created|submitted|thanks|confirmed\b|added)/i.test(k)).map(label)).slice(0, 6).join(' / ') || null,
    disabled: /disabled=/.test(code) ? 'Some controls are disabled until their conditions are met (see code)' : null,
    confirm: uniq(keys.filter((k) => /confirm/i.test(k)).map(label)).slice(0, 4).join(' / ') || null,
    noAccess: /noAccess|forbidden|myCapabilities/.test(code) ? 'Shows a "no access" notice when the member lacks the permission' : null,
  };
  const search = uniq([
    /name="q"|search\.query|SearchScreen|placeholder=\{tr\('search/.test(code) ? 'text search' : '',
    /name="status"|status=/.test(code) && /select/.test(code) ? 'status filter' : '',
    /name="(from|to)"|type="date"/.test(code) ? 'date range' : '',
    /cursor/.test(code) ? 'pagination (cursor, next page)' : '',
    /sort/i.test(code) ? 'sorting' : '',
    /filters?\b/i.test(code) && screen.app === 'customer' ? 'filters' : '',
  ]);
  const components = uniq([
    ...[...code.matchAll(/<([A-Z][A-Za-z]+)\b/g)].map((m) => m[1]).filter((c) => !['Link', 'View', 'Text', 'Pressable', 'ScrollView', 'Image', 'Fragment', 'TextInput', 'FlatList', 'ActivityIndicator', 'StyleSheet', 'Suspense'].includes(c)),
  ]);
  const classes = uniq([...code.matchAll(/className="([^"]+)"/g)].flatMap((m) => m[1].split(/\s+/))).filter((c) => !/^[A-Z]/.test(c));
  const placeholders = keys.filter((k) => /placeholder|hint/i.test(k)).map(label);
  return {
    file,
    usedModules: used,
    api: api.map((n) => ({ name: n, ...API[n] })),
    permissions,
    headings,
    buttons,
    links,
    fields,
    fieldTypes,
    selects,
    forms,
    tables,
    cards,
    lists,
    modals,
    validation,
    states,
    search,
    components,
    classes,
    placeholders,
    i18nKeys: keys.length,
    i18nSample: keys.slice(0, 8).map((k) => ({ key: k, en: label(k), ar: labelAr(k) })),
    lines: code.split('\n').length,
  };
}

const LAYOUT = {
  customer: 'Phone first (Expo: iOS, Android, web). One column, bottom tab bar (Home, Cart or Appointments, My orders, Account) and the Shop Products / Book Services switch at the top. Web shows the same column centred; no tablet or desktop layout yet.',
  business: 'Desktop and laptop first (Next.js). Top bar, business name, tab navigation across the workspace, one main column of cards, lists and tables. Phone and tablet: the same stacked layout; the tab row wraps and some tables scroll sideways.',
  admin: 'Desktop first (Next.js). Top bar and a navigation list, then a wide main column with filters, tables and detail panels. Not designed for phones; tables scroll sideways.',
};

const screens = SCREENS.map((s) => {
  const base = {
    ...s,
    path: undefined,
    journeyNames: s.journeys.map((j) => `${j} ${JOURNEYS[j]}`),
    layout: LAYOUT[s.app],
    rtl: s.app === 'customer'
      ? 'Arabic follows the device language; the whole layout mirrors (I18nManager / direction rtl). Prices, order numbers and phone numbers stay left-to-right.'
      : 'Arabic is chosen with the language link (cookie "lang"); <html dir="rtl"> mirrors the page. IDs, SKUs, amounts and emails are wrapped as left-to-right (class "ltr").',
    screenshots: s.redirect ? null : {
      en: `screenshots/en/${s.id}-${s.name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')}.png`,
      ar: `screenshots/ar/${s.id}-${s.name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')}.png`,
    },
  };
  try {
    return { ...base, ...analyse(s) };
  } catch (error) {
    return { ...base, file: null, analysisError: String(error.message) };
  }
});

mkdirSync(join(OUT, 'data'), { recursive: true });
writeFileSync(join(OUT, 'data/screens.json'), JSON.stringify({ generatedFrom: 'scripts/design-handoff/build-inventory.mjs', api: API, journeys: JOURNEYS, screens }, null, 2));

// --- CSV ------------------------------------------------------------------------------------
const csvCell = (v) => {
  const s = Array.isArray(v) ? v.join('; ') : v == null ? '' : String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};
const columns = [
  ['Screen ID', (s) => s.id],
  ['Application', (s) => s.app],
  ['Screen name', (s) => s.name],
  ['Route', (s) => s.route],
  ['Source file', (s) => s.file],
  ['Primary user', (s) => s.user],
  ['Permissions', (s) => s.permissions],
  ['Purpose', (s) => s.purpose],
  ['Journeys', (s) => s.journeyNames],
  ['Design priority', (s) => s.priority],
  ['Redirect only', (s) => (s.redirect ? 'yes' : 'no')],
  ['Sections and headings', (s) => s.headings],
  ['Buttons and actions', (s) => s.buttons],
  ['Links', (s) => s.links],
  ['Form count', (s) => s.forms],
  ['Fields', (s) => s.fields],
  ['Input types', (s) => s.fieldTypes],
  ['Dropdowns', (s) => s.selects],
  ['Search and filters', (s) => s.search],
  ['Tables', (s) => s.tables],
  ['Cards', (s) => s.cards],
  ['Modals and panels', (s) => s.modals],
  ['API endpoints', (s) => (s.api ?? []).map((a) => `${a.method} ${a.path}`)],
  ['Validation', (s) => s.validation],
  ['Loading state', (s) => s.states?.loading],
  ['Empty state', (s) => s.states?.empty],
  ['Error state', (s) => s.states?.error],
  ['Success state', (s) => s.states?.success],
  ['Disabled state', (s) => s.states?.disabled],
  ['Confirmations', (s) => s.states?.confirm],
  ['No-access state', (s) => s.states?.noAccess],
  ['Components', (s) => s.components],
  ['Layout (mobile, tablet, desktop)', (s) => s.layout],
  ['Arabic and RTL', (s) => s.rtl],
  ['Translated strings', (s) => s.i18nKeys],
  ['Screenshot (English)', (s) => s.screenshots?.en],
  ['Screenshot (Arabic)', (s) => s.screenshots?.ar],
];
const csv = [columns.map((c) => c[0]).join(','), ...screens.map((s) => columns.map(([, f]) => csvCell(f(s))).join(','))].join('\n');
writeFileSync(join(OUT, 'screen-inventory.csv'), `${csv}\n`);
const failed = screens.filter((s) => s.analysisError);
console.log(`${screens.length} screens, ${Object.keys(API).length} API client methods; ${failed.length} not analysed${failed.length ? `: ${failed.map((f) => `${f.id} (${f.analysisError})`).join(', ')}` : ''}`);
