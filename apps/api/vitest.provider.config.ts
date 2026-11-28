import swc from 'unplugin-swc';
import { defineConfig } from 'vitest/config';

// Tests against real providers' test modes (ADR-0030). Each file skips itself without its key.
export default defineConfig({
  plugins: [swc.vite({ module: { type: 'es6' } })],
  test: { include: ['src/**/*.provider.test.ts'], testTimeout: 60_000 },
});
