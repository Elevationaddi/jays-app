// Writes apps/api/openapi.json from the implemented controllers and DTOs.
// CI regenerates it and fails if the committed file differs.
import { writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { buildOpenApi, createApp } from '../src/bootstrap.js';
import { testEnv } from '../src/testing/test-env.js';

const env = testEnv();
const app = await createApp({ env, probes: [] });
const document = buildOpenApi(app);
await app.close();
const target = fileURLToPath(new URL('../../openapi.json', import.meta.url));
await writeFile(target, `${JSON.stringify(document, null, 2)}\n`);
console.log(`wrote ${target}`);
