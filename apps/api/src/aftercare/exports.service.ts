import { Inject, Injectable } from '@nestjs/common';
import type { ExportQuery } from '@jays/contracts';
import type { Db } from '@jays/db';
import { sql } from 'kysely';
import { writeAudit } from '../common/audit.js';
import { CLOCK, type Clock } from '../common/clock.js';
import type { RequestMeta } from '../common/request-context.js';
import { DB } from '../common/tokens.js';
import { resolveRange } from './dashboards.service.js';

export type ExportKind = 'payments' | 'refunds' | 'payouts' | 'orders' | 'bookings';

const MAX_ROWS = 50_000;

/** RFC 4180 field; a leading =, +, - or @ is prefixed so spreadsheets never run it as a formula. */
export function csvField(value: unknown): string {
  if (value === null || value === undefined) return '';
  let s = value instanceof Date ? value.toISOString() : String(value);
  if (/^[=+\-@\t\r]/.test(s) && !/^-?\d+(\.\d+)?$/.test(s)) s = `'${s}`;
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function toCsv(header: string[], rows: unknown[][]): string {
  return [header, ...rows].map((r) => r.map(csvField).join(',')).join('\r\n') + '\r\n';
}

const aed = (fils: number | string | null) =>
  fils === null ? '' : (Number(fils) / 100).toFixed(2);
const en = (v: unknown) => (v as { en?: string } | null)?.en ?? '';

/**
 * CSV exports (docs/04-admin.md; ADR-0016). Exports carry ids, amounts and statuses, never
 * customer contact details or addresses (PII stays in the product). Every export is audited with
 * who ran it, what and for which dates. A range is capped at 366 days and 50,000 rows.
 */
@Injectable()
export class ExportsService {
  constructor(
    @Inject(DB) private readonly db: Db,
    @Inject(CLOCK) private readonly clock: Clock,
  ) {}

  async admin(adminId: string, kind: ExportKind, query: ExportQuery, meta: RequestMeta) {
    const r = resolveRange(query, this.clock.now());
    const { header, rows } = await this.build(kind, r.start, r.end);
    await writeAudit(this.db, {
      actorType: 'admin',
      actorId: adminId,
      action: 'export.created',
      targetType: 'export',
      diff: { kind, from: r.from, to: r.to, rows: rows.length },
      requestId: meta.requestId,
    });
    return { filename: `jays-${kind}-${r.from}-to-${r.to}.csv`, csv: toCsv(header, rows) };
  }

  /** A business's statement: what each paid suborder or booking earned, with refunds and fees. */
  async businessStatement(
    businessId: string,
    userId: string,
    query: ExportQuery,
    meta: RequestMeta,
  ) {
    const r = resolveRange(query, this.clock.now());
    const rows = await this.db
      .selectFrom('merchant_earnings')
      .select([
        'id',
        'created_at',
        'source_type',
        'merchant_order_id',
        'booking_id',
        'gross_fils',
        'commission_bps',
        'commission_fils',
        'refunded_fils',
        'commission_refunded_fils',
        'status',
        'eligible_at',
        'payout_id',
      ])
      .where('business_id', '=', businessId)
      .where('created_at', '>=', r.start)
      .where('created_at', '<', r.end)
      .orderBy('created_at')
      .orderBy('id')
      .limit(MAX_ROWS)
      .execute();
    await writeAudit(this.db, {
      actorType: 'user',
      actorId: userId,
      action: 'export.created',
      targetType: 'export',
      businessId,
      diff: { kind: 'statement', from: r.from, to: r.to, rows: rows.length },
      requestId: meta.requestId,
    });
    const header = [
      'earning_id',
      'created_at',
      'source',
      'suborder_id',
      'booking_id',
      'gross_aed',
      'commission_rate_pct',
      'commission_aed',
      'refunded_aed',
      'commission_refunded_aed',
      'net_aed',
      'status',
      'eligible_at',
      'payout_id',
    ];
    return {
      filename: `statement-${r.from}-to-${r.to}.csv`,
      csv: toCsv(
        header,
        rows.map((e) => [
          e.id,
          e.created_at,
          e.source_type,
          e.merchant_order_id,
          e.booking_id,
          aed(e.gross_fils),
          (e.commission_bps / 100).toFixed(2),
          aed(e.commission_fils),
          aed(e.refunded_fils),
          aed(e.commission_refunded_fils),
          aed(e.gross_fils - e.refunded_fils - (e.commission_fils - e.commission_refunded_fils)),
          e.status,
          e.eligible_at,
          e.payout_id,
        ]),
      ),
    };
  }

  private async build(kind: ExportKind, start: Date, end: Date) {
    switch (kind) {
      case 'payments': {
        const rows = await this.db
          .selectFrom('payments')
          .select([
            'id',
            'created_at',
            'succeeded_at',
            'target_type',
            'order_id',
            'booking_id',
            'amount_fils',
            'status',
            'needs_attention',
            'reconciled_at',
          ])
          .where('created_at', '>=', start)
          .where('created_at', '<', end)
          .orderBy('created_at')
          .limit(MAX_ROWS)
          .execute();
        return {
          header: [
            'payment_id',
            'created_at',
            'succeeded_at',
            'target',
            'order_id',
            'booking_id',
            'amount_aed',
            'status',
            'needs_attention',
            'reconciled_at',
          ],
          rows: rows.map((p) => [
            p.id,
            p.created_at,
            p.succeeded_at,
            p.target_type,
            p.order_id,
            p.booking_id,
            aed(p.amount_fils),
            p.status,
            p.needs_attention,
            p.reconciled_at,
          ]),
        };
      }
      case 'refunds': {
        const rows = await this.db
          .selectFrom('refunds')
          .select([
            'id',
            'created_at',
            'updated_at',
            'payment_id',
            'merchant_order_id',
            'return_request_id',
            'reason',
            'amount_fils',
            'status',
            'failure_code',
          ])
          .where('created_at', '>=', start)
          .where('created_at', '<', end)
          .orderBy('created_at')
          .limit(MAX_ROWS)
          .execute();
        return {
          header: [
            'refund_id',
            'created_at',
            'updated_at',
            'payment_id',
            'suborder_id',
            'return_id',
            'reason',
            'amount_aed',
            'status',
            'failure_code',
          ],
          rows: rows.map((f) => [
            f.id,
            f.created_at,
            f.updated_at,
            f.payment_id,
            f.merchant_order_id,
            f.return_request_id,
            f.reason,
            aed(f.amount_fils),
            f.status,
            f.failure_code,
          ]),
        };
      }
      case 'payouts': {
        const rows = await this.db
          .selectFrom('payouts as p')
          .innerJoin('businesses as b', 'b.id', 'p.business_id')
          .select([
            'p.id',
            'p.created_at',
            'p.business_id',
            'b.display_name',
            'p.amount_fils',
            'p.status',
            'p.paid_at',
            'p.failed_at',
            'p.failure_code',
          ])
          .where('p.created_at', '>=', start)
          .where('p.created_at', '<', end)
          .orderBy('p.created_at')
          .limit(MAX_ROWS)
          .execute();
        return {
          header: [
            'payout_id',
            'created_at',
            'business_id',
            'business',
            'amount_aed',
            'status',
            'paid_at',
            'failed_at',
            'failure_code',
          ],
          rows: rows.map((p) => [
            p.id,
            p.created_at,
            p.business_id,
            en(p.display_name),
            aed(p.amount_fils),
            p.status,
            p.paid_at,
            p.failed_at,
            p.failure_code,
          ]),
        };
      }
      case 'orders': {
        const rows = await this.db
          .selectFrom('merchant_orders as mo')
          .innerJoin('orders as o', 'o.id', 'mo.order_id')
          .innerJoin('businesses as b', 'b.id', 'mo.business_id')
          .select([
            'mo.id',
            'mo.order_id',
            'o.paid_at',
            'mo.business_id',
            'b.display_name',
            'mo.status',
            'mo.subtotal_fils',
            'mo.delivery_fils',
            'mo.discount_fils',
            'mo.tax_fils',
            'mo.total_fils',
            'mo.shipped_at',
            'mo.delivered_at',
            'mo.canceled_at',
            sql<string>`(mo.delivery_snapshot->>'emirate')`.as('emirate'),
          ])
          .where('o.paid_at', '>=', start)
          .where('o.paid_at', '<', end)
          .orderBy('o.paid_at')
          .limit(MAX_ROWS)
          .execute();
        return {
          header: [
            'suborder_id',
            'order_id',
            'paid_at',
            'business_id',
            'business',
            'status',
            'subtotal_aed',
            'delivery_aed',
            'discount_aed',
            'vat_aed',
            'total_aed',
            'shipped_at',
            'delivered_at',
            'canceled_at',
            'emirate',
          ],
          rows: rows.map((m) => [
            m.id,
            m.order_id,
            m.paid_at,
            m.business_id,
            en(m.display_name),
            m.status,
            aed(m.subtotal_fils),
            aed(m.delivery_fils),
            aed(m.discount_fils),
            aed(m.tax_fils),
            aed(m.total_fils),
            m.shipped_at,
            m.delivered_at,
            m.canceled_at,
            m.emirate,
          ]),
        };
      }
      case 'bookings': {
        const rows = await this.db
          .selectFrom('bookings as bk')
          .innerJoin('businesses as b', 'b.id', 'bk.business_id')
          .select([
            'bk.id',
            'bk.created_at',
            'bk.start_at',
            'bk.business_id',
            'b.display_name',
            'bk.branch_id',
            'bk.service_id',
            'bk.status',
            'bk.source',
            'bk.payment_mode',
            'bk.price_fils',
            'bk.tax_fils',
          ])
          .where('bk.start_at', '>=', start)
          .where('bk.start_at', '<', end)
          .where('bk.status', 'not in', ['held', 'expired'])
          .orderBy('bk.start_at')
          .limit(MAX_ROWS)
          .execute();
        return {
          header: [
            'booking_id',
            'created_at',
            'start_at',
            'business_id',
            'business',
            'branch_id',
            'service_id',
            'status',
            'source',
            'payment_mode',
            'price_aed',
            'vat_aed',
          ],
          rows: rows.map((b) => [
            b.id,
            b.created_at,
            b.start_at,
            b.business_id,
            en(b.display_name),
            b.branch_id,
            b.service_id,
            b.status,
            b.source,
            b.payment_mode,
            aed(b.price_fils),
            aed(b.tax_fils),
          ]),
        };
      }
    }
  }
}
