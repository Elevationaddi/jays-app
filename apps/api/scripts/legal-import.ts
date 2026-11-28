// Loads the draft legal documents in docs/legal/drafts into the database as version 1 drafts,
// for kinds that have no version yet. With --publish it also publishes those drafts, which is
// refused in production until a UAE lawyer has reviewed them (ADR-0028).
// Usage: pnpm --filter @jays/api legal:import [--publish]
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createDb } from '@jays/db';
import { LEGAL_DOCUMENT_KINDS, LEGAL_REVIEW_COMPLETE } from '@jays/domain';
import pg from 'pg';
import { scriptEnv } from './script-env.js';

const env = scriptEnv();
const publish = process.argv.includes('--publish');
if (publish && env.APP_ENV === 'production' && !LEGAL_REVIEW_COMPLETE) {
  console.error('Refusing to publish legal drafts in production before legal review.');
  process.exit(1);
}
const root = join(dirname(fileURLToPath(import.meta.url)), '../../../../docs/legal/drafts');

function read(kind: string, locale: 'en' | 'ar') {
  const text = readFileSync(join(root, `${kind}.${locale}.md`), 'utf8').trim();
  const [first, ...rest] = text.split('\n');
  if (!first?.startsWith('# ')) throw new Error(`${kind}.${locale}.md must start with a # title`);
  return { title: first.slice(2).trim(), body: rest.join('\n').trim() };
}

const db = createDb(new pg.Pool({ connectionString: env.DATABASE_URL, max: 1 }));
try {
  for (const kind of LEGAL_DOCUMENT_KINDS) {
    const exists = await db
      .selectFrom('legal_documents')
      .select('id')
      .where('kind', '=', kind)
      .executeTakeFirst();
    if (exists) {
      console.log(`${kind}: already has versions, skipped`);
      continue;
    }
    const en = read(kind, 'en');
    const ar = read(kind, 'ar');
    const now = new Date();
    await db
      .insertInto('legal_documents')
      .values({
        kind,
        version: 1,
        title: JSON.stringify({ en: en.title, ar: ar.title }),
        body: JSON.stringify({ en: en.body, ar: ar.body }),
        summary_of_changes: 'First draft for legal review.',
        ...(publish ? { status: 'published', effective_at: now, published_at: now } : {}),
      })
      .execute();
    console.log(`${kind}: version 1 ${publish ? 'published (draft for legal review)' : 'drafted'}`);
  }
} finally {
  await db.destroy();
}
