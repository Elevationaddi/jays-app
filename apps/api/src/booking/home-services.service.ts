import { HttpStatus, Inject, Injectable } from '@nestjs/common';
import type {
  AdminHomeService,
  AdminHomeServiceListQuery,
  HomeServiceDecisionRequest,
  HomeServiceProfile,
  HomeServiceProfileInput,
} from '@jays/contracts';
import type { Db, HomeServiceStatus } from '@jays/db';
import {
  type CoverageArea,
  HOME_PROFILE_EDITABLE,
  homeServiceDecision,
  localDateOf,
  DEFAULT_TIMEZONE,
} from '@jays/domain';
import { writeAudit } from '../common/audit.js';
import { CLOCK, type Clock } from '../common/clock.js';
import { ApiError } from '../common/error.filter.js';
import { afterCursor, cursorTs, decodeCursor, toPage } from '../common/pagination.js';
import type { RequestMeta } from '../common/request-context.js';
import { DB } from '../common/tokens.js';
import type { Conn, Trx } from './booking-shared.js';

type Localized = { en: string; ar: string };

interface ProfileRow {
  business_id: string;
  status: HomeServiceStatus;
  license_number: string | null;
  license_authority: string | null;
  license_expiry: Date | null;
  license_document_id: string | null;
  travel_buffer_min: number;
  min_order_fils: number;
  submitted_at: Date | null;
  reviewed_at: Date | null;
  review_reason: string | null;
  version: number;
}

const conflict = (code: string, message: string) =>
  new ApiError(HttpStatus.CONFLICT, code, message);

/** A date column comes back as a Date at UTC midnight; this is its calendar date. */
const dateOnly = (d: Date | null) => (d ? d.toISOString().slice(0, 10) : null);

/** Approved and the licence not expired (UAE date). */
export function homeServicesActive(
  p: { status: HomeServiceStatus; license_expiry: Date | null } | undefined | null,
  now: Date,
): boolean {
  if (p?.status !== 'approved') return false;
  const expiry = dateOnly(p.license_expiry);
  return !!expiry && expiry >= localDateOf(now, DEFAULT_TIMEZONE);
}

/** What booking needs to know about a business's home visits. */
export async function homeTermsOf(conn: Conn, businessId: string, now: Date) {
  const profile = await conn
    .selectFrom('home_service_profiles')
    .select(['status', 'license_expiry', 'travel_buffer_min', 'min_order_fils'])
    .where('business_id', '=', businessId)
    .executeTakeFirst();
  if (!profile || !homeServicesActive(profile, now)) return null;
  const areas = await conn
    .selectFrom('home_service_areas')
    .select(['emirate_code', 'area', 'travel_fee_fils'])
    .where('business_id', '=', businessId)
    .orderBy('emirate_code')
    .orderBy('area')
    .execute();
  return {
    status: profile.status,
    travelBufferMin: profile.travel_buffer_min,
    minOrderFils: profile.min_order_fils,
    areas: areas.map((a): CoverageArea => ({
      emirate: a.emirate_code,
      area: a.area,
      travelFeeFils: a.travel_fee_fils,
    })),
  };
}

/**
 * Home services (ADR-0018 D9, ADR-0022). The business records its home-service licence,
 * travel buffer, minimum and coverage areas and asks for review; an admin approves, rejects,
 * suspends or reinstates. Only an approved profile with an unexpired licence takes home bookings.
 */
@Injectable()
export class HomeServicesService {
  constructor(
    @Inject(DB) private readonly db: Db,
    @Inject(CLOCK) private readonly clock: Clock,
  ) {}

  private profileQuery(conn: Conn) {
    return conn
      .selectFrom('home_service_profiles as p')
      .select([
        'p.business_id',
        'p.status',
        'p.license_number',
        'p.license_authority',
        'p.license_expiry',
        'p.license_document_id',
        'p.travel_buffer_min',
        'p.min_order_fils',
        'p.submitted_at',
        'p.reviewed_at',
        'p.review_reason',
        'p.version',
      ]);
  }

  private async views(conn: Conn, rows: ProfileRow[]): Promise<HomeServiceProfile[]> {
    if (rows.length === 0) return [];
    const ids = rows.map((r) => r.business_id);
    const docIds = rows.map((r) => r.license_document_id).filter((x): x is string => !!x);
    const [areas, docs] = await Promise.all([
      conn
        .selectFrom('home_service_areas')
        .select(['id', 'business_id', 'emirate_code', 'area', 'travel_fee_fils'])
        .where('business_id', 'in', ids)
        .orderBy('emirate_code')
        .orderBy('area')
        .execute(),
      docIds.length
        ? conn
            .selectFrom('verification_documents')
            .select(['id', 'file_name', 'status'])
            .where('id', 'in', docIds)
            .execute()
        : Promise.resolve([]),
    ]);
    const now = this.clock.now();
    return rows.map((r) => {
      const doc = docs.find((d) => d.id === r.license_document_id);
      return {
        businessId: r.business_id,
        status: r.status,
        licenseNumber: r.license_number,
        licenseAuthority: r.license_authority,
        licenseExpiry: dateOnly(r.license_expiry),
        licenseDocument: doc ? { id: doc.id, fileName: doc.file_name, status: doc.status } : null,
        travelBufferMin: r.travel_buffer_min,
        minOrderFils: r.min_order_fils,
        submittedAt: r.submitted_at?.toISOString() ?? null,
        reviewedAt: r.reviewed_at?.toISOString() ?? null,
        reviewReason: r.review_reason,
        version: r.version,
        areas: areas
          .filter((a) => a.business_id === r.business_id)
          .map((a) => ({
            id: a.id,
            emirate: a.emirate_code as HomeServiceProfile['areas'][number]['emirate'],
            area: a.area,
            travelFeeFils: a.travel_fee_fils,
          })),
        licenseEditable: HOME_PROFILE_EDITABLE.includes(r.status),
        active: homeServicesActive(r, now),
      };
    });
  }

  /** The business's profile; a blank draft when it has none yet. */
  async get(businessId: string): Promise<HomeServiceProfile> {
    const row = await this.profileQuery(this.db)
      .where('p.business_id', '=', businessId)
      .executeTakeFirst();
    if (row) return (await this.views(this.db, [row]))[0]!;
    return {
      businessId,
      status: 'draft',
      licenseNumber: null,
      licenseAuthority: null,
      licenseExpiry: null,
      licenseDocument: null,
      travelBufferMin: 30,
      minOrderFils: 0,
      submittedAt: null,
      reviewedAt: null,
      reviewReason: null,
      version: 0,
      areas: [],
      licenseEditable: true,
      active: false,
    };
  }

  private async lock(trx: Trx, businessId: string) {
    await trx
      .insertInto('home_service_profiles')
      .values({ business_id: businessId })
      .onConflict((oc) => oc.column('business_id').doNothing())
      .execute();
    return trx
      .selectFrom('home_service_profiles')
      .selectAll()
      .where('business_id', '=', businessId)
      .forUpdate()
      .executeTakeFirstOrThrow();
  }

  /**
   * Saves the licence, travel buffer, minimum and coverage areas. Licence details change only
   * while the profile is a draft or was rejected; coverage and travel terms change any time and
   * apply to new bookings only (existing bookings keep their fee and buffer).
   */
  async save(
    actor: { businessId: string; userId: string },
    body: HomeServiceProfileInput,
    meta: RequestMeta,
  ): Promise<HomeServiceProfile> {
    await this.db.transaction().execute(async (trx) => {
      const p = await this.lock(trx, actor.businessId);
      const license = {
        license_number: body.licenseNumber ?? null,
        license_authority: body.licenseAuthority ?? null,
        license_expiry: body.licenseExpiry ?? null,
        license_document_id: body.licenseDocumentId ?? null,
      };
      const licenseChanged =
        license.license_number !== p.license_number ||
        license.license_authority !== p.license_authority ||
        license.license_expiry !== dateOnly(p.license_expiry) ||
        license.license_document_id !== p.license_document_id;
      if (licenseChanged && !HOME_PROFILE_EDITABLE.includes(p.status)) {
        throw conflict(
          'HOME_PROFILE_LOCKED',
          'Licence details cannot change while under review or approved. Contact support to update them.',
        );
      }
      if (license.license_document_id) {
        const doc = await trx
          .selectFrom('verification_documents')
          .select(['kind', 'status'])
          .where('id', '=', license.license_document_id)
          .where('business_id', '=', actor.businessId)
          .executeTakeFirst();
        if (!doc || doc.kind !== 'home_service_license' || doc.status !== 'clean') {
          throw new ApiError(
            HttpStatus.BAD_REQUEST,
            'VALIDATION_FAILED',
            'Pick an uploaded home-service licence.',
            { licenseDocumentId: ['a clean home_service_license document'] },
          );
        }
      }
      const emirates = [...new Set(body.areas.map((a) => a.emirate))];
      if (emirates.length) {
        const known = await trx
          .selectFrom('emirates')
          .select('code')
          .where('code', 'in', emirates)
          .execute();
        if (known.length !== emirates.length) {
          throw new ApiError(HttpStatus.BAD_REQUEST, 'VALIDATION_FAILED', 'Unknown emirate.', {
            areas: ['unknown emirate'],
          });
        }
      }
      await trx
        .updateTable('home_service_profiles')
        .set({
          ...(licenseChanged ? license : {}),
          travel_buffer_min: body.travelBufferMin,
          min_order_fils: body.minOrderFils,
          version: (eb) => eb('version', '+', 1),
        })
        .where('business_id', '=', actor.businessId)
        .execute();
      await trx
        .deleteFrom('home_service_areas')
        .where('business_id', '=', actor.businessId)
        .execute();
      if (body.areas.length) {
        await trx
          .insertInto('home_service_areas')
          .values(
            body.areas.map((a) => ({
              business_id: actor.businessId,
              emirate_code: a.emirate,
              area: a.area?.replace(/\s+/g, ' ') ?? null,
              travel_fee_fils: a.travelFeeFils,
            })),
          )
          .execute();
      }
      await writeAudit(trx, {
        actorType: 'user',
        actorId: actor.userId,
        action: 'home_services.updated',
        targetType: 'business',
        targetId: actor.businessId,
        businessId: actor.businessId,
        diff: {
          licenseChanged,
          travelBufferMin: body.travelBufferMin,
          minOrderFils: body.minOrderFils,
          areas: body.areas.length,
        },
        requestId: meta.requestId,
      });
    });
    return this.get(actor.businessId);
  }

  /** Asks for review. Needs complete licence details, an unexpired licence and an area. */
  async submit(
    actor: { businessId: string; userId: string },
    meta: RequestMeta,
  ): Promise<HomeServiceProfile> {
    await this.db.transaction().execute(async (trx) => {
      const now = this.clock.now();
      const p = await this.lock(trx, actor.businessId);
      if (!HOME_PROFILE_EDITABLE.includes(p.status)) {
        throw conflict('INVALID_TRANSITION', 'Home services are already under review or decided.');
      }
      const missing: Record<string, string[]> = {};
      if (!p.license_number) missing.licenseNumber = ['required'];
      if (!p.license_authority) missing.licenseAuthority = ['required'];
      const expiry = dateOnly(p.license_expiry);
      if (!expiry) missing.licenseExpiry = ['required'];
      else if (expiry < localDateOf(now, DEFAULT_TIMEZONE)) missing.licenseExpiry = ['expired'];
      if (!p.license_document_id) missing.licenseDocumentId = ['required'];
      const areas = await trx
        .selectFrom('home_service_areas')
        .select('id')
        .where('business_id', '=', actor.businessId)
        .limit(1)
        .execute();
      if (areas.length === 0) missing.areas = ['add at least one area'];
      if (Object.keys(missing).length) {
        throw new ApiError(
          HttpStatus.UNPROCESSABLE_ENTITY,
          'HOME_PROFILE_INCOMPLETE',
          'Complete the licence details and add a coverage area first.',
          missing,
        );
      }
      await trx
        .updateTable('home_service_profiles')
        .set({
          status: 'pending',
          submitted_at: now,
          review_reason: null,
          version: (eb) => eb('version', '+', 1),
        })
        .where('business_id', '=', actor.businessId)
        .execute();
      await writeAudit(trx, {
        actorType: 'user',
        actorId: actor.userId,
        action: 'home_services.submitted',
        targetType: 'business',
        targetId: actor.businessId,
        businessId: actor.businessId,
        requestId: meta.requestId,
      });
    });
    return this.get(actor.businessId);
  }

  // -------------------------------------------------------------------------------------------
  // Admin

  async list(query: AdminHomeServiceListQuery) {
    const key = decodeCursor(query.cursor);
    let q = this.profileQuery(this.db)
      .innerJoin('businesses as b', 'b.id', 'p.business_id')
      .leftJoin('storefronts as sf', 'sf.business_id', 'b.id')
      .select([
        'p.business_id as id',
        'b.display_name',
        'sf.live_name',
        cursorTs('p.updated_at').as('cursor_ts'),
      ])
      .where('p.status', '<>', 'draft');
    if (query.status) q = q.where('p.status', '=', query.status);
    if (key) q = q.where(afterCursor('p.updated_at', 'p.business_id', key, 'desc'));
    const rows = await q
      .orderBy('p.updated_at', 'desc')
      .orderBy('p.business_id', 'desc')
      .limit(query.limit + 1)
      .execute();
    const views = await this.views(this.db, rows);
    return toPage(rows, query.limit, (r): AdminHomeService => {
      const v = views.find((x) => x.businessId === r.business_id)!;
      return {
        ...v,
        business: {
          id: r.business_id,
          name: (r.live_name ?? r.display_name) as Localized,
        },
      };
    });
  }

  async adminGet(businessId: string): Promise<AdminHomeService> {
    const row = await this.profileQuery(this.db)
      .innerJoin('businesses as b', 'b.id', 'p.business_id')
      .leftJoin('storefronts as sf', 'sf.business_id', 'b.id')
      .select(['b.display_name', 'sf.live_name'])
      .where('p.business_id', '=', businessId)
      .executeTakeFirst();
    if (!row) throw new ApiError(HttpStatus.NOT_FOUND, 'NOT_FOUND', 'Not found.');
    const [view] = await this.views(this.db, [row]);
    return {
      ...view!,
      business: { id: businessId, name: (row.live_name ?? row.display_name) as Localized },
    };
  }

  /**
   * Approve or reject a pending profile; suspend or reinstate an approved one. Suspending stops
   * new home bookings at once (services keep their setting, so reinstating restores them);
   * existing bookings stay and are handled like any other.
   */
  async decide(
    adminId: string,
    businessId: string,
    body: HomeServiceDecisionRequest,
    meta: RequestMeta,
  ): Promise<AdminHomeService> {
    await this.db.transaction().execute(async (trx) => {
      const now = this.clock.now();
      const p = await trx
        .selectFrom('home_service_profiles')
        .select(['status', 'version', 'license_expiry'])
        .where('business_id', '=', businessId)
        .forUpdate()
        .executeTakeFirst();
      if (!p) throw new ApiError(HttpStatus.NOT_FOUND, 'NOT_FOUND', 'Not found.');
      if (p.version !== body.expectedVersion) {
        throw conflict('VERSION_CONFLICT', 'This application changed. Reload and try again.');
      }
      const next = homeServiceDecision(p.status, body.decision);
      if (!next) {
        throw conflict('INVALID_TRANSITION', `Cannot ${body.decision} from ${p.status}.`);
      }
      if (
        next === 'approved' &&
        !homeServicesActive({ status: next, license_expiry: p.license_expiry }, now)
      ) {
        throw conflict('LICENSE_EXPIRED', 'The home-service licence has expired.');
      }
      await trx
        .updateTable('home_service_profiles')
        .set({
          status: next,
          reviewed_at: now,
          reviewed_by: adminId,
          review_reason: body.reason ?? null,
          version: (eb) => eb('version', '+', 1),
        })
        .where('business_id', '=', businessId)
        .execute();
      await writeAudit(trx, {
        actorType: 'admin',
        actorId: adminId,
        action: `home_services.${body.decision}`,
        targetType: 'business',
        targetId: businessId,
        businessId,
        reason: body.reason ?? null,
        diff: { before: p.status, after: next },
        requestId: meta.requestId,
      });
      await trx
        .insertInto('outbox')
        .values({
          event_type: `home_services.${next}`,
          payload: JSON.stringify({ businessId, decision: body.decision }),
          available_at: now,
        })
        .execute();
    });
    return this.adminGet(businessId);
  }
}
