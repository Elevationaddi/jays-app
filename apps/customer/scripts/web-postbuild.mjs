// After `expo export --platform web`: on the private staging build (EXPO_PUBLIC_APP_ENV=staging),
// tell search engines to stay away (ADR-0035). Production builds are left indexable.
// Usage: node scripts/web-postbuild.mjs [distDir]
import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

const dist = process.argv[2] ?? 'dist';
const staging = process.env['EXPO_PUBLIC_APP_ENV'] === 'staging';

if (staging) {
  await writeFile(join(dist, 'robots.txt'), 'User-agent: *\nDisallow: /\n');
  const indexPath = join(dist, 'index.html');
  const html = await readFile(indexPath, 'utf8');
  if (!html.includes('name="robots"')) {
    await writeFile(
      indexPath,
      html.replace('<head>', '<head><meta name="robots" content="noindex, nofollow" />'),
    );
  }
  console.log('Staging web build: robots.txt disallows everything; index.html has noindex.');
} else {
  console.log('Not a staging build: robots rules unchanged.');
}
