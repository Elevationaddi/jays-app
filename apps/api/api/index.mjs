// Vercel function entry (ADR-0033): every request is rewritten here by vercel.json. The compiled
// Nest application is built by `pnpm --filter @jays/api build` before Vercel bundles this file.
export { default } from '../dist/src/vercel.js';
