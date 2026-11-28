import { HttpStatus, Inject, Injectable } from '@nestjs/common';
import type {
  AdminTaxDocumentListQuery,
  BusinessTax,
  BusinessTaxInput,
  TaxDocument,
  TaxDocumentListQuery,
  TaxDocumentSummary,
  VatReport,
  VatReportQuery,
} from '@jays/contracts';
import type { Db } from '@jays/db';
import { PLATFORM_TRN, TAX_RULES_APPROVED } from '@jays/domain';
import { sql } from 'kysely';
import { writeAudit } from '../common/audit.js';
import { CLOCK, type Clock } from '../common/clock.js';
import { ApiError } from '../common/error.filter.js';
import { afterCursor, cursorTs, decodeCursor, toPage } from '../common/pagination.js';
import type { RequestMeta } from '../common/request-context.js';
import { DB } from '../common/tokens.js';
import { setting } from './ledger.js';
import { businessName } from './views.js';

type Localized = { en: string; ar: string };

/** Who is asking: a customer sees their own documents, a business its own, an admin any. */
export type DocumentScope =
  | { kind: 'customer'; userId: string }
  | { kind: 'business'; businessId: string }
  | { kind: 'admin'; businessId?: string };

const notFound = () =>
  new ApiError(HttpStatus.NOT_FOUND, 'NOT_FOUND', 'The document was not found.');

const DAY_MS = 86_400_000;
const CREDIT = sql<boolean>`d.kind IN ('customer_credit_note', 'commission_credit_note')`;
const UAE_OFFSET_MS = 4 * 3_600_000;
/** Midnight at the start of a UAE date, as an instant. */
const uaeMidnight = (date: string) => new Date(Date.parse(`${date}T00:00:00Z`) - UAE_OFFSET_MS);

/**
 * Tax documents, VAT registration and the VAT report (D3, D4; ADR-0021). Documents are issued by
 * the ledger when money moves; this service only reads them and records registration changes.
 */
@Injectable()
export class TaxService {
  constructor(
    @Inject(DB) private readonly db: Db,
    @Inject(CLOCK) private readonly clock: Clock,
  ) {}

  private base() {
    return this.db
      .selectFrom('tax_documents as d')
      .innerJoin('merchant_earnings as e', 'e.id', 'd.earning_id')
      .leftJoin('merchant_orders as mo', 'mo.id', 'e.merchant_order_id')
      .select([
        'd.id',
        'd.kind',
        'd.number',
        'd.issuer',
        'd.business_id',
        'd.customer_user_id',
        'd.tax_document',
        'd.net_fils',
        'd.vat_fils',
        'd.total_fils',
        'd.rules_approved',
        'd.issued_at',
        'mo.order_id',
        'e.booking_id',
      ]);
  }

  private scoped<Q extends ReturnType<TaxService['base']>>(q: Q, scope: DocumentScope): Q {
    if (scope.kind === 'customer') {
      return q
        .where('d.customer_user_id', '=', scope.userId)
        .where('d.kind', 'in', ['customer_invoice', 'customer_credit_note']) as Q;
    }
    if (scope.kind === 'business') return q.where('d.business_id', '=', scope.businessId) as Q;
    return scope.businessId ? (q.where('d.business_id', '=', scope.businessId) as Q) : q;
  }

  async list(scope: DocumentScope, query: TaxDocumentListQuery | AdminTaxDocumentListQuery) {
    const key = decodeCursor(query.cursor);
    let q = this.scoped(this.base(), scope).select(cursorTs('d.issued_at').as('cursor_ts'));
    if (query.kind) q = q.where('d.kind', '=', query.kind);
    if (query.orderId) q = q.where('mo.order_id', '=', query.orderId);
    if (query.bookingId) q = q.where('e.booking_id', '=', query.bookingId);
    if (key) q = q.where(afterCursor('d.issued_at', 'd.id', key, 'desc'));
    const rows = await q
      .orderBy('d.issued_at', 'desc')
      .orderBy('d.id', 'desc')
      .limit(query.limit + 1)
      .execute();
    return toPage(rows, query.limit, summaryView);
  }

  async get(scope: DocumentScope, id: string): Promise<TaxDocument> {
    const row = await this.scoped(this.base(), scope)
      .innerJoin('tax_documents as full', 'full.id', 'd.id')
      .leftJoin('tax_documents as orig', 'orig.id', 'd.credits_document_id')
      .select([
        'full.seller',
        'full.buyer',
        'full.lines',
        'orig.id as orig_id',
        'orig.number as orig_number',
      ])
      .where('d.id', '=', id)
      .executeTakeFirst();
    if (!row) throw notFound();
    return {
      ...summaryView(row),
      currency: 'AED',
      seller: row.seller,
      buyer: row.buyer,
      lines: row.lines,
      credits: row.orig_id && row.orig_number ? { id: row.orig_id, number: row.orig_number } : null,
    };
  }

  async businessTax(businessId: string): Promise<BusinessTax> {
    const b = await this.db
      .selectFrom('businesses')
      .select(['id', 'tax_registered', 'tax_id'])
      .where('id', '=', businessId)
      .executeTakeFirst();
    if (!b) {
      throw new ApiError(HttpStatus.NOT_FOUND, 'NOT_FOUND', 'The business was not found.');
    }
    return { businessId: b.id, taxRegistered: b.tax_registered, taxId: b.tax_id };
  }

  /**
   * Records a seller's VAT registration (D4), for example after it registers once approved. It
   * changes VAT on sales from now on; documents already issued keep what they said.
   */
  async setBusinessTax(
    adminId: string,
    businessId: string,
    input: BusinessTaxInput,
    meta: RequestMeta,
  ): Promise<BusinessTax> {
    const before = await this.businessTax(businessId);
    await this.db.transaction().execute(async (trx) => {
      await trx
        .updateTable('businesses')
        .set({ tax_registered: input.taxRegistered, tax_id: input.taxId })
        .where('id', '=', businessId)
        .execute();
      await writeAudit(trx, {
        actorType: 'admin',
        actorId: adminId,
        action: 'finance.business_tax_changed',
        targetType: 'business',
        targetId: businessId,
        businessId,
        reason: input.reason,
        diff: {
          before: { taxRegistered: before.taxRegistered, taxId: before.taxId },
          after: { taxRegistered: input.taxRegistered, taxId: input.taxId },
        },
        requestId: meta.requestId,
      });
    });
    return this.businessTax(businessId);
  }

  /**
   * Totals by issuer for a period of UAE dates. The platform's figures are its own VAT on
   * commission; each business's figures support its own return, which it files as the seller.
   */
  async vatReport(query: VatReportQuery): Promise<VatReport> {
    const from = uaeMidnight(query.from);
    const to = new Date(uaeMidnight(query.to).getTime() + DAY_MS);
    if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime()) || to <= from) {
      throw new ApiError(HttpStatus.BAD_REQUEST, 'VALIDATION_FAILED', 'Check the dates.', {
        to: ['must be on or after from'],
      });
    }
    if (to.getTime() - from.getTime() > 367 * DAY_MS) {
      throw new ApiError(HttpStatus.BAD_REQUEST, 'VALIDATION_FAILED', 'At most a year at a time.', {
        to: ['at most a year after from'],
      });
    }
    const rows = await this.db
      .selectFrom('tax_documents as d')
      .select([
        'd.issuer',
        'd.business_id',
        CREDIT.as('credit'),
        sql<string>`sum(d.net_fils)`.as('net'),
        sql<string>`sum(d.vat_fils)`.as('vat'),
        sql<string>`sum(d.total_fils)`.as('total'),
        sql<string>`count(*)`.as('n'),
      ])
      .where('d.issued_at', '>=', from)
      .where('d.issued_at', '<', to)
      .groupBy(['d.issuer', 'd.business_id', CREDIT])
      .execute();
    const empty = () => ({ netFils: 0, vatFils: 0, totalFils: 0, documents: 0 });
    const add = (t: ReturnType<typeof empty>, r: (typeof rows)[number]) => {
      t.netFils += Number(r.net);
      t.vatFils += Number(r.vat);
      t.totalFils += Number(r.total);
      t.documents += Number(r.n);
    };
    const platform = { invoiced: empty(), credited: empty() };
    const byBusiness = new Map<
      string,
      { invoiced: ReturnType<typeof empty>; credited: ReturnType<typeof empty> }
    >();
    for (const r of rows) {
      if (r.issuer === 'platform') {
        add(r.credit ? platform.credited : platform.invoiced, r);
        continue;
      }
      const b = byBusiness.get(r.business_id) ?? { invoiced: empty(), credited: empty() };
      add(r.credit ? b.credited : b.invoiced, r);
      byBusiness.set(r.business_id, b);
    }
    const ids = [...byBusiness.keys()];
    const businesses = ids.length
      ? await this.db
          .selectFrom('businesses as b')
          .leftJoin('storefronts as sf', 'sf.business_id', 'b.id')
          .select(['b.id', 'b.display_name', 'sf.live_name', 'b.tax_registered', 'b.tax_id'])
          .where('b.id', 'in', ids)
          .execute()
      : [];
    const registered = (await setting(this.db, 'platform_vat_registered', this.clock.now())) === 1;
    return {
      from: query.from,
      to: query.to,
      currency: 'AED',
      rulesApproved: TAX_RULES_APPROVED,
      platform: {
        registered,
        trn: PLATFORM_TRN,
        ...platform,
        netVatFils: platform.invoiced.vatFils - platform.credited.vatFils,
      },
      businesses: businesses
        .map((b) => {
          const t = byBusiness.get(b.id)!;
          return {
            business: {
              id: b.id,
              name: businessName(b.live_name as Localized | null, b.display_name as Localized),
            },
            taxRegistered: b.tax_registered,
            trn: b.tax_id,
            ...t,
            netVatFils: t.invoiced.vatFils - t.credited.vatFils,
          };
        })
        .sort((a, b) => a.business.name.en.localeCompare(b.business.name.en)),
    };
  }
}

function summaryView(r: {
  id: string;
  kind: TaxDocumentSummary['kind'];
  number: string;
  issuer: 'business' | 'platform';
  business_id: string;
  tax_document: boolean;
  net_fils: number;
  vat_fils: number;
  total_fils: number;
  rules_approved: boolean;
  issued_at: Date;
  order_id: string | null;
  booking_id: string | null;
}): TaxDocumentSummary {
  return {
    id: r.id,
    kind: r.kind,
    number: r.number,
    issuer: r.issuer,
    businessId: r.business_id,
    taxDocument: r.tax_document,
    netFils: r.net_fils,
    vatFils: r.vat_fils,
    totalFils: r.total_fils,
    rulesApproved: r.rules_approved,
    issuedAt: r.issued_at.toISOString(),
    orderId: r.order_id,
    bookingId: r.booking_id,
  };
}
