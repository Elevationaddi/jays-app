import type { Db } from '@jays/db';
import type { Transaction } from 'kysely';
import type { Database } from '@jays/db';

export interface AuditEntry {
  actorType: 'user' | 'admin' | 'system';
  actorId: string | null;
  action: string;
  targetType: string;
  targetId?: string | null;
  businessId?: string | null;
  reason?: string | null;
  /** Before/after of changed fields. Never include secrets or full personal data. */
  diff?: Record<string, unknown> | null;
  requestId?: string | null;
}

/** Writes an audit entry, normally inside the transaction that made the change. */
export async function writeAudit(db: Db | Transaction<Database>, entry: AuditEntry): Promise<void> {
  await db
    .insertInto('audit_logs')
    .values({
      actor_type: entry.actorType,
      actor_id: entry.actorId,
      action: entry.action,
      target_type: entry.targetType,
      target_id: entry.targetId ?? null,
      business_id: entry.businessId ?? null,
      reason: entry.reason ?? null,
      redacted_diff: entry.diff ? JSON.stringify(entry.diff) : null,
      request_id: entry.requestId ?? null,
    })
    .execute();
}
