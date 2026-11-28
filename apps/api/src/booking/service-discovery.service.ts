import { HttpStatus, Inject, Injectable } from '@nestjs/common';
import type {
  Addon,
  AddonInput,
  CreatePortfolioItemRequest,
  JoinWaitlistRequest,
  NextAvailable,
  NextAvailableQuery,
  PortfolioItem,
  PublicServiceListItem,
  Rebook,
  ServiceListQuery,
  UpdateAddonRequest,
  WaitlistEntry,
} from '@jays/contracts';
import type { Db } from '@jays/db';
import {
  ADDONS_PER_SERVICE_MAX,
  addDays,
  DOWNLOAD_URL_TTL_SECONDS,
  localDateOf,
  NEXT_AVAILABLE_SEARCH_DAYS,
  PORTFOLIO_ITEMS_MAX,
  ratingSummary,
  SERVICE_POPULAR_WINDOW_DAYS,
  WAITLIST_ACTIVE_MAX,
} from '@jays/domain';
import { sql } from 'kysely';
import { writeAudit } from '../common/audit.js';
import { CLOCK, type Clock } from '../common/clock.js';
import { ApiError } from '../common/error.filter.js';
import type { RequestMeta } from '../common/request-context.js';
import { DB } from '../common/tokens.js';
import { API_ENV, type ApiEnv } from '../config.js';
import { OBJECT_STORAGE, type ObjectStorage } from '../storage/storage.js';
import { notFound, type Conn } from './booking-shared.js';
import { BookingsService } from './bookings.service.js';

type Localized = { en: string; ar: string };

interface Actor {
  businessId: string;
  userId: string;
  meta: RequestMeta;
}

const addSeconds = (d: Date, s: number) => new Date(d.getTime() + s * 1000);

/** Search pages by offset: results are ranked, so there is no stable keyset. */
function encodeOffset(n: number) {
  return Buffer.from(`o:${n}`).toString('base64url');
}
function decodeOffset(cursor: string | undefined): number {
  if (!cursor) return 0;
  const m = /^o:(\d{1,6})$/.exec(Buffer.from(cursor, 'base64url').toString());
  if (!m) throw new ApiError(HttpStatus.BAD_REQUEST, 'VALIDATION_FAILED', 'Invalid cursor.');
  return Number(m[1]);
}

const escapeLike = (q: string) => `%${q.replace(/[%_\\]/g, (c) => `\\${c}`)}%`;

/**
 * Service discovery (phase 8.7, ADR-0026): search across venues, the next free time, add-ons,
 * portfolios, waitlists and rebooking. Visibility follows the venue page exactly: approved,
 * published businesses with services active, live categories and an open branch.
 */
@Injectable()
export class ServiceDiscoveryService {
  constructor(
    @Inject(DB) private readonly db: Db,
    @Inject(CLOCK) private readonly clock: Clock,
    @Inject(API_ENV) private readonly env: ApiEnv,
    @Inject(OBJECT_STORAGE) private readonly storage: ObjectStorage,
    @Inject(BookingsService) private readonly bookings: BookingsService,
  ) {}

  private get base() {
    return this.env.API_PUBLIC_URL.replace(/\/$/, '');
  }

  // -------------------------------------------------------------------------------------------
  // Search

  async search(query: ServiceListQuery) {
    const offset = decodeOffset(query.cursor);
    const since = new Date(this.clock.now().getTime() - SERVICE_POPULAR_WINDOW_DAYS * 86_400_000);
    const like = query.q ? escapeLike(query.q) : null;
    // Home visits count only for a business whose home services are approved and licensed.
    const homeOpen = sql`(hp.status = 'approved' AND hp.license_expiry >= (now() AT TIME ZONE 'Asia/Dubai')::date
      AND EXISTS (SELECT 1 FROM home_service_areas ha JOIN emirates he ON he.code = ha.emirate_code
                   WHERE ha.business_id = s.business_id AND he.enabled
                   ${query.emirate ? sql`AND ha.emirate_code = ${query.emirate}` : sql``}))`;
    const branchOpen = sql`EXISTS (SELECT 1 FROM branch_services bs
        JOIN branches br ON br.id = bs.branch_id
        JOIN emirates e ON e.code = br.emirate_code
       WHERE bs.service_id = s.id AND br.status = 'active' AND e.enabled
       ${query.emirate ? sql`AND br.emirate_code = ${query.emirate}` : sql``})`;
    const anyBranch = sql`EXISTS (SELECT 1 FROM branch_services bs
        JOIN branches br ON br.id = bs.branch_id
        JOIN emirates e ON e.code = br.emirate_code
       WHERE bs.service_id = s.id AND br.status = 'active' AND e.enabled)`;
    const venueOk = sql`(s.location_mode IN ('in_venue', 'both') AND ${branchOpen})`;
    const homeOk = sql`(s.location_mode IN ('home', 'both') AND ${homeOpen})`;
    const where = [
      sql`s.status = 'active'`,
      sql`category_is_live(s.category_id)`,
      sql`b.status = 'approved'`,
      sql`sf.published_at IS NOT NULL`,
      sql`EXISTS (SELECT 1 FROM business_modes m WHERE m.business_id = b.id AND m.mode = 'services' AND m.status = 'active')`,
      // Every booking is made at a branch, home visits included.
      anyBranch,
      query.location === 'venue'
        ? venueOk
        : query.location === 'home'
          ? homeOk
          : sql`(${venueOk} OR ${homeOk})`,
      query.category ? sql`s.category_id = ${query.category}` : sql`TRUE`,
      query.minPriceFils !== undefined ? sql`s.price_fils >= ${query.minPriceFils}` : sql`TRUE`,
      query.maxPriceFils !== undefined ? sql`s.price_fils <= ${query.maxPriceFils}` : sql`TRUE`,
      query.minRating !== undefined
        ? sql`coalesce(rv.n, 0) > 0 AND rv.sum::numeric / rv.n >= ${query.minRating}`
        : sql`TRUE`,
      like
        ? sql`(s.title->>'en' ILIKE ${like} OR s.title->>'ar' ILIKE ${like}
              OR s.description->>'en' ILIKE ${like} OR s.description->>'ar' ILIKE ${like}
              OR coalesce(sf.live_name, b.display_name)->>'en' ILIKE ${like}
              OR coalesce(sf.live_name, b.display_name)->>'ar' ILIKE ${like})`
        : sql`TRUE`,
    ];
    const titleHit = like
      ? sql`CASE WHEN s.title->>'en' ILIKE ${like} OR s.title->>'ar' ILIKE ${like} THEN 0 ELSE 1 END`
      : sql`0`;
    const ratingAvg = sql`coalesce(rv.sum::numeric / nullif(rv.n, 0), 0)`;
    const order = {
      relevance: sql`${titleHit}, coalesce(pop.n, 0) DESC, ${ratingAvg} DESC, s.id`,
      price_asc: sql`s.price_fils, s.id`,
      price_desc: sql`s.price_fils DESC, s.id`,
      rating: sql`${ratingAvg} DESC, coalesce(rv.n, 0) DESC, s.id`,
      popular: sql`coalesce(pop.n, 0) DESC, s.id`,
    }[query.sort];
    const rows = await sql<{
      id: string;
      title: Localized;
      category_id: string;
      price_fils: number;
      duration_min: number;
      location_mode: 'in_venue' | 'home' | 'both';
      business_id: string;
      name: Localized;
      logo: string | null;
      home_open: boolean;
      emirates: string[] | null;
      rv_sum: string | null;
      rv_n: string | null;
      addon_count: string;
      image: string | null;
    }>`
      SELECT s.id, s.title, s.category_id, s.price_fils, s.duration_min, s.location_mode,
             s.business_id, coalesce(sf.live_name, b.display_name) AS name,
             sf.live_logo_media_id AS logo,
             coalesce(${homeOpen}, false) AS home_open,
             (SELECT array_agg(DISTINCT br.emirate_code ORDER BY br.emirate_code)
                FROM branch_services bs JOIN branches br ON br.id = bs.branch_id
                JOIN emirates e ON e.code = br.emirate_code
               WHERE bs.service_id = s.id AND br.status = 'active' AND e.enabled) AS emirates,
             rv.sum AS rv_sum, rv.n AS rv_n,
             (SELECT count(*) FROM service_addons a
               WHERE a.service_id = s.id AND a.status = 'active') AS addon_count,
             (SELECT p.media_id FROM portfolio_items p JOIN media md ON md.id = p.media_id
               WHERE p.service_id = s.id AND md.status = 'ready'
               ORDER BY p.sort_order, p.created_at DESC LIMIT 1) AS image
        FROM services s
        JOIN businesses b ON b.id = s.business_id
        JOIN storefronts sf ON sf.business_id = b.id
        LEFT JOIN home_service_profiles hp ON hp.business_id = s.business_id
        LEFT JOIN LATERAL (
          SELECT sum(r.rating) AS sum, count(*) AS n FROM reviews r
           WHERE r.service_id = s.id AND r.target_type = 'booking' AND r.status = 'published'
        ) rv ON TRUE
        LEFT JOIN LATERAL (
          SELECT count(*) AS n FROM bookings bk
           WHERE bk.service_id = s.id AND bk.status IN ('confirmed', 'checked_in', 'completed')
             AND bk.start_at >= ${since}
        ) pop ON TRUE
       WHERE ${sql.join(where, sql` AND `)}
       ORDER BY ${order}
       LIMIT ${query.limit + 1} OFFSET ${offset}
    `.execute(this.db);
    const page = rows.rows.slice(0, query.limit);
    const items: PublicServiceListItem[] = page.map((r) => ({
      id: r.id,
      title: r.title,
      categoryId: r.category_id,
      priceFils: r.price_fils,
      durationMin: r.duration_min,
      locationMode: r.home_open
        ? r.location_mode
        : r.location_mode === 'both'
          ? 'in_venue'
          : r.location_mode,
      venue: {
        id: r.business_id,
        name: r.name,
        logoUrl: r.logo ? `${this.base}/media/${r.logo}` : null,
      },
      emirates: (r.emirates ?? []) as PublicServiceListItem['emirates'],
      imageUrl: r.image ? `${this.base}/media/${r.image}` : null,
      rating: ratingSummary(Number(r.rv_sum ?? 0), Number(r.rv_n ?? 0)),
      addonCount: Number(r.addon_count),
      currency: 'AED',
    }));
    return {
      items,
      nextCursor: rows.rows.length > query.limit ? encodeOffset(offset + query.limit) : null,
    };
  }

  /**
   * The earliest free start for a service in the next 14 days, across its branches (or one),
   * computed with the same availability rules as the booking page.
   */
  async nextAvailable(serviceId: string, query: NextAvailableQuery): Promise<NextAvailable> {
    const service = await this.db
      .selectFrom('services')
      .select(['id', 'business_id'])
      .where('id', '=', serviceId)
      .where('status', '=', 'active')
      .executeTakeFirst();
    if (!service || !(await this.bookings.visibleBusiness(this.db, service.business_id))) {
      throw notFound();
    }
    const branches = await this.db
      .selectFrom('branch_services as bs')
      .innerJoin('branches as br', 'br.id', 'bs.branch_id')
      .innerJoin('emirates as e', 'e.code', 'br.emirate_code')
      .select(['br.id', 'br.timezone'])
      .where('bs.service_id', '=', serviceId)
      .where('br.status', '=', 'active')
      .where('e.enabled', '=', true)
      .$if(!!query.branchId, (q) => q.where('br.id', '=', query.branchId!))
      .orderBy('br.created_at')
      .execute();
    const none: NextAvailable = { startAt: null, branchId: null, timeZone: null, staffIds: [] };
    if (branches.length === 0) return none;
    const today = localDateOf(this.clock.now(), branches[0]!.timezone);
    for (let i = 0; i < NEXT_AVAILABLE_SEARCH_DAYS; i++) {
      const date = addDays(today, i);
      let best: NextAvailable | null = null;
      for (const br of branches) {
        let slots;
        try {
          slots = await this.bookings.availability({
            branchId: br.id,
            serviceId,
            date,
            location: query.location,
            addonIds: [],
            ...(query.staffId ? { staffId: query.staffId } : {}),
          });
        } catch (error) {
          // A location the service does not offer, or home visits not open: nothing here.
          if (error instanceof ApiError && error.getStatus() === HttpStatus.UNPROCESSABLE_ENTITY) {
            continue;
          }
          throw error;
        }
        const first = slots.slots[0];
        if (first && (!best || first.startAt < best.startAt!)) {
          best = {
            startAt: first.startAt,
            branchId: br.id,
            timeZone: slots.timeZone,
            staffIds: first.staffIds,
          };
        }
      }
      if (best) return best;
    }
    return none;
  }

  /** A portfolio photo of a visible business, or null when it is not one. */
  async portfolioMediaRedirect(mediaId: string): Promise<string | null> {
    const row = await this.db
      .selectFrom('portfolio_items as p')
      .innerJoin('media as m', 'm.id', 'p.media_id')
      .select(['m.object_key', 'p.business_id'])
      .where('p.media_id', '=', mediaId)
      .where('m.status', '=', 'ready')
      .executeTakeFirst();
    if (!row || !(await this.bookings.visibleBusiness(this.db, row.business_id))) return null;
    return this.storage.signDownload(row.object_key, {
      expiresAt: addSeconds(this.clock.now(), DOWNLOAD_URL_TTL_SECONDS),
      disposition: 'inline',
    }).url;
  }

  // -------------------------------------------------------------------------------------------
  // Waitlist

  async listWaitlist(userId: string): Promise<{ items: WaitlistEntry[] }> {
    const rows = await this.db
      .selectFrom('booking_waitlist as w')
      .innerJoin('branches as br', 'br.id', 'w.branch_id')
      .innerJoin('services as s', 's.id', 'w.service_id')
      .innerJoin('businesses as b', 'b.id', 'w.business_id')
      .leftJoin('storefronts as sf', 'sf.business_id', 'b.id')
      .leftJoin('staff as st', 'st.id', 'w.staff_id')
      .select([
        'w.id',
        'w.status',
        sql<string>`to_char(w.date, 'YYYY-MM-DD')`.as('date'),
        sql<string>`to_char(w.window_start, 'HH24:MI')`.as('window_start'),
        sql<string>`to_char(w.window_end, 'HH24:MI')`.as('window_end'),
        'br.timezone',
        'br.id as branch_id',
        'br.name as branch_name',
        's.id as service_id',
        's.title as service_title',
        'b.id as business_id',
        'b.display_name',
        'sf.live_name',
        'st.id as staff_id',
        'st.display_name as staff_name',
        'w.notified_at',
        'w.created_at',
      ])
      .where('w.user_id', '=', userId)
      .where('w.status', 'in', ['active', 'notified'])
      .orderBy('w.date')
      .orderBy('w.created_at')
      .limit(50)
      .execute();
    return {
      items: rows.map((r) => ({
        id: r.id,
        status: r.status,
        date: r.date,
        windowStart: r.window_start,
        windowEnd: r.window_end,
        timeZone: r.timezone,
        venue: { id: r.business_id, name: (r.live_name ?? r.display_name) as Localized },
        branch: { id: r.branch_id, name: r.branch_name },
        service: { id: r.service_id, title: r.service_title },
        staff: r.staff_id ? { id: r.staff_id, displayName: r.staff_name! } : null,
        notifiedAt: r.notified_at?.toISOString() ?? null,
        createdAt: r.created_at.toISOString(),
      })),
    };
  }

  /**
   * Joins the waitlist for a service at a branch on a date. Only bookable services, dates in
   * the booking window and professionals who perform the service there are accepted; one entry
   * per service, branch and date; at most WAITLIST_ACTIVE_MAX active entries.
   */
  async joinWaitlist(
    userId: string,
    body: JoinWaitlistRequest,
    meta: RequestMeta,
  ): Promise<WaitlistEntry> {
    // The same checks as availability: visible business, open emirate, active service at the
    // branch, date within the booking window.
    await this.bookings
      .availability({
        branchId: body.branchId,
        serviceId: body.serviceId,
        date: body.date,
        location: 'venue',
        addonIds: [],
        ...(body.staffId ? { staffId: body.staffId } : {}),
      })
      .catch(async (error: unknown) => {
        // A home-only service still has a branch; check visibility through a home query.
        if (error instanceof ApiError && error.code === 'LOCATION_NOT_OFFERED') {
          return this.bookings.availability({
            branchId: body.branchId,
            serviceId: body.serviceId,
            date: body.date,
            location: 'home',
            addonIds: [],
          });
        }
        throw error;
      });
    const id = await this.db.transaction().execute(async (trx) => {
      await trx
        .selectFrom('users')
        .select('id')
        .where('id', '=', userId)
        .forUpdate()
        .executeTakeFirstOrThrow();
      const branch = await trx
        .selectFrom('branches')
        .select(['business_id'])
        .where('id', '=', body.branchId)
        .executeTakeFirstOrThrow();
      if (body.staffId) {
        const qualified = await trx
          .selectFrom('staff_services as ss')
          .innerJoin('staff_branches as sb', (j) =>
            j.onRef('sb.staff_id', '=', 'ss.staff_id').on('sb.branch_id', '=', body.branchId),
          )
          .innerJoin('staff as st', 'st.id', 'ss.staff_id')
          .select('ss.staff_id')
          .where('ss.service_id', '=', body.serviceId)
          .where('ss.staff_id', '=', body.staffId)
          .where('st.status', '=', 'active')
          .executeTakeFirst();
        if (!qualified) {
          throw new ApiError(
            HttpStatus.BAD_REQUEST,
            'VALIDATION_FAILED',
            'That professional does not offer this service here.',
            { staffId: ['not offered here'] },
          );
        }
      }
      const open = await trx
        .selectFrom('booking_waitlist')
        .select((eb) => eb.fn.countAll<string>().as('n'))
        .where('user_id', '=', userId)
        .where('status', '=', 'active')
        .executeTakeFirstOrThrow();
      if (Number(open.n) >= WAITLIST_ACTIVE_MAX) {
        throw new ApiError(
          HttpStatus.CONFLICT,
          'WAITLIST_LIMIT',
          `You can wait for at most ${WAITLIST_ACTIVE_MAX} appointments at a time.`,
        );
      }
      const existing = await trx
        .selectFrom('booking_waitlist')
        .select('id')
        .where('user_id', '=', userId)
        .where('branch_id', '=', body.branchId)
        .where('service_id', '=', body.serviceId)
        .where(sql<boolean>`date = ${body.date}::date`)
        .where('status', '=', 'active')
        .executeTakeFirst();
      const values = {
        staff_id: body.staffId ?? null,
        window_start: body.windowStart,
        window_end: body.windowEnd,
      };
      const row = existing
        ? await trx
            .updateTable('booking_waitlist')
            .set(values)
            .where('id', '=', existing.id)
            .returning('id')
            .executeTakeFirstOrThrow()
        : await trx
            .insertInto('booking_waitlist')
            .values({
              user_id: userId,
              business_id: branch.business_id,
              branch_id: body.branchId,
              service_id: body.serviceId,
              date: body.date,
              ...values,
            })
            .returning('id')
            .executeTakeFirstOrThrow();
      await writeAudit(trx, {
        actorType: 'user',
        actorId: userId,
        action: existing ? 'waitlist.updated' : 'waitlist.joined',
        targetType: 'booking_waitlist',
        targetId: row.id,
        businessId: branch.business_id,
        diff: { serviceId: body.serviceId, date: body.date },
        requestId: meta.requestId,
      });
      return row.id;
    });
    const { items } = await this.listWaitlist(userId);
    return items.find((w) => w.id === id)!;
  }

  async leaveWaitlist(userId: string, entryId: string): Promise<{ items: WaitlistEntry[] }> {
    const res = await this.db
      .updateTable('booking_waitlist')
      .set({ status: 'canceled' })
      .where('id', '=', entryId)
      .where('user_id', '=', userId)
      .where('status', 'in', ['active', 'notified'])
      .executeTakeFirst();
    if (Number(res.numUpdatedRows) === 0) throw notFound();
    return this.listWaitlist(userId);
  }

  // -------------------------------------------------------------------------------------------
  // Rebooking

  /**
   * What "Book again" should prefill from a past appointment: the same service, branch, location
   * and, where still offered, professional and add-ons. Nothing is held; the customer picks a
   * new time and the usual checks apply.
   */
  async rebook(userId: string, bookingId: string): Promise<Rebook> {
    const b = await this.db
      .selectFrom('bookings')
      .select([
        'id',
        'business_id',
        'branch_id',
        'service_id',
        'staff_id',
        'addons',
        'location_type',
        'home_address',
        'price_fils',
        'travel_fee_fils',
        'addons_fils',
      ])
      .where('id', '=', bookingId)
      .where('user_id', '=', userId)
      .executeTakeFirst();
    if (!b) throw notFound();
    const [visible, service, branchOk, staffOk, addons] = await Promise.all([
      this.bookings.visibleBusiness(this.db, b.business_id),
      this.db
        .selectFrom('services as s')
        .innerJoin('branch_services as bs', (j) =>
          j.onRef('bs.service_id', '=', 's.id').on('bs.branch_id', '=', b.branch_id),
        )
        .select(['s.price_fils'])
        .where('s.id', '=', b.service_id)
        .where('s.status', '=', 'active')
        .where(sql<boolean>`category_is_live(s.category_id)`)
        .executeTakeFirst(),
      this.db
        .selectFrom('branches as br')
        .innerJoin('emirates as e', 'e.code', 'br.emirate_code')
        .select('br.id')
        .where('br.id', '=', b.branch_id)
        .where('br.status', '=', 'active')
        .where('e.enabled', '=', true)
        .executeTakeFirst(),
      this.db
        .selectFrom('staff as st')
        .innerJoin('staff_services as ss', (j) =>
          j.onRef('ss.staff_id', '=', 'st.id').on('ss.service_id', '=', b.service_id),
        )
        .innerJoin('staff_branches as sb', (j) =>
          j.onRef('sb.staff_id', '=', 'st.id').on('sb.branch_id', '=', b.branch_id),
        )
        .select('st.id')
        .where('st.id', '=', b.staff_id)
        .where('st.status', '=', 'active')
        .executeTakeFirst(),
      this.db
        .selectFrom('service_addons')
        .select(['id'])
        .where('service_id', '=', b.service_id)
        .where('status', '=', 'active')
        .execute(),
    ]);
    const activeAddons = new Set(addons.map((a) => a.id));
    const keptAddons = b.addons.filter((a) => activeAddons.has(a.id)).map((a) => a.id);
    const changes: Rebook['changes'] = [];
    if (!staffOk) changes.push('staff_unavailable');
    if (keptAddons.length < b.addons.length) changes.push('addon_unavailable');
    const servicePrice = b.price_fils - b.travel_fee_fils - b.addons_fils;
    if (service && service.price_fils !== servicePrice) changes.push('price_changed');
    return {
      venueId: b.business_id,
      branchId: b.branch_id,
      serviceId: b.service_id,
      staffId: staffOk ? b.staff_id : null,
      addonIds: keptAddons,
      location: b.location_type,
      addressId: b.home_address?.addressId ?? null,
      available: Boolean(visible && service && branchOk),
      changes,
      priceFils: service?.price_fils ?? null,
    };
  }

  // -------------------------------------------------------------------------------------------
  // Business: add-ons

  private async ownService(conn: Conn, businessId: string, serviceId: string) {
    const s = await conn
      .selectFrom('services')
      .select(['id', 'duration_min', 'price_fils'])
      .where('id', '=', serviceId)
      .where('business_id', '=', businessId)
      .executeTakeFirst();
    if (!s) throw notFound();
    return s;
  }

  async listAddons(businessId: string, serviceId: string): Promise<{ items: Addon[] }> {
    await this.ownService(this.db, businessId, serviceId);
    const rows = await this.db
      .selectFrom('service_addons')
      .selectAll()
      .where('service_id', '=', serviceId)
      .where('business_id', '=', businessId)
      .orderBy('status')
      .orderBy('sort_order')
      .orderBy('created_at')
      .execute();
    return { items: rows.map(addonView) };
  }

  async createAddon(a: Actor, serviceId: string, body: AddonInput): Promise<Addon> {
    return this.db.transaction().execute(async (trx) => {
      const service = await trx
        .selectFrom('services')
        .select(['id'])
        .where('id', '=', serviceId)
        .where('business_id', '=', a.businessId)
        .forUpdate()
        .executeTakeFirst();
      if (!service) throw notFound();
      const count = await trx
        .selectFrom('service_addons')
        .select((eb) => eb.fn.countAll<string>().as('n'))
        .where('service_id', '=', serviceId)
        .where('status', '=', 'active')
        .executeTakeFirstOrThrow();
      if (Number(count.n) >= ADDONS_PER_SERVICE_MAX) {
        throw new ApiError(
          HttpStatus.CONFLICT,
          'ADDON_LIMIT',
          `A service can have at most ${ADDONS_PER_SERVICE_MAX} add-ons.`,
        );
      }
      const row = await trx
        .insertInto('service_addons')
        .values({
          business_id: a.businessId,
          service_id: serviceId,
          title: JSON.stringify(body.title),
          price_fils: body.priceFils,
          duration_min: body.durationMin,
          sort_order: body.sortOrder,
          created_by: a.userId,
        })
        .returningAll()
        .executeTakeFirstOrThrow();
      await writeAudit(trx, {
        actorType: 'user',
        actorId: a.userId,
        action: 'service_addon.created',
        targetType: 'service_addon',
        targetId: row.id,
        businessId: a.businessId,
        diff: { serviceId, priceFils: body.priceFils, durationMin: body.durationMin },
        requestId: a.meta.requestId,
      });
      return addonView(row);
    });
  }

  /** Edits apply to new bookings only; existing bookings keep their snapshot (T13). */
  async updateAddon(a: Actor, addonId: string, body: UpdateAddonRequest): Promise<Addon> {
    return this.db.transaction().execute(async (trx) => {
      const current = await trx
        .selectFrom('service_addons')
        .selectAll()
        .where('id', '=', addonId)
        .where('business_id', '=', a.businessId)
        .forUpdate()
        .executeTakeFirst();
      if (!current) throw notFound();
      if (body.status === 'active' && current.status === 'archived') {
        const count = await trx
          .selectFrom('service_addons')
          .select((eb) => eb.fn.countAll<string>().as('n'))
          .where('service_id', '=', current.service_id)
          .where('status', '=', 'active')
          .executeTakeFirstOrThrow();
        if (Number(count.n) >= ADDONS_PER_SERVICE_MAX) {
          throw new ApiError(
            HttpStatus.CONFLICT,
            'ADDON_LIMIT',
            `A service can have at most ${ADDONS_PER_SERVICE_MAX} add-ons.`,
          );
        }
      }
      const row = await trx
        .updateTable('service_addons')
        .set({
          ...(body.title ? { title: JSON.stringify(body.title) } : {}),
          ...(body.priceFils !== undefined ? { price_fils: body.priceFils } : {}),
          ...(body.durationMin !== undefined ? { duration_min: body.durationMin } : {}),
          ...(body.sortOrder !== undefined ? { sort_order: body.sortOrder } : {}),
          ...(body.status ? { status: body.status } : {}),
        })
        .where('id', '=', addonId)
        .returningAll()
        .executeTakeFirstOrThrow();
      await writeAudit(trx, {
        actorType: 'user',
        actorId: a.userId,
        action: 'service_addon.updated',
        targetType: 'service_addon',
        targetId: addonId,
        businessId: a.businessId,
        diff: {
          fields: Object.keys(body),
          ...(body.priceFils !== undefined
            ? { priceFils: { from: current.price_fils, to: body.priceFils } }
            : {}),
        },
        requestId: a.meta.requestId,
      });
      return addonView(row);
    });
  }

  // -------------------------------------------------------------------------------------------
  // Business: portfolio

  async listPortfolio(businessId: string): Promise<{ items: PortfolioItem[] }> {
    const rows = await this.db
      .selectFrom('portfolio_items as p')
      .innerJoin('media as m', 'm.id', 'p.media_id')
      .selectAll('p')
      .select('m.object_key')
      .where('p.business_id', '=', businessId)
      .orderBy('p.sort_order')
      .orderBy('p.created_at', 'desc')
      .execute();
    return { items: rows.map((r) => this.portfolioView(r)) };
  }

  async addPortfolioItem(a: Actor, body: CreatePortfolioItemRequest): Promise<PortfolioItem> {
    return this.db.transaction().execute(async (trx) => {
      await trx
        .selectFrom('businesses')
        .select('id')
        .where('id', '=', a.businessId)
        .forUpdate()
        .executeTakeFirstOrThrow();
      const media = await trx
        .selectFrom('media')
        .select(['id', 'status', 'purpose', 'object_key'])
        .where('id', '=', body.mediaId)
        .where('business_id', '=', a.businessId)
        .executeTakeFirst();
      if (!media || media.purpose !== 'portfolio_image') throw notFound();
      if (media.status !== 'ready') {
        throw new ApiError(
          HttpStatus.CONFLICT,
          'MEDIA_NOT_READY',
          'Finish uploading the photo first.',
        );
      }
      if (body.serviceId) await this.ownService(trx, a.businessId, body.serviceId);
      if (body.staffId) {
        const st = await trx
          .selectFrom('staff')
          .select('id')
          .where('id', '=', body.staffId)
          .where('business_id', '=', a.businessId)
          .executeTakeFirst();
        if (!st) throw notFound();
      }
      const count = await trx
        .selectFrom('portfolio_items')
        .select((eb) => eb.fn.countAll<string>().as('n'))
        .where('business_id', '=', a.businessId)
        .executeTakeFirstOrThrow();
      if (Number(count.n) >= PORTFOLIO_ITEMS_MAX) {
        throw new ApiError(
          HttpStatus.CONFLICT,
          'PORTFOLIO_LIMIT',
          `A portfolio can hold at most ${PORTFOLIO_ITEMS_MAX} photos.`,
        );
      }
      let row;
      try {
        row = await trx
          .insertInto('portfolio_items')
          .values({
            business_id: a.businessId,
            media_id: body.mediaId,
            service_id: body.serviceId ?? null,
            staff_id: body.staffId ?? null,
            caption: body.caption ? JSON.stringify(body.caption) : null,
            sort_order: body.sortOrder,
            created_by: a.userId,
          })
          .returningAll()
          .executeTakeFirstOrThrow();
      } catch (error) {
        if ((error as { constraint?: string }).constraint === 'portfolio_items_media_id_key') {
          throw new ApiError(
            HttpStatus.CONFLICT,
            'MEDIA_IN_USE',
            'That photo is already in the portfolio.',
          );
        }
        throw error;
      }
      await writeAudit(trx, {
        actorType: 'user',
        actorId: a.userId,
        action: 'portfolio.added',
        targetType: 'portfolio_item',
        targetId: row.id,
        businessId: a.businessId,
        diff: { mediaId: body.mediaId, serviceId: body.serviceId ?? null },
        requestId: a.meta.requestId,
      });
      return this.portfolioView({ ...row, object_key: media.object_key });
    });
  }

  async removePortfolioItem(a: Actor, itemId: string): Promise<{ items: PortfolioItem[] }> {
    await this.db.transaction().execute(async (trx) => {
      const row = await trx
        .deleteFrom('portfolio_items')
        .where('id', '=', itemId)
        .where('business_id', '=', a.businessId)
        .returning(['id', 'media_id'])
        .executeTakeFirst();
      if (!row) throw notFound();
      await writeAudit(trx, {
        actorType: 'user',
        actorId: a.userId,
        action: 'portfolio.removed',
        targetType: 'portfolio_item',
        targetId: row.id,
        businessId: a.businessId,
        diff: { mediaId: row.media_id },
        requestId: a.meta.requestId,
      });
    });
    return this.listPortfolio(a.businessId);
  }

  private portfolioView(r: {
    id: string;
    media_id: string;
    caption: Localized | null;
    service_id: string | null;
    staff_id: string | null;
    sort_order: number;
    created_at: Date;
    object_key: string;
  }): PortfolioItem {
    return {
      id: r.id,
      mediaId: r.media_id,
      // Members see the photo before the storefront is public, so sign it directly.
      imageUrl: this.storage.signDownload(r.object_key, {
        expiresAt: addSeconds(this.clock.now(), DOWNLOAD_URL_TTL_SECONDS),
        disposition: 'inline',
      }).url,
      caption: r.caption,
      serviceId: r.service_id,
      staffId: r.staff_id,
      sortOrder: r.sort_order,
      createdAt: r.created_at.toISOString(),
    };
  }
}

function addonView(r: {
  id: string;
  service_id: string;
  title: Localized;
  price_fils: number;
  duration_min: number;
  sort_order: number;
  status: 'active' | 'archived';
}): Addon {
  return {
    id: r.id,
    serviceId: r.service_id,
    title: r.title,
    priceFils: r.price_fils,
    durationMin: r.duration_min,
    sortOrder: r.sort_order,
    status: r.status,
  };
}
