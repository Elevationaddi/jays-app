import { defineConfig } from 'vitest/config';

// Runs against a real PostgreSQL (DATABASE_URL). Started by `pnpm dev:deps` locally, a service in CI.
export default defineConfig({
  test: { include: ['src/**/*.int.test.ts'], testTimeout: 30_000, fileParallelism: false },
});
