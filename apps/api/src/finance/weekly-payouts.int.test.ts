import { sql } from 'kysely';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { FinanceScheduler } from './finance-scheduler.js';
import { type Harness, startHarness } from '../testing/harness.js';

// Runs in the sequential group (vitest.integration.config.ts): a payout run pays every business,
// so it must not race the payout tests in other files.
let h: Harness;
beforeAll(async () => {
  h = await startHarness();
});
afterAll(async () => {
  await h.close();
});

describe('weekly payouts (D6)', () => {
  it('runs once on the payout weekday', async () => {
    const scheduler = h.app.get(FinanceScheduler);
    // Find the next configured weekday (Monday by default) at 10:00 UAE time.
    let at = new Date(h.clock.now().getTime());
    for (let i = 0; i < 8; i++) {
      const uae = new Date(at.getTime() + 4 * 3_600_000);
      if (uae.getUTCDay() === 1) break;
      at = new Date(at.getTime() + 86_400_000);
    }
    const uaeDay = new Date(at.getTime() + 4 * 3_600_000).toISOString().slice(0, 10);
    const runAt = new Date(`${uaeDay}T06:00:00Z`); // 10:00 in the UAE
    await h.db
      .deleteFrom('payout_runs')
      .where('scheduled_for', '=', sql<Date>`${uaeDay}::date`)
      .execute();
    const notMonday = new Date(runAt.getTime() + 86_400_000);
    expect(await scheduler.weeklyPayouts(notMonday)).toBeNull();
    const first = await scheduler.weeklyPayouts(runAt);
    expect(first).not.toBeNull();
    expect(await scheduler.weeklyPayouts(new Date(runAt.getTime() + 3_600_000))).toBeNull();
    const row = await h.db
      .selectFrom('payout_runs')
      .selectAll()
      .where('scheduled_for', '=', sql<Date>`${uaeDay}::date`)
      .executeTakeFirstOrThrow();
    expect(row.finished_at).not.toBeNull();
  });
});
