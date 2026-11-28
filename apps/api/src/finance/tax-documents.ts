import type { TaxDocumentKind, TaxDocumentLine, TaxParty } from '@jays/db';
import { PLATFORM_TRN, proportionalVat, TAX_RULES_APPROVED } from '@jays/domain';
import { BRAND } from '@jays/i18n';
import { sql } from 'kysely';

type Localized = { en: string; ar: string };
import type { Trx } from './ledger.js';

/**
 * Tax documents (D3, D4; ADR-0021). The business is the seller: it issues the invoice and credit
 * notes to the customer. JAYS is a disclosed intermediary: it issues commission invoices and
 * credit notes to the business. Every document is written once, numbered per issuer and year, and
 * marked as a draft while the tax rules are not approved.
 */

const PREFIX: Record<TaxDocumentKind, string> = {
  customer_invoice: 'INV',
  customer_credit_note: 'CRN',
  commission_invoice: 'JCI',
  commission_credit_note: 'JCC',
};

/** The next number for an issuer, kind and year (UAE time). Serialised by the row lock. */
async function nextNumber(trx: Trx, issuerKey: string, kind: TaxDocumentKind, at: Date) {
  const year = new Date(at.getTime() + 4 * 3_600_000).getUTCFullYear();
  const row = await trx
    .insertInto('document_sequences')
    .values({ issuer_key: issuerKey, prefix: PREFIX[kind], year, last_number: 1 })
    .onConflict((oc) =>
      oc
        .columns(['issuer_key', 'prefix', 'year'])
        .doUpdateSet({ last_number: sql`document_sequences.last_number + 1` }),
    )
    .returning('last_number')
    .executeTakeFirstOrThrow();
  return `${PREFIX[kind]}-${year}-${String(row.last_number).padStart(6, '0')}`;
}

interface NewDocument {
  kind: TaxDocumentKind;
  businessId: string;
  customerUserId: string | null;
  earningId: string;
  source: { type: 'merchant_earning' | 'refund' | 'dispute'; id: string };
  creditsDocumentId: string | null;
  taxDocument: boolean;
  seller: TaxParty;
  buyer: TaxParty;
  lines: TaxDocumentLine[];
  vatFils: number;
  totalFils: number;
  issuedAt: Date;
}

/** Writes a document once per (kind, source). Returns its id, or null if nothing is due. */
async function issue(trx: Trx, d: NewDocument): Promise<string | null> {
  if (d.totalFils <= 0) return null;
  const existing = await trx
    .selectFrom('tax_documents')
    .select('id')
    .where('kind', '=', d.kind)
    .where('source_type', '=', d.source.type)
    .where('source_id', '=', d.source.id)
    .executeTakeFirst();
  if (existing) return existing.id;
  const issuer = d.kind.startsWith('customer') ? 'business' : 'platform';
  const number = await nextNumber(
    trx,
    issuer === 'business' ? d.businessId : 'platform',
    d.kind,
    d.issuedAt,
  );
  const row = await trx
    .insertInto('tax_documents')
    .values({
      kind: d.kind,
      issuer,
      business_id: d.businessId,
      customer_user_id: d.customerUserId,
      number,
      earning_id: d.earningId,
      source_type: d.source.type,
      source_id: d.source.id,
      credits_document_id: d.creditsDocumentId,
      tax_document: d.taxDocument,
      seller: JSON.stringify(d.seller),
      buyer: JSON.stringify(d.buyer),
      lines: JSON.stringify(d.lines),
      net_fils: d.totalFils - d.vatFils,
      vat_fils: d.vatFils,
      total_fils: d.totalFils,
      rules_approved: TAX_RULES_APPROVED,
      issued_at: d.issuedAt,
    })
    .returning('id')
    .executeTakeFirstOrThrow();
  return row.id;
}

const platformParty = (): TaxParty => ({ name: { ...BRAND.name }, trn: PLATFORM_TRN });

async function businessParty(trx: Trx, businessId: string) {
  const b = await trx
    .selectFrom('businesses as b')
    .leftJoin('storefronts as s', 's.business_id', 'b.id')
    .select([
      'b.display_name',
      'b.legal_name',
      'b.tax_registered',
      'b.tax_id',
      'b.address_area',
      'b.address_street',
      'b.address_building',
      'b.address_emirate_code',
      's.live_name',
    ])
    .where('b.id', '=', businessId)
    .executeTakeFirstOrThrow();
  const name = (b.live_name ?? b.display_name) as Localized;
  const party: TaxParty = {
    name: b.legal_name ? { en: b.legal_name, ar: b.legal_name } : name,
    trn: b.tax_registered ? b.tax_id : null,
    address:
      [b.address_building, b.address_street, b.address_area, b.address_emirate_code]
        .filter(Boolean)
        .join(', ') || null,
  };
  return { party, registered: b.tax_registered };
}

async function customerParty(trx: Trx, userId: string): Promise<TaxParty> {
  const u = await trx
    .selectFrom('users')
    .select(['display_name', 'email'])
    .where('id', '=', userId)
    .executeTakeFirstOrThrow();
  const name = u.display_name ?? u.email ?? '—';
  return { name: { en: name, ar: name }, trn: null, email: u.email };
}

export interface CaptureDocuments {
  earningId: string;
  businessId: string;
  customerUserId: string | null;
  /** Lines as sold, VAT included, and the VAT in them. */
  lines: TaxDocumentLine[];
  totalFils: number;
  vatFils: number;
  commissionFils: number;
  commissionVatFils: number;
  commissionVatBps: number;
  platformRegistered: boolean;
  reference: string;
  at: Date;
}

/** On capture: the business's invoice to the customer and the platform's commission invoice. */
export async function issueCaptureDocuments(trx: Trx, c: CaptureDocuments) {
  const { party: seller, registered } = await businessParty(trx, c.businessId);
  const source = { type: 'merchant_earning' as const, id: c.earningId };
  if (c.customerUserId) {
    await issue(trx, {
      kind: 'customer_invoice',
      businessId: c.businessId,
      customerUserId: c.customerUserId,
      earningId: c.earningId,
      source,
      creditsDocumentId: null,
      taxDocument: registered,
      seller,
      buyer: await customerParty(trx, c.customerUserId),
      lines: c.lines,
      vatFils: c.vatFils,
      totalFils: c.totalFils,
      issuedAt: c.at,
    });
  }
  await issue(trx, {
    kind: 'commission_invoice',
    businessId: c.businessId,
    customerUserId: null,
    earningId: c.earningId,
    source,
    creditsDocumentId: null,
    taxDocument: c.platformRegistered,
    seller: platformParty(),
    buyer: seller,
    lines: [
      {
        description: {
          en: `Marketplace commission, ${c.reference}`,
          ar: `عمولة السوق، ${c.reference}`,
        },
        qty: 1,
        totalFils: c.commissionFils + c.commissionVatFils,
        vatRateBps: c.platformRegistered ? c.commissionVatBps : 0,
        vatFils: c.commissionVatFils,
      },
    ],
    vatFils: c.commissionVatFils,
    totalFils: c.commissionFils + c.commissionVatFils,
    issuedAt: c.at,
  });
}

/**
 * On a refund or lost dispute: a credit note from the business to the customer for the amount
 * returned, and a commission credit note for the commission (and its VAT) given back. The VAT on
 * the customer credit note is the invoice's VAT in proportion; the last one takes what is left.
 */
export async function issueCreditNotes(
  trx: Trx,
  input: {
    earningId: string;
    businessId: string;
    source: { type: 'refund' | 'dispute'; id: string };
    amountFils: number;
    commissionFils: number;
    commissionVatFils: number;
    at: Date;
  },
) {
  const invoices = await trx
    .selectFrom('tax_documents')
    .selectAll()
    .where('earning_id', '=', input.earningId)
    .where('kind', 'in', ['customer_invoice', 'commission_invoice'])
    .execute();
  const label =
    input.source.type === 'refund'
      ? { en: 'Refund', ar: 'استرداد' }
      : { en: 'Chargeback', ar: 'استرداد بنكي' };
  for (const inv of invoices) {
    const isCustomer = inv.kind === 'customer_invoice';
    const credited = await trx
      .selectFrom('tax_documents')
      .select([
        sql<string>`coalesce(sum(total_fils), 0)`.as('total'),
        sql<string>`coalesce(sum(vat_fils), 0)`.as('vat'),
      ])
      .where('credits_document_id', '=', inv.id)
      .executeTakeFirstOrThrow();
    const totalLeft = inv.total_fils - Number(credited.total);
    const vatLeft = inv.vat_fils - Number(credited.vat);
    const total = Math.min(
      totalLeft,
      isCustomer ? input.amountFils : input.commissionFils + input.commissionVatFils,
    );
    if (total <= 0) continue;
    const vat = isCustomer
      ? Math.min(proportionalVat(inv.vat_fils, total, inv.total_fils, vatLeft), total)
      : Math.min(input.commissionVatFils, vatLeft);
    const rate = inv.lines[0]?.vatRateBps ?? 0;
    await issue(trx, {
      kind: isCustomer ? 'customer_credit_note' : 'commission_credit_note',
      businessId: input.businessId,
      customerUserId: inv.customer_user_id,
      earningId: input.earningId,
      source: input.source,
      creditsDocumentId: inv.id,
      taxDocument: inv.tax_document,
      seller: inv.seller,
      buyer: inv.buyer,
      lines: [
        {
          description: { en: `${label.en}, ${inv.number}`, ar: `${label.ar}، ${inv.number}` },
          qty: 1,
          totalFils: total,
          vatRateBps: isCustomer ? (vat > 0 ? rate : 0) : rate,
          vatFils: vat,
        },
      ],
      vatFils: vat,
      totalFils: total,
      issuedAt: input.at,
    });
  }
}
