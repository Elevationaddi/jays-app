import swc from 'unplugin-swc';
import { defineConfig } from 'vitest/config';

// SWC emits decorator metadata, which Nest's dependency injection needs (esbuild does not).
export default defineConfig({
  plugins: [swc.vite({ module: { type: 'es6' } })],
  test: {
    include: ['src/**/*.test.ts'],
    // Integration tests and real-provider tests have their own configs.
    exclude: ['src/**/*.int.test.ts', 'src/**/*.provider.test.ts'],
  },
});
