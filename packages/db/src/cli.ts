import { databaseEnvSchema, parseEnv } from '@jays/config';
import pg from 'pg';
import { loadMigrations, runMigrations } from './migrations.js';

const env = parseEnv(databaseEnvSchema, process.env);
const client = new pg.Client({ connectionString: env.DATABASE_URL });
await client.connect();
try {
  const applied = await runMigrations(client, await loadMigrations(), {
    log: (message) => console.log(message),
  });
  console.log(
    applied.length === 0 ? 'database is up to date' : `applied ${applied.length} migration(s)`,
  );
} finally {
  await client.end();
}
