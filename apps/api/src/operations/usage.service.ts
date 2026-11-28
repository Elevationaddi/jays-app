import { Inject, Injectable } from '@nestjs/common';
import type { PlatformUsage } from '@jays/contracts';
import type { Db } from '@jays/db';
import { FREE_TIER_LIMITS } from '@jays/domain';
import { sql } from 'kysely';
import { CLOCK, type Clock } from '../common/clock.js';
import { DB } from '../common/tokens.js';
import { EMAIL_BUDGET, type EmailBudget } from '../notify/email-budget.js';

/**
 * Free-tier usage for the admin dashboard (ADR-0024, ADR-0033): database size, stored files and
 * email against the plan limits, so the team sees a limit coming before a provider refuses work.
 * File sizes come from the API's own records of accepted files, not from a call to Supabase.
 */
@Injectable()
export class UsageService {
  constructor(
    @Inject(DB) private readonly db: Db,
    @Inject(EMAIL_BUDGET) private readonly email: EmailBudget,
    @Inject(CLOCK) private readonly clock: Clock,
  ) {}

  async usage(): Promise<PlatformUsage> {
    const { rows } = await sql<{ database: string; files: string }>`
      SELECT
        pg_database_size(current_database())::text AS database,
        (
          coalesce((SELECT sum(size_bytes) FROM verification_documents), 0) +
          coalesce((SELECT sum(size_bytes) FROM media), 0) +
          coalesce((SELECT sum(size_bytes) FROM ticket_attachments), 0)
        )::text AS files`.execute(this.db);
    const email = await this.email.usage();
    return {
      databaseBytes: {
        used: Number(rows[0]?.database ?? 0),
        limit: FREE_TIER_LIMITS.databaseBytes,
      },
      storageBytes: { used: Number(rows[0]?.files ?? 0), limit: FREE_TIER_LIMITS.storageBytes },
      emailsToday: { used: email.day.sent, limit: email.day.limit },
      emailsThisMonth: { used: email.month.sent, limit: email.month.limit },
      warnAt: FREE_TIER_LIMITS.warnAt,
      checkedAt: this.clock.now().toISOString(),
    };
  }
}
