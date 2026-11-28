// Read load test for the public catalog and booking endpoints (docs/10-build-plan.md: p95 read
// under 500 ms at pilot load). Discovers ids from the API, then runs CONCURRENCY virtual users
// for DURATION_S seconds and reports latency percentiles per endpoint.
//   API_URL (default http://localhost:3000/v1), CONCURRENCY (20), DURATION_S (30), P95_TARGET_MS (500)
// Exits 1 when the overall p95 is above the target or any request fails.
const API = (process.env.API_URL ?? 'http://localhost:3000/v1').replace(/\/$/, '');
const CONCURRENCY = Number(process.env.CONCURRENCY ?? 20);
const DURATION_S = Number(process.env.DURATION_S ?? 30);
const TARGET = Number(process.env.P95_TARGET_MS ?? 500);

async function json(path) {
  const res = await fetch(`${API}${path}`);
  if (!res.ok) throw new Error(`${path}: ${res.status}`);
  return res.json();
}

function dubaiDate(offsetDays) {
  return new Date(Date.now() + 4 * 3_600_000 + offsetDays * 86_400_000).toISOString().slice(0, 10);
}

// Discovery: real ids from the seeded catalog.
const products = (await json('/products?limit=20')).items;
const stores = (await json('/stores')).items;
if (!products.length || !stores.length)
  throw new Error('no published products or stores; run pnpm db:seed');
const targets = [
  { name: 'GET /products', path: () => '/products?limit=20' },
  { name: 'GET /products?q', path: () => '/products?limit=20&q=oud' },
  { name: 'GET /products/:id', path: () => `/products/${pick(products).id}` },
  { name: 'GET /categories', path: () => '/categories' },
  { name: 'GET /stores', path: () => '/stores' },
  { name: 'GET /stores/:id', path: () => `/stores/${pick(stores).id}` },
];
const venueIds = stores.filter((s) => s.modes.includes('services')).map((s) => s.id);
const slots = [];
for (const id of venueIds) {
  const venue = await json(`/venues/${id}`);
  for (const branch of venue.branches ?? []) {
    for (const service of venue.services ?? [])
      slots.push({ branchId: branch.id, serviceId: service.id });
  }
}
if (venueIds.length)
  targets.push({ name: 'GET /venues/:id', path: () => `/venues/${pick(venueIds)}` });
if (slots.length) {
  targets.push({
    name: 'GET /availability',
    path: () => {
      const s = pick(slots);
      return `/availability?branchId=${s.branchId}&serviceId=${s.serviceId}&date=${dubaiDate(1 + Math.floor(Math.random() * 7))}`;
    },
  });
}

function pick(list) {
  return list[Math.floor(Math.random() * list.length)];
}

const samples = new Map(targets.map((t) => [t.name, []]));
const failures = new Map();
const deadline = Date.now() + DURATION_S * 1000;

async function user() {
  while (Date.now() < deadline) {
    const t = pick(targets);
    const path = t.path();
    const start = performance.now();
    try {
      const res = await fetch(`${API}${path}`);
      await res.arrayBuffer();
      // 400 on availability can mean a service the branch does not offer; anything else is a failure.
      if (!res.ok && !(res.status === 400 && t.name === 'GET /availability')) {
        failures.set(`${t.name} ${res.status}`, (failures.get(`${t.name} ${res.status}`) ?? 0) + 1);
      }
    } catch (error) {
      failures.set(
        `${t.name} ${error.code ?? 'error'}`,
        (failures.get(`${t.name} error`) ?? 0) + 1,
      );
    }
    samples.get(t.name).push(performance.now() - start);
  }
}

const pct = (sorted, p) =>
  sorted[Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1)] ?? 0;
const began = Date.now();
await Promise.all(Array.from({ length: CONCURRENCY }, user));
const seconds = (Date.now() - began) / 1000;

const all = [];
console.log(`${CONCURRENCY} virtual users for ${DURATION_S}s against ${API}\n`);
console.log(
  'endpoint'.padEnd(22),
  'count'.padStart(7),
  'p50'.padStart(8),
  'p95'.padStart(8),
  'p99'.padStart(8),
  'max'.padStart(8),
);
for (const [name, list] of samples) {
  const s = [...list].sort((a, b) => a - b);
  all.push(...s);
  console.log(
    name.padEnd(22),
    String(s.length).padStart(7),
    ...[50, 95, 99, 100].map((p) => `${pct(s, p).toFixed(0)}ms`.padStart(8)),
  );
}
all.sort((a, b) => a - b);
const p95 = pct(all, 95);
const failed = [...failures.values()].reduce((a, b) => a + b, 0);
console.log(
  `\noverall: ${all.length} requests, ${(all.length / seconds).toFixed(0)} req/s, p50 ${pct(all, 50).toFixed(0)}ms, p95 ${p95.toFixed(0)}ms (target ${TARGET}ms), failures ${failed}`,
);
for (const [k, v] of failures) console.log(`  failed: ${k} x${v}`);
process.exit(p95 > TARGET || failed > 0 ? 1 : 0);
