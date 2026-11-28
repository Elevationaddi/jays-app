import { HttpStatus, Inject, Injectable } from '@nestjs/common';
import type { AdminEmirate } from '@jays/contracts';
import type { Db } from '@jays/db';
import { sql } from 'kysely';
import { writeAudit } from '../common/audit.js';
import { ApiError } from '../common/error.filter.js';
import type { RequestMeta } from '../common/request-context.js';
import { DB } from '../common/tokens.js';

/**
 * Marketplace operations by emirate (D11; ADR-0020). Switching an emirate off stops new
 * addresses, delivery and bookings there; existing orders and appointments are not touched.
 * Categories are switched on and off from the taxonomy screen, businesses by suspension.
 */
@Injectable()
export class OperationsService {
  constructor(@Inject(DB) private readonly db: Db) {}

  async emirates(): Promise<{ items: AdminEmirate[] }> {
    const rows = await this.db
      .selectFrom('emirates as e')
      .select([
        'e.code',
        'e.name',
        'e.enabled',
        sql<number>`(SELECT count(*) FROM branches b
                      WHERE b.emirate_code = e.code AND b.status = 'active')::int`.as('branches'),
        sql<number>`(SELECT count(*) FROM users u
                      WHERE u.emirate_code = e.code AND u.deleted_at IS NULL)::int`.as('customers'),
      ])
      .orderBy('e.sort_order')
      .execute();
    return {
      items: rows.map((r) => ({
        code: r.code as AdminEmirate['code'],
        name: r.name as { en: string; ar: string },
        enabled: r.enabled,
        branches: Number(r.branches),
        customers: Number(r.customers),
      })),
    };
  }

  async setEmirate(adminId: string, code: string, enabled: boolean, meta: RequestMeta) {
    await this.db.transaction().execute(async (trx) => {
      const before = await trx
        .selectFrom('emirates')
        .select(['id', 'enabled'])
        .where('code', '=', code)
        .forUpdate()
        .executeTakeFirst();
      if (!before) throw new ApiError(HttpStatus.NOT_FOUND, 'NOT_FOUND', 'Not found.');
      if (before.enabled === enabled) return;
      await trx.updateTable('emirates').set({ enabled }).where('code', '=', code).execute();
      await writeAudit(trx, {
        actorType: 'admin',
        actorId: adminId,
        action: enabled ? 'emirate.enabled' : 'emirate.disabled',
        targetType: 'emirate',
        targetId: before.id,
        diff: { code, enabled },
        requestId: meta.requestId,
      });
    });
    return this.emirates();
  }
}
