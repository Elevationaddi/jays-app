import swc from 'unplugin-swc';
import { defineConfig } from 'vitest/config';

// Integration files share one database and run in parallel, each with its own test clock. Some
// files must not overlap with the rest, so they run in a second group once the others finish:
// - reconciliation moves its clock a day ahead and then creates holds, and creating a hold
//   expires every hold that is overdue by that clock, including other files' fresh holds;
// - weekly payouts pays every business, which would race the payout tests;
// - legal documents publishes a merchant agreement, which every business would have to accept.
const SEQUENTIAL = [
  'src/finance/reconciliation.int.test.ts',
  'src/finance/weekly-payouts.int.test.ts',
  'src/legal/legal.int.test.ts',
];

export default defineConfig({
  plugins: [swc.vite({ module: { type: 'es6' } })],
  test: {
    testTimeout: 30_000,
    projects: [
      {
        extends: true,
        test: {
          name: 'integration',
          include: ['src/**/*.int.test.ts'],
          exclude: SEQUENTIAL,
          sequence: { groupOrder: 0 },
        },
      },
      {
        extends: true,
        test: {
          name: 'sequential',
          include: SEQUENTIAL,
          sequence: { groupOrder: 1 },
          fileParallelism: false,
        },
      },
    ],
  },
});
