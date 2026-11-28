// Shrinks a UI screenshot in place: 8-bit palette PNG (about 75% smaller; flat UI keeps its look).
import { createRequire } from 'node:module';
import { writeFileSync } from 'node:fs';

const sharp = createRequire(new URL('../../apps/api/package.json', import.meta.url))('sharp');

export async function optimizePng(file) {
  const out = await sharp(file).png({ palette: true, quality: 90, effort: 7, compressionLevel: 9 }).toBuffer();
  writeFileSync(file, out);
}
