// Writes apps/api/openapi.json from the implemented controllers and DTOs.
// CI regenerates it and fails if the committed file differs.
import { writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { parseEnv, apiEnvSchema } from '@jays/config';
import { buildOpenApi, createApp } from '../src/bootstrap.js';

const env = parseEnv(apiEnvSchema, {
  APP_ENV: 'test',
  DATABASE_URL: 'postgresql://unused@localhost/unused',
  REDIS_URL: 'redis://localhost:6379',
  JWT_KEYS: 'local-dev-only-openapi-generation-000000',
  STORAGE_BUCKET: 'unused',
  PSP_WEBHOOK_SECRET: 'local-dev-only-openapi',
});
const app = await createApp({ env, probes: [] });
const document = buildOpenApi(app);
await app.close();
const target = fileURLToPath(new URL('../../openapi.json', import.meta.url));
await writeFile(target, `${JSON.stringify(document, null, 2)}\n`);
console.log(`wrote ${target}`);
