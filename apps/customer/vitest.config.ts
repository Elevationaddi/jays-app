import { defineConfig } from 'vitest/config';

// Unit tests cover plain TypeScript only; React Native component tests arrive with real screens.
export default defineConfig({ test: { include: ['src/**/*.test.ts'] } });
