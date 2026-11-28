import { HttpStatus, Inject, Injectable, Logger } from '@nestjs/common';
import type {
  Availability,
  AvailabilityQuery,
  Booking,
  BookingActionRequest,
  BookingListQuery,
  CancelBookingRequest,
  HoldRequest,
  ManualBookingRequest,
  MerchantBooking,
  TravelUpdateRequest,
  MerchantBookingListQuery,
  PayBookingResponse,
  PublicVenue,
  RescheduleRequest,
} from '@jays/contracts';
import type { BookedAddon, Db, HomeAddress } from '@jays/db';
import { sql, type SqlBool } from 'kysely';

type Localized = { en: string; ar: string };
import {
  addDays,
  availableSlots,
  BOOKING_HOLD_MINUTES,
  BOOKING_HORIZON_DAYS,
  BookingRuleError,
  businessCapabilities,
  businessTransition,
  canCustomerReschedule,
  cancellationRefund,
  noShowRefund,
  travelTransition,
  DEFAULT_TIMEZONE,
  extractInclusiveTax,
  fils,
  homeVisitTerms,
  HomeVisitError,
  localDateOf,
  localToUtc,
  MAX_ACTIVE_HOLDS_PER_USER,
  AddonError,
  PORTFOLIO_ITEMS_MAX,
  pickAddons,
  ratingSummary,
  offersLocation,
  rankStaff,
  type BookingLocation,
  type ServiceLocationMode,
  withTravel,
} from '@jays/domain';
import type { BusinessContext } from '../businesses/business-access.guard.js';
import { writeAudit } from '../common/audit.js';
import { CLOCK, type Clock } from '../common/clock.js';
import { ApiError } from '../common/error.filter.js';
import { idempotent } from '../common/idempotency.js';
import { decodeCursor, encodeCursor } from '../common/pagination.js';
import type { RequestMeta } from '../common/request-context.js';
import { DB } from '../common/tokens.js';
import { currentTaxRates } from '../commerce/checkout.service.js';
import { API_ENV, type ApiEnv } from '../config.js';
import { PaymentsService, type RefundJob } from '../payments/payments.service.js';
import { PAYMENT_PROVIDER, type PaymentProvider } from '../payments/provider.js';
import { homeTermsOf } from './home-services.service.js';
import {
  BOOKING_COLUMNS,
  type BookingRow,
  type BookingSnapshot,
  type Conn,
  customerBookingView,
  dailyLoads,
  expireHolds,
  loadDay,
  bookingAmounts,
  merchantBookingView,
  notFound,
  type PolicySnapshot,
  qualifiedStaff,
  ruleError,
  shareLock,
  slotUnavailable,
  type Trx,
  tryExclusive,
  weeklyHours,
} from './booking-shared.js';

interface ServiceRow {
  id: string;
  business_id: string;
  title: Localized;
  price_fils: number;
  tax_class: 'standard' | 'zero_rated' | 'exempt';
  duration_min: number;
  buffer_before_min: number;
  buffer_after_min: number;
  cancel_cutoff_hours: number;
  late_cancel_refund_bps: number;
  no_show_refund_bps: number;
  location_mode: ServiceLocationMode;
}

interface BranchRow {
  id: string;
  business_id: string;
  name: Localized;
  emirate_code: string;
  area: string;
  street: string;
  building: string;
  timezone: string;
}

/**
 * Public venues and availability, customer bookings (hold, pay, cancel, reschedule) and the
 * business calendar (docs/05-workflows.md, Appointment).
 *
 * Double booking is impossible by construction: every allocation inserts or moves a row covered
 * by the `bookings_no_overlap` exclusion constraint, inside a transaction that first expires
 * stale holds and share-locks the branch and staff rows (schedule edits take them FOR UPDATE).
 * Availability shown to customers is computed from the same data, but the constraint decides.
 */
@Injectable()
export class BookingsService {
  private readonly log = new Logger(BookingsService.name);

  constructor(
    @Inject(DB) private readonly db: Db,
    @Inject(CLOCK) private readonly clock: Clock,
    @Inject(API_ENV) private readonly env: ApiEnv,
    @Inject(PAYMENT_PROVIDER) private readonly provider: PaymentProvider,
    @Inject(PaymentsService) private readonly payments: PaymentsService,
  ) {}

  // -------------------------------------------------------------------------------------------
  // Public

  /** Businesses customers can book: approved, storefront published, services mode active. */
  visibleBusiness(conn: Conn, businessId: string) {
    return conn
      .selectFrom('businesses as b')
      .innerJoin('storefronts as s', 's.business_id', 'b.id')
      .select([
        'b.id',
        's.live_name',
        's.live_description',
        's.live_logo_media_id',
        'b.display_name',
      ])
      .where('b.id', '=', businessId)
      .where('b.status', '=', 'approved')
      .where('s.published_at', 'is not', null)
      .where(({ exists, selectFrom }) =>
        exists(
          selectFrom('business_modes as m')
            .select('m.id')
            .whereRef('m.business_id', '=', 'b.id')
            .where('m.mode', '=', 'services')
            .where('m.status', '=', 'active'),
        ),
      )
      .executeTakeFirst();
  }

  async venue(businessId: string): Promise<PublicVenue> {
    const business = await this.visibleBusiness(this.db, businessId);
    if (!business) throw notFound();
    // Branches in an emirate an admin switched off are not offered (D11).
    const branches = await this.db
      .selectFrom('branches')
      .selectAll()
      .where('business_id', '=', businessId)
      .where('status', '=', 'active')
      .where('emirate_code', 'in', (eb) =>
        eb.selectFrom('emirates').select('code').where('enabled', '=', true),
      )
      .orderBy('created_at')
      .orderBy('id')
      .execute();
    const branchIds = branches.map((b) => b.id);
    const services = await this.db
      .selectFrom('services')
      .selectAll()
      .where('business_id', '=', businessId)
      .where('status', '=', 'active')
      .where(sql<SqlBool>`category_is_live(category_id)`)
      .orderBy('created_at')
      .orderBy('id')
      .execute();
    const serviceIds = services.map((s) => s.id);
    const [branchServices, staff, staffBranches, staffServices] = await Promise.all([
      branchIds.length && serviceIds.length
        ? this.db
            .selectFrom('branch_services')
            .select(['branch_id', 'service_id'])
            .where('branch_id', 'in', branchIds)
            .where('service_id', 'in', serviceIds)
            .execute()
        : [],
      this.db
        .selectFrom('staff')
        .select(['id', 'display_name', 'bio'])
        .where('business_id', '=', businessId)
        .where('status', '=', 'active')
        .orderBy('display_name')
        .orderBy('id')
        .execute(),
      branchIds.length
        ? this.db
            .selectFrom('staff_branches')
            .select(['staff_id', 'branch_id'])
            .where('branch_id', 'in', branchIds)
            .execute()
        : [],
      serviceIds.length
        ? this.db
            .selectFrom('staff_services')
            .select(['staff_id', 'service_id'])
            .where('service_id', 'in', serviceIds)
            .execute()
        : [],
    ]);
    const base = this.env.API_PUBLIC_URL.replace(/\/$/, '');
    const [addons, ratings, portfolio] = await Promise.all([
      serviceIds.length
        ? this.db
            .selectFrom('service_addons')
            .select(['id', 'service_id', 'title', 'price_fils', 'duration_min'])
            .where('service_id', 'in', serviceIds)
            .where('status', '=', 'active')
            .orderBy('sort_order')
            .orderBy('created_at')
            .execute()
        : [],
      venueRatings(this.db, businessId),
      publicPortfolio(this.db, businessId, base),
    ]);
    const home = await homeTermsOf(this.db, businessId, this.clock.now());
    const enabled = new Set(
      (
        await this.db.selectFrom('emirates').select('code').where('enabled', '=', true).execute()
      ).map((e) => e.code),
    );
    const homeAreas = home?.areas.filter((a) => enabled.has(a.emirate)) ?? [];
    const homeOpen = homeAreas.length > 0;
    // Without active home services, home-only services are hidden and "both" means the venue.
    const effectiveMode = (mode: ServiceLocationMode): ServiceLocationMode | null =>
      homeOpen ? mode : mode === 'home' ? null : 'in_venue';
    return {
      id: business.id,
      name: business.live_name ?? business.display_name,
      description: business.live_description,
      logoUrl: business.live_logo_media_id ? `${base}/media/${business.live_logo_media_id}` : null,
      branches: await Promise.all(
        branches.map(async (b) => ({
          id: b.id,
          name: b.name,
          emirate: b.emirate_code as PublicVenue['branches'][number]['emirate'],
          area: b.area,
          street: b.street,
          building: b.building,
          timezone: b.timezone,
          hours: await weeklyHours(this.db, b.id),
        })),
      ),
      services: services
        .map((s) => ({
          id: s.id,
          title: s.title,
          description: s.description,
          priceFils: s.price_fils,
          durationMin: s.duration_min,
          cancelCutoffHours: s.cancel_cutoff_hours,
          lateCancelRefundBps: s.late_cancel_refund_bps,
          noShowRefundBps: s.no_show_refund_bps,
          locationMode: effectiveMode(s.location_mode)!,
          branchIds: branchServices.filter((x) => x.service_id === s.id).map((x) => x.branch_id),
          addons: addons
            .filter((a) => a.service_id === s.id)
            .map((a) => ({
              id: a.id,
              title: a.title,
              priceFils: a.price_fils,
              durationMin: a.duration_min,
            })),
          rating: ratings.services.get(s.id) ?? null,
        }))
        .filter((s) => s.branchIds.length > 0 && s.locationMode !== null),
      homeServices:
        home && homeOpen
          ? {
              minOrderFils: home.minOrderFils,
              areas: homeAreas.map((a) => ({
                emirate: a.emirate as PublicVenue['branches'][number]['emirate'],
                area: a.area,
                travelFeeFils: a.travelFeeFils,
              })),
            }
          : null,
      staff: staff
        .map((s) => ({
          id: s.id,
          displayName: s.display_name,
          bio: s.bio,
          branchIds: staffBranches.filter((x) => x.staff_id === s.id).map((x) => x.branch_id),
          serviceIds: staffServices.filter((x) => x.staff_id === s.id).map((x) => x.service_id),
          rating: ratings.staff.get(s.id) ?? null,
        }))
        .filter((s) => s.branchIds.length > 0 && s.serviceIds.length > 0),
      portfolio: portfolio.filter(
        (p) =>
          (p.serviceId === null || serviceIds.includes(p.serviceId)) &&
          (p.staffId === null || staff.some((x) => x.id === p.staffId)),
      ),
      rating: ratings.venue,
    };
  }

  /** Bookable start times for a service at a branch on a local date (T14: in branch time). */
  async availability(query: AvailabilityQuery): Promise<Availability> {
    const { branch, service } = await this.bookable(this.db, query.branchId, query.serviceId, true);
    const now = this.clock.now();
    this.assertInHorizon(query.date, branch.timezone, now);
    const travel = await this.travelFor(this.db, service, query.location, null, now);
    const extras = await this.addonsFor(this.db, service, query.addonIds ?? []);
    let staffIds = await qualifiedStaff(this.db, branch.business_id, branch.id, service.id);
    if (query.staffId) staffIds = staffIds.filter((id) => id === query.staffId);
    const input = await loadDay(this.db, {
      branch,
      service: withTravel(
        withAddons(durations(service), extras.durationMin),
        travel.travelBufferMin,
      ),
      staffIds,
      date: query.date,
      now,
    });
    return {
      date: query.date,
      timeZone: branch.timezone,
      slots: availableSlots(input).map((s) => ({
        startAt: s.startAt.toISOString(),
        endAt: s.endAt.toISOString(),
        staffIds: s.staffIds,
      })),
    };
  }

  private async bookable(conn: Conn, branchId: string, serviceId: string, requirePublic: boolean) {
    const branch = await conn
      .selectFrom('branches')
      .select([
        'id',
        'business_id',
        'name',
        'emirate_code',
        'area',
        'street',
        'building',
        'timezone',
      ])
      .where('id', '=', branchId)
      .where('status', '=', 'active')
      .executeTakeFirst();
    if (!branch) throw notFound();
    if (requirePublic && !(await this.visibleBusiness(conn, branch.business_id))) throw notFound();
    if (requirePublic) {
      const emirate = await conn
        .selectFrom('emirates')
        .select('enabled')
        .where('code', '=', branch.emirate_code)
        .executeTakeFirst();
      if (!emirate?.enabled) {
        throw new ApiError(
          HttpStatus.UNPROCESSABLE_ENTITY,
          'EMIRATE_NOT_AVAILABLE',
          'Bookings are not open in this emirate yet.',
        );
      }
    }
    const service = await conn
      .selectFrom('services as s')
      .innerJoin('branch_services as bs', (j) =>
        j.onRef('bs.service_id', '=', 's.id').on('bs.branch_id', '=', branchId),
      )
      .select([
        's.id',
        's.business_id',
        's.title',
        's.price_fils',
        's.tax_class',
        's.duration_min',
        's.buffer_before_min',
        's.buffer_after_min',
        's.cancel_cutoff_hours',
        's.late_cancel_refund_bps',
        's.no_show_refund_bps',
        's.location_mode',
      ])
      .where('s.id', '=', serviceId)
      .where('s.status', '=', 'active')
      .$if(requirePublic, (q) => q.where(sql<SqlBool>`category_is_live(s.category_id)`))
      .executeTakeFirst();
    if (!service) throw notFound();
    return { branch: branch as BranchRow, service: service as ServiceRow };
  }

  /** The chosen add-ons of a service, checked and totalled (phase 8.7). */
  private async addonsFor(conn: Conn, service: ServiceRow, ids: readonly string[]) {
    if (ids.length === 0) return { addons: [] as BookedAddon[], priceFils: 0, durationMin: 0 };
    const rows = await conn
      .selectFrom('service_addons')
      .select(['id', 'title', 'price_fils', 'duration_min'])
      .where('service_id', '=', service.id)
      .where('status', '=', 'active')
      .orderBy('sort_order')
      .orderBy('created_at')
      .execute();
    try {
      return pickAddons(
        rows.map((r) => ({
          id: r.id,
          title: r.title,
          priceFils: r.price_fils,
          durationMin: r.duration_min,
        })),
        ids,
        service.duration_min,
      );
    } catch (error) {
      if (error instanceof AddonError) {
        throw new ApiError(HttpStatus.UNPROCESSABLE_ENTITY, error.code, error.message);
      }
      throw error;
    }
  }

  /**
   * Travel terms for a location. A venue booking has none. For a home visit the business must
   * be approved with an unexpired licence; with an address, it must also be covered and the
   * service at or above the minimum (D9). Without an address (availability), any coverage will do.
   */
  private async travelFor(
    conn: Conn,
    service: ServiceRow,
    location: BookingLocation,
    address: { emirate: string; area: string } | null,
    now: Date,
  ): Promise<{ travelFeeFils: number; travelBufferMin: number }> {
    if (location === 'venue') {
      if (!offersLocation(service.location_mode, 'venue')) {
        throw new ApiError(
          HttpStatus.UNPROCESSABLE_ENTITY,
          'LOCATION_NOT_OFFERED',
          'This service is offered only at your address.',
        );
      }
      return { travelFeeFils: 0, travelBufferMin: 0 };
    }
    const terms = await homeTermsOf(conn, service.business_id, now);
    try {
      if (address) {
        return homeVisitTerms({
          profile: terms,
          serviceMode: service.location_mode,
          servicePriceFils: service.price_fils,
          areas: terms?.areas ?? [],
          address,
        });
      }
      const any = terms?.areas[0];
      return homeVisitTerms({
        profile: terms,
        serviceMode: service.location_mode,
        servicePriceFils: service.price_fils,
        areas: terms?.areas ?? [],
        address: any ? { emirate: any.emirate, area: any.area ?? '' } : { emirate: '', area: '' },
      });
    } catch (error) {
      if (error instanceof HomeVisitError) {
        throw new ApiError(HttpStatus.UNPROCESSABLE_ENTITY, error.code, error.message);
      }
      throw error;
    }
  }

  /** One of the customer's saved addresses, in an emirate that is open (D11). */
  private async homeAddress(conn: Conn, userId: string, addressId: string): Promise<HomeAddress> {
    const a = await conn
      .selectFrom('addresses as a')
      .innerJoin('emirates as e', 'e.code', 'a.emirate_code')
      .select([
        'a.id',
        'a.label',
        'a.emirate_code',
        'a.area',
        'a.street',
        'a.building',
        'a.unit',
        'a.directions',
        'e.enabled',
      ])
      .where('a.id', '=', addressId)
      .where('a.user_id', '=', userId)
      .where('a.archived_at', 'is', null)
      .executeTakeFirst();
    if (!a) {
      throw new ApiError(
        HttpStatus.BAD_REQUEST,
        'VALIDATION_FAILED',
        'Pick one of your addresses.',
        {
          addressId: ['unknown address'],
        },
      );
    }
    if (!a.enabled) {
      throw new ApiError(
        HttpStatus.UNPROCESSABLE_ENTITY,
        'EMIRATE_NOT_AVAILABLE',
        'Bookings are not open in this emirate yet.',
      );
    }
    return {
      addressId: a.id,
      label: a.label,
      emirate: a.emirate_code,
      area: a.area,
      street: a.street,
      building: a.building,
      unit: a.unit,
      directions: a.directions,
    };
  }

  private assertInHorizon(date: string, timeZone: string, now: Date) {
    const today = localDateOf(now, timeZone);
    if (date < today || date > addDays(today, BOOKING_HORIZON_DAYS)) {
      throw new ApiError(
        HttpStatus.UNPROCESSABLE_ENTITY,
        'OUTSIDE_BOOKING_WINDOW',
        `Bookings open up to ${BOOKING_HORIZON_DAYS} days ahead.`,
        { date: [`between today and ${BOOKING_HORIZON_DAYS} days ahead`] },
      );
    }
  }

  // -------------------------------------------------------------------------------------------
  // Allocation

  /**
   * Picks staff for a start time and inserts (or moves) the booking. Candidates are the staff
   * free for that slot, in "any professional" order unless one was requested; an exclusion
   * violation from a concurrent allocation moves on to the next candidate.
   */
  private async allocate<T>(
    trx: Trx,
    input: {
      branch: BranchRow;
      service: { durationMin: number; bufferBeforeMin: number; bufferAfterMin: number };
      serviceId: string;
      startAt: Date;
      staffId: string | null;
      prefer?: string;
      excludeBookingId?: string;
      now: Date;
    },
    write: (staffId: string, times: Times) => Promise<T>,
  ): Promise<T> {
    const { branch, service, now } = input;
    const date = localDateOf(input.startAt, branch.timezone);
    this.assertInHorizon(date, branch.timezone, now);
    let staffIds = await qualifiedStaff(trx, branch.business_id, branch.id, input.serviceId);
    if (input.staffId) staffIds = staffIds.filter((id) => id === input.staffId);
    await shareLock(trx, branch.id, staffIds);
    const day = await loadDay(trx, {
      branch,
      service,
      staffIds,
      date,
      now,
      excludeBookingId: input.excludeBookingId,
    });
    const slot = availableSlots(day).find((s) => s.startAt.getTime() === input.startAt.getTime());
    if (!slot) throw slotUnavailable();
    let ranked = rankStaff(
      slot.staffIds,
      await dailyLoads(trx, slot.staffIds, date, branch.timezone),
    );
    if (input.prefer && ranked.includes(input.prefer)) {
      ranked = [input.prefer, ...ranked.filter((id) => id !== input.prefer)];
    }
    const times: Times = {
      start: input.startAt,
      end: new Date(input.startAt.getTime() + service.durationMin * 60_000),
      occupiedStart: new Date(input.startAt.getTime() - service.bufferBeforeMin * 60_000),
      occupiedEnd: new Date(
        input.startAt.getTime() + (service.durationMin + service.bufferAfterMin) * 60_000,
      ),
    };
    for (const staffId of ranked) {
      const result = await tryExclusive(trx, () => write(staffId, times));
      if (result !== null) return result;
    }
    throw slotUnavailable();
  }

  private async snapshot(
    conn: Conn,
    branch: BranchRow,
    service: ServiceRow,
    staffId: string,
    addonsMin = 0,
  ): Promise<BookingSnapshot> {
    const [business, staff] = await Promise.all([
      conn
        .selectFrom('businesses as b')
        .leftJoin('storefronts as s', 's.business_id', 'b.id')
        .select(['b.display_name', 's.live_name'])
        .where('b.id', '=', branch.business_id)
        .executeTakeFirstOrThrow(),
      conn
        .selectFrom('staff')
        .select(['id', 'display_name'])
        .where('id', '=', staffId)
        .executeTakeFirstOrThrow(),
    ]);
    return {
      business: { id: branch.business_id, name: business.live_name ?? business.display_name },
      branch: {
        id: branch.id,
        name: branch.name,
        emirate: branch.emirate_code,
        area: branch.area,
        street: branch.street,
        building: branch.building,
        timezone: branch.timezone,
      },
      service: {
        id: service.id,
        title: service.title,
        ...withAddons(durations(service), addonsMin),
      },
      staff: { id: staff.id, displayName: staff.display_name },
    };
  }

  private async priceOf(
    conn: Conn,
    service: ServiceRow,
    now: Date,
    travelFeeFils = 0,
    addonsFils = 0,
  ) {
    const [rates, business] = await Promise.all([
      currentTaxRates(conn, now),
      conn
        .selectFrom('businesses')
        .select('tax_registered')
        .where('id', '=', service.business_id)
        .executeTakeFirstOrThrow(),
    ]);
    // D4: prices include VAT; a business that is not VAT registered charges none.
    const bps = business.tax_registered ? rates[service.tax_class] : 0;
    // Add-ons and the travel fee are part of the same supply, so they take the service's VAT
    // treatment.
    const total = service.price_fils + addonsFils + travelFeeFils;
    return {
      price_fils: total,
      tax_fils: extractInclusiveTax(fils(total), bps, 'half_up'),
    };
  }

  // -------------------------------------------------------------------------------------------
  // Customer

  /**
   * Holds a slot for 10 minutes (appointment step 2). Same Idempotency-Key, same booking.
   * 409 SLOT_UNAVAILABLE when nobody qualified is free, 409 HOLD_LIMIT after two open holds.
   */
  hold(userId: string, body: HoldRequest, key: string | undefined, meta: RequestMeta) {
    return idempotent(
      this.db,
      { actorType: 'user', actorId: userId, route: 'POST /bookings/hold' },
      key,
      body,
      async () => {
        const id = await this.db.transaction().execute(async (trx) => {
          const now = this.clock.now();
          await expireHolds(trx, now);
          const user = await trx
            .selectFrom('users')
            .select(['id', 'display_name', 'phone'])
            .where('id', '=', userId)
            .forUpdate()
            .executeTakeFirstOrThrow();
          const open = await trx
            .selectFrom('bookings')
            .select((eb) => eb.fn.countAll<string>().as('n'))
            .where('user_id', '=', userId)
            .where('status', '=', 'held')
            .executeTakeFirstOrThrow();
          if (Number(open.n) >= MAX_ACTIVE_HOLDS_PER_USER) {
            throw new ApiError(
              HttpStatus.CONFLICT,
              'HOLD_LIMIT',
              'Finish or let go of your other held appointments first.',
            );
          }
          const { branch, service } = await this.bookable(trx, body.branchId, body.serviceId, true);
          const address =
            body.location === 'home' && body.addressId
              ? await this.homeAddress(trx, userId, body.addressId)
              : null;
          const travel = await this.travelFor(trx, service, body.location, address, now);
          const extras = await this.addonsFor(trx, service, body.addonIds ?? []);
          const price = await this.priceOf(
            trx,
            service,
            now,
            travel.travelFeeFils,
            extras.priceFils,
          );
          const policy: PolicySnapshot = {
            cutoffHours: service.cancel_cutoff_hours,
            lateRefundBps: service.late_cancel_refund_bps,
            noShowRefundBps: service.no_show_refund_bps,
          };
          const booking = await this.allocate(
            trx,
            {
              branch,
              service: withTravel(
                withAddons(durations(service), extras.durationMin),
                travel.travelBufferMin,
              ),
              serviceId: service.id,
              startAt: new Date(body.startAt),
              staffId: body.staffId ?? null,
              now,
            },
            async (staffId, t) =>
              trx
                .insertInto('bookings')
                .values({
                  user_id: userId,
                  business_id: branch.business_id,
                  branch_id: branch.id,
                  service_id: service.id,
                  staff_id: staffId,
                  start_at: t.start,
                  end_at: t.end,
                  occupied_start: t.occupiedStart,
                  occupied_end: t.occupiedEnd,
                  status: 'held',
                  hold_expires_at: new Date(now.getTime() + BOOKING_HOLD_MINUTES * 60_000),
                  source: 'customer',
                  payment_mode: 'prepaid',
                  ...price,
                  snapshot: JSON.stringify(
                    await this.snapshot(trx, branch, service, staffId, extras.durationMin),
                  ),
                  policy_snapshot: JSON.stringify(policy),
                  customer_name: user.display_name,
                  customer_phone: user.phone,
                  note: body.note ?? null,
                  created_by: userId,
                  location_type: body.location,
                  home_address: address ? JSON.stringify(address) : null,
                  travel_fee_fils: travel.travelFeeFils,
                  travel_buffer_min: travel.travelBufferMin,
                  addons: JSON.stringify(extras.addons),
                  addons_fils: extras.priceFils,
                })
                .returning('id')
                .executeTakeFirstOrThrow(),
          );
          await writeAudit(trx, {
            actorType: 'user',
            actorId: userId,
            action: 'booking.held',
            targetType: 'booking',
            targetId: booking.id,
            businessId: branch.business_id,
            diff: {
              startAt: body.startAt,
              serviceId: service.id,
              location: body.location,
              addonIds: extras.addons.map((a) => a.id),
            },
            requestId: meta.requestId,
          });
          return booking.id;
        });
        return this.getForUser(userId, id);
      },
    );
  }

  /**
   * Opens (or reopens) the provider payment for a held booking (appointment step 3). The intent's
   * idempotency key is the booking's, so retries never create a second charge. The booking is
   * confirmed only by the verified webhook.
   */
  async pay(userId: string, bookingId: string): Promise<PayBookingResponse> {
    const now = this.clock.now();
    const booking = await this.db
      .selectFrom('bookings')
      .select(['id', 'status', 'hold_expires_at', 'price_fils'])
      .where('id', '=', bookingId)
      .where('user_id', '=', userId)
      .executeTakeFirst();
    if (!booking) throw notFound();
    const response = (intentId: string | null, secret: string | null): PayBookingResponse => ({
      bookingId: booking.id,
      status: booking.status,
      amountFils: booking.price_fils,
      currency: 'AED',
      holdExpiresAt:
        booking.status === 'held' ? (booking.hold_expires_at?.toISOString() ?? null) : null,
      paymentIntentId: intentId,
      paymentClientSecret: secret,
    });
    if (booking.status !== 'held') {
      if (booking.status === 'confirmed') return response(null, null);
      throw holdExpired();
    }
    if (!booking.hold_expires_at || booking.hold_expires_at <= now) throw holdExpired();
    const idempotencyKey = `booking-${booking.id}`;
    await this.db
      .insertInto('payments')
      .values({
        target_type: 'booking',
        booking_id: booking.id,
        order_id: null,
        provider: this.provider.name,
        idempotency_key: idempotencyKey,
        amount_fils: booking.price_fils,
        provider_intent_id: null,
        client_secret: null,
        failure_code: null,
        succeeded_at: null,
      })
      .onConflict((oc) => oc.column('idempotency_key').doNothing())
      .execute();
    const payment = await this.db
      .selectFrom('payments')
      .select(['id', 'status', 'provider_intent_id', 'client_secret', 'amount_fils'])
      .where('booking_id', '=', booking.id)
      .executeTakeFirstOrThrow();
    if (payment.status !== 'requires_payment') return response(null, null);
    if (payment.provider_intent_id) {
      return response(payment.provider_intent_id, payment.client_secret);
    }
    try {
      const intent = await this.provider.createIntent({
        amountFils: payment.amount_fils,
        currency: 'AED',
        idempotencyKey,
        metadata: { bookingId: booking.id },
      });
      await this.db
        .updateTable('payments')
        .set({ provider_intent_id: intent.intentId, client_secret: intent.clientSecret })
        .where('id', '=', payment.id)
        .where('provider_intent_id', 'is', null)
        .execute();
      return response(intent.intentId, intent.clientSecret);
    } catch (error) {
      this.log.warn({ err: error, bookingId }, 'payment intent creation failed');
      throw new ApiError(
        HttpStatus.SERVICE_UNAVAILABLE,
        'PAYMENT_PROVIDER_UNAVAILABLE',
        'Payment is unavailable right now. Your time is held; try again in a moment.',
      );
    }
  }

  async listForUser(userId: string, query: BookingListQuery) {
    const now = this.clock.now();
    const key = decodeCursor(query.cursor);
    const upcoming = query.scope === 'upcoming';
    let q = this.db
      .selectFrom('bookings as b')
      .select(BOOKING_COLUMNS)
      .where('b.user_id', '=', userId);
    q = upcoming
      ? q.where('b.end_at', '>', now).where('b.status', 'in', ['held', 'confirmed', 'checked_in'])
      : q.where((eb) =>
          eb.or([
            eb('b.end_at', '<=', now),
            eb('b.status', 'in', ['completed', 'canceled', 'no_show', 'expired']),
          ]),
        );
    if (key) {
      const ts = new Date(key.ts);
      q = q.where((eb) =>
        upcoming
          ? eb.or([
              eb('b.start_at', '>', ts),
              eb.and([eb('b.start_at', '=', ts), eb('b.id', '>', key.id)]),
            ])
          : eb.or([
              eb('b.start_at', '<', ts),
              eb.and([eb('b.start_at', '=', ts), eb('b.id', '<', key.id)]),
            ]),
      );
    }
    const dir = upcoming ? 'asc' : 'desc';
    const rows = (await q
      .orderBy('b.start_at', dir)
      .orderBy('b.id', dir)
      .limit(query.limit + 1)
      .execute()) as BookingRow[];
    const page = rows.slice(0, query.limit);
    const payments = await this.paymentsFor(page.map((r) => r.id));
    const last = page.at(-1);
    return {
      items: page.map((r) => customerBookingView(r, now, payments.get(r.id) ?? null)),
      nextCursor:
        rows.length > query.limit && last
          ? encodeCursor({ ts: last.start_at.toISOString(), id: last.id })
          : null,
    };
  }

  async getForUser(userId: string, bookingId: string): Promise<Booking> {
    const row = (await this.db
      .selectFrom('bookings as b')
      .select(BOOKING_COLUMNS)
      .where('b.id', '=', bookingId)
      .where('b.user_id', '=', userId)
      .executeTakeFirst()) as BookingRow | undefined;
    if (!row) throw notFound();
    const payments = await this.paymentsFor([row.id]);
    return customerBookingView(row, this.clock.now(), payments.get(row.id) ?? null);
  }

  private async paymentsFor(bookingIds: string[]) {
    const map = new Map<
      string,
      { status: string; provider_intent_id: string | null; client_secret: string | null }
    >();
    if (bookingIds.length === 0) return map;
    const rows = await this.db
      .selectFrom('payments')
      .select(['booking_id', 'status', 'provider_intent_id', 'client_secret'])
      .where('booking_id', 'in', bookingIds)
      .execute();
    for (const r of rows) if (r.booking_id) map.set(r.booking_id, r);
    return map;
  }

  /**
   * Customer cancellation (T09). A held booking is simply released. A confirmed one is refunded
   * by its policy snapshot: in full up to the cutoff, then the late share; never after the start.
   */
  async cancelForUser(
    userId: string,
    bookingId: string,
    body: CancelBookingRequest,
    meta: RequestMeta,
  ): Promise<Booking> {
    let refund: RefundJob | null = null;
    await this.db.transaction().execute(async (trx) => {
      const now = this.clock.now();
      const b = await trx
        .selectFrom('bookings')
        .select([
          'id',
          'status',
          'start_at',
          'price_fils',
          'policy_snapshot',
          'business_id',
          'travel_fee_fils',
          'travel_status',
        ])
        .where('id', '=', bookingId)
        .where('user_id', '=', userId)
        .forUpdate()
        .executeTakeFirst();
      if (!b) throw notFound();
      let refundFils = 0;
      let travelFils = 0;
      if (b.status === 'confirmed') {
        try {
          ({ refundFils, travelFils } = cancellationRefund({
            priceFils: b.price_fils,
            startAt: b.start_at,
            now,
            policy: b.policy_snapshot as PolicySnapshot,
            by: 'customer',
            travelFeeFils: b.travel_fee_fils,
            travelStarted: (b.travel_status ?? 'not_started') !== 'not_started',
          }));
        } catch (error) {
          if (error instanceof BookingRuleError) throw ruleError(error);
          throw error;
        }
      } else if (b.status !== 'held') {
        throw new ApiError(
          HttpStatus.CONFLICT,
          'INVALID_TRANSITION',
          `Cannot cancel a ${b.status} booking.`,
        );
      }
      await trx
        .updateTable('bookings')
        .set({
          status: 'canceled',
          canceled_at: now,
          canceled_by: 'customer',
          cancel_reason: body.reason ?? null,
          refund_fils: refundFils,
          version: (eb) => eb('version', '+', 1),
        })
        .where('id', '=', b.id)
        .execute();
      refund = await this.refundFor(
        trx,
        b.id,
        { amountFils: refundFils, travelFils },
        'customer_cancellation',
        now,
      );
      await this.outbox(trx, 'booking.canceled', { bookingId: b.id, by: 'customer' }, now);
      await writeAudit(trx, {
        actorType: 'user',
        actorId: userId,
        action: 'booking.canceled',
        targetType: 'booking',
        targetId: b.id,
        businessId: b.business_id,
        diff: { by: 'customer', refundFils, travelRefundFils: travelFils },
        requestId: meta.requestId,
      });
    });
    if (refund) await this.payments.issueRefund(refund);
    return this.getForUser(userId, bookingId);
  }

  /**
   * Moves a confirmed booking to another time (and possibly another professional) at the same
   * branch, in place: one UPDATE under the exclusion constraint, so on any conflict the original
   * booking stays exactly as it was. Allowed until the free-cancellation cutoff.
   */
  async rescheduleForUser(
    userId: string,
    bookingId: string,
    body: RescheduleRequest,
    meta: RequestMeta,
  ): Promise<Booking> {
    await this.db.transaction().execute(async (trx) => {
      const now = this.clock.now();
      await expireHolds(trx, now);
      const b = await trx
        .selectFrom('bookings')
        .select([
          'id',
          'status',
          'start_at',
          'branch_id',
          'service_id',
          'staff_id',
          'snapshot',
          'policy_snapshot',
          'business_id',
          'travel_buffer_min',
        ])
        .where('id', '=', bookingId)
        .where('user_id', '=', userId)
        .forUpdate()
        .executeTakeFirst();
      if (!b) throw notFound();
      if (
        !canCustomerReschedule({
          status: b.status,
          startAt: b.start_at,
          now,
          policy: b.policy_snapshot as PolicySnapshot,
        })
      ) {
        throw new ApiError(
          HttpStatus.UNPROCESSABLE_ENTITY,
          'RESCHEDULE_NOT_ALLOWED',
          'This appointment can no longer be moved.',
        );
      }
      const snap = b.snapshot as BookingSnapshot;
      const branch = await trx
        .selectFrom('branches')
        .select([
          'id',
          'business_id',
          'name',
          'emirate_code',
          'area',
          'street',
          'building',
          'timezone',
        ])
        .where('id', '=', b.branch_id)
        .where('status', '=', 'active')
        .executeTakeFirst();
      if (!branch) throw slotUnavailable();
      await this.allocate(
        trx,
        {
          branch: branch as BranchRow,
          // The booking keeps the duration, buffers and travel time it was made with (T13).
          service: withTravel(
            {
              durationMin: snap.service.durationMin,
              bufferBeforeMin: snap.service.bufferBeforeMin,
              bufferAfterMin: snap.service.bufferAfterMin,
            },
            b.travel_buffer_min,
          ),
          serviceId: b.service_id,
          startAt: new Date(body.startAt),
          staffId: body.staffId ?? null,
          prefer: b.staff_id,
          excludeBookingId: b.id,
          now,
        },
        async (staffId, t) => {
          const staff = await trx
            .selectFrom('staff')
            .select(['id', 'display_name'])
            .where('id', '=', staffId)
            .executeTakeFirstOrThrow();
          const next: BookingSnapshot = {
            ...snap,
            staff: { id: staff.id, displayName: staff.display_name },
          };
          return trx
            .updateTable('bookings')
            .set({
              staff_id: staffId,
              start_at: t.start,
              end_at: t.end,
              occupied_start: t.occupiedStart,
              occupied_end: t.occupiedEnd,
              snapshot: JSON.stringify(next),
              rescheduled_count: (eb) => eb('rescheduled_count', '+', 1),
              version: (eb) => eb('version', '+', 1),
            })
            .where('id', '=', b.id)
            .returning('id')
            .executeTakeFirstOrThrow();
        },
      );
      await this.outbox(trx, 'booking.rescheduled', { bookingId: b.id }, now);
      await writeAudit(trx, {
        actorType: 'user',
        actorId: userId,
        action: 'booking.rescheduled',
        targetType: 'booking',
        targetId: b.id,
        businessId: b.business_id,
        diff: { from: b.start_at.toISOString(), to: body.startAt },
        requestId: meta.requestId,
      });
    });
    return this.getForUser(userId, bookingId);
  }

  // -------------------------------------------------------------------------------------------
  // Business calendar

  /** Staff ids a member may see: all with appointments.view_all, else their own profile. */
  private async visibleStaff(ctx: BusinessContext): Promise<string[] | 'all'> {
    const caps = businessCapabilities(ctx.permissions);
    if (caps.has('appointments.view_all')) return 'all';
    if (!caps.has('appointments.view_own')) {
      throw new ApiError(HttpStatus.FORBIDDEN, 'FORBIDDEN', 'You cannot view appointments.');
    }
    const rows = await this.db
      .selectFrom('staff')
      .select('id')
      .where('business_id', '=', ctx.businessId)
      .where('membership_id', '=', ctx.membershipId)
      .execute();
    return rows.map((r) => r.id);
  }

  async listForBusiness(ctx: BusinessContext, query: MerchantBookingListQuery) {
    const visible = await this.visibleStaff(ctx);
    const empty = { items: [] as MerchantBooking[], nextCursor: null };
    if (visible !== 'all' && visible.length === 0) return empty;
    let timeZone = DEFAULT_TIMEZONE;
    if (query.branchId) {
      const branch = await this.db
        .selectFrom('branches')
        .select('timezone')
        .where('id', '=', query.branchId)
        .where('business_id', '=', ctx.businessId)
        .executeTakeFirst();
      if (!branch) throw notFound();
      timeZone = branch.timezone;
    }
    const from = localToUtc(query.from, 0, timeZone);
    const to = localToUtc(addDays(query.to, 1), 0, timeZone);
    const key = decodeCursor(query.cursor);
    let q = this.db
      .selectFrom('bookings as b')
      .leftJoin('payments as p', 'p.booking_id', 'b.id')
      .select([...BOOKING_COLUMNS, 'p.status as payment_status'])
      .where('b.business_id', '=', ctx.businessId)
      .where('b.start_at', '>=', from)
      .where('b.start_at', '<', to);
    if (visible !== 'all') q = q.where('b.staff_id', 'in', visible);
    if (query.branchId) q = q.where('b.branch_id', '=', query.branchId);
    if (query.staffId) q = q.where('b.staff_id', '=', query.staffId);
    q = query.status
      ? q.where('b.status', '=', query.status)
      : q.where('b.status', '<>', 'expired');
    if (key) {
      const ts = new Date(key.ts);
      q = q.where((eb) =>
        eb.or([
          eb('b.start_at', '>', ts),
          eb.and([eb('b.start_at', '=', ts), eb('b.id', '>', key.id)]),
        ]),
      );
    }
    const rows = await q
      .orderBy('b.start_at')
      .orderBy('b.id')
      .limit(query.limit + 1)
      .execute();
    const page = rows.slice(0, query.limit);
    const last = page.at(-1);
    return {
      items: page.map((r) => merchantBookingView(r as BookingRow, r.payment_status)),
      nextCursor:
        rows.length > query.limit && last
          ? encodeCursor({ ts: last.start_at.toISOString(), id: last.id })
          : null,
    };
  }

  async getForBusiness(ctx: BusinessContext, bookingId: string): Promise<MerchantBooking> {
    const visible = await this.visibleStaff(ctx);
    let q = this.db
      .selectFrom('bookings as b')
      .leftJoin('payments as p', 'p.booking_id', 'b.id')
      .select([...BOOKING_COLUMNS, 'p.status as payment_status'])
      .where('b.id', '=', bookingId)
      .where('b.business_id', '=', ctx.businessId);
    if (visible !== 'all') {
      if (visible.length === 0) throw notFound();
      q = q.where('b.staff_id', 'in', visible);
    }
    const row = await q.executeTakeFirst();
    if (!row) throw notFound();
    const travel = await this.db
      .selectFrom('booking_travel_events')
      .select(['status', 'occurred_at'])
      .where('booking_id', '=', bookingId)
      .orderBy('occurred_at')
      .execute();
    return {
      ...merchantBookingView(row as BookingRow, row.payment_status),
      amounts: await bookingAmounts(this.db, row as BookingRow),
      travelEvents: travel.map((t) => ({ status: t.status, at: t.occurred_at.toISOString() })),
    };
  }

  /**
   * Records a home visit's travel status (ADR-0025): "on the way", then "arrived". A scheduler
   * may record it for any professional; a professional only for their own visits. Each step is
   * kept in an append-only log with the time and who recorded it; the customer is told when the
   * professional sets off. Once travel has started, a late customer cancellation no longer gets
   * the travel fee back automatically.
   */
  async updateTravel(
    ctx: BusinessContext,
    userId: string,
    bookingId: string,
    body: TravelUpdateRequest,
    meta: RequestMeta,
  ): Promise<MerchantBooking> {
    const caps = businessCapabilities(ctx.permissions);
    const own = caps.has('bookings.schedule') ? 'all' : await this.visibleStaff(ctx);
    await this.db.transaction().execute(async (trx) => {
      const now = this.clock.now();
      const b = await trx
        .selectFrom('bookings')
        .select([
          'id',
          'status',
          'start_at',
          'version',
          'staff_id',
          'location_type',
          'travel_status',
        ])
        .where('id', '=', bookingId)
        .where('business_id', '=', ctx.businessId)
        .forUpdate()
        .executeTakeFirst();
      if (!b || (own !== 'all' && !own.includes(b.staff_id))) throw notFound();
      if (b.version !== body.expectedVersion) {
        throw new ApiError(
          HttpStatus.CONFLICT,
          'VERSION_CONFLICT',
          'This booking changed in the meantime. Reload and try again.',
        );
      }
      if (b.location_type !== 'home' || !b.travel_status) {
        throw new ApiError(
          HttpStatus.CONFLICT,
          'NOT_A_HOME_VISIT',
          'Travel status applies to home visits only.',
        );
      }
      try {
        travelTransition({
          bookingStatus: b.status,
          current: b.travel_status,
          next: body.status,
          now,
          startAt: b.start_at,
        });
      } catch (error) {
        if (error instanceof BookingRuleError) throw ruleError(error);
        throw error;
      }
      await trx
        .updateTable('bookings')
        .set({ travel_status: body.status, version: (eb) => eb('version', '+', 1) })
        .where('id', '=', b.id)
        .execute();
      await trx
        .insertInto('booking_travel_events')
        .values({
          booking_id: b.id,
          business_id: ctx.businessId,
          status: body.status,
          actor_user_id: userId,
          occurred_at: now,
        })
        .execute();
      if (body.status === 'on_the_way') {
        await this.outbox(trx, 'booking.travel_started', { bookingId: b.id }, now);
      }
      await writeAudit(trx, {
        actorType: 'user',
        actorId: userId,
        action: 'booking.travel',
        targetType: 'booking',
        targetId: b.id,
        businessId: ctx.businessId,
        diff: { from: b.travel_status, to: body.status },
        requestId: meta.requestId,
      });
    });
    return this.getForBusiness(ctx, bookingId);
  }

  /** Check-in, completion, no-show and business cancellation (full refund when prepaid). */
  async act(
    ctx: BusinessContext,
    userId: string,
    bookingId: string,
    body: BookingActionRequest,
    meta: RequestMeta,
  ): Promise<MerchantBooking> {
    let refund: RefundJob | null = null;
    await this.db.transaction().execute(async (trx) => {
      const now = this.clock.now();
      const b = await trx
        .selectFrom('bookings')
        .select([
          'id',
          'status',
          'start_at',
          'price_fils',
          'version',
          'payment_mode',
          'travel_fee_fils',
          'policy_snapshot',
        ])
        .where('id', '=', bookingId)
        .where('business_id', '=', ctx.businessId)
        .forUpdate()
        .executeTakeFirst();
      if (!b) throw notFound();
      if (b.version !== body.expectedVersion) {
        throw new ApiError(
          HttpStatus.CONFLICT,
          'VERSION_CONFLICT',
          'This booking changed in the meantime. Reload and try again.',
        );
      }
      let next;
      try {
        next = businessTransition(b.status, body.action, { now, startAt: b.start_at });
      } catch (error) {
        if (error instanceof BookingRuleError) throw ruleError(error);
        throw error;
      }
      const stamp = {
        checked_in: { checked_in_at: now },
        completed: { completed_at: now },
        no_show: { no_show_at: now },
        canceled: {
          canceled_at: now,
          canceled_by: 'business' as const,
          cancel_reason: body.reason ?? null,
        },
      }[next as 'checked_in' | 'completed' | 'no_show' | 'canceled'];
      // A business cancellation refunds a prepaid booking in full; a no-show refunds the share
      // the policy shown at booking promised (D7, phase 8.8). Pay-at-venue bookings hold no money.
      let split: { refundFils: number; travelFils: number } | null = null;
      if (next === 'canceled' || next === 'no_show') {
        split =
          b.payment_mode !== 'prepaid'
            ? { refundFils: 0, travelFils: 0 }
            : next === 'canceled'
              ? cancellationRefund({
                  priceFils: b.price_fils,
                  startAt: b.start_at,
                  now,
                  policy: { cutoffHours: 0, lateRefundBps: 10_000 },
                  by: 'business',
                  travelFeeFils: b.travel_fee_fils,
                })
              : noShowRefund({
                  priceFils: b.price_fils,
                  travelFeeFils: b.travel_fee_fils,
                  policy: b.policy_snapshot as PolicySnapshot,
                });
      }
      const refundFils = split ? split.refundFils : null;
      await trx
        .updateTable('bookings')
        .set({
          status: next,
          ...stamp,
          ...(refundFils !== null ? { refund_fils: refundFils } : {}),
          version: (eb) => eb('version', '+', 1),
        })
        .where('id', '=', b.id)
        .execute();
      if (split && split.refundFils > 0) {
        refund = await this.refundFor(
          trx,
          b.id,
          { amountFils: split.refundFils, travelFils: split.travelFils },
          next === 'canceled' ? 'business_cancellation' : 'no_show',
          now,
        );
      }
      await this.outbox(trx, `booking.${next}`, { bookingId: b.id, by: 'business' }, now);
      await writeAudit(trx, {
        actorType: 'user',
        actorId: userId,
        action: `booking.${body.action}`,
        targetType: 'booking',
        targetId: b.id,
        businessId: ctx.businessId,
        reason: body.reason ?? null,
        diff: { from: b.status, to: next, refundFils },
        requestId: meta.requestId,
      });
    });
    if (refund) await this.payments.issueRefund(refund);
    return this.getForBusiness(ctx, bookingId);
  }

  /** A phone or walk-in booking: confirmed at once, paid at the venue (no online payment). */
  async createManual(
    ctx: BusinessContext,
    userId: string,
    body: ManualBookingRequest,
    meta: RequestMeta,
  ): Promise<MerchantBooking> {
    const id = await this.db.transaction().execute(async (trx) => {
      const now = this.clock.now();
      await expireHolds(trx, now);
      const { branch, service } = await this.bookable(trx, body.branchId, body.serviceId, false);
      if (branch.business_id !== ctx.businessId) throw notFound();
      const price = await this.priceOf(trx, service, now);
      const booking = await this.allocate(
        trx,
        {
          branch,
          service: durations(service),
          serviceId: service.id,
          startAt: new Date(body.startAt),
          staffId: body.staffId,
          now,
        },
        async (staffId, t) =>
          trx
            .insertInto('bookings')
            .values({
              user_id: null,
              business_id: ctx.businessId,
              branch_id: branch.id,
              service_id: service.id,
              staff_id: staffId,
              start_at: t.start,
              end_at: t.end,
              occupied_start: t.occupiedStart,
              occupied_end: t.occupiedEnd,
              status: 'confirmed',
              hold_expires_at: null,
              source: 'manual',
              payment_mode: 'pay_at_venue',
              ...price,
              snapshot: JSON.stringify(await this.snapshot(trx, branch, service, staffId)),
              policy_snapshot: JSON.stringify({
                cutoffHours: service.cancel_cutoff_hours,
                lateRefundBps: service.late_cancel_refund_bps,
                noShowRefundBps: service.no_show_refund_bps,
              } satisfies PolicySnapshot),
              customer_name: body.customerName,
              customer_phone: body.customerPhone ?? null,
              note: body.note ?? null,
              created_by: userId,
              confirmed_at: now,
            })
            .returning('id')
            .executeTakeFirstOrThrow(),
      );
      await this.outbox(trx, 'booking.confirmed', { bookingId: booking.id, source: 'manual' }, now);
      await writeAudit(trx, {
        actorType: 'user',
        actorId: userId,
        action: 'booking.created_manual',
        targetType: 'booking',
        targetId: booking.id,
        businessId: ctx.businessId,
        diff: { startAt: body.startAt, staffId: body.staffId, serviceId: service.id },
        requestId: meta.requestId,
      });
      return booking.id;
    });
    return this.getForBusiness(ctx, id);
  }

  private async refundFor(
    trx: Trx,
    bookingId: string,
    { amountFils, travelFils }: { amountFils: number; travelFils: number },
    reason: 'customer_cancellation' | 'business_cancellation' | 'no_show',
    now: Date,
  ): Promise<RefundJob | null> {
    if (amountFils <= 0) return null;
    const payment = await trx
      .selectFrom('payments')
      .select('id')
      .where('booking_id', '=', bookingId)
      .where('status', '=', 'succeeded')
      .executeTakeFirst();
    if (!payment) return null;
    return this.payments.requestRefund(
      trx,
      {
        paymentId: payment.id,
        amountFils,
        nonCommissionableFils: travelFils,
        reason,
        target: { type: 'booking', id: bookingId },
      },
      now,
    );
  }

  private async outbox(trx: Trx, type: string, payload: Record<string, unknown>, now: Date) {
    await trx
      .insertInto('outbox')
      .values({ event_type: type, payload: JSON.stringify(payload), available_at: now })
      .execute();
  }
}

interface Times {
  start: Date;
  end: Date;
  occupiedStart: Date;
  occupiedEnd: Date;
}

const durations = (s: {
  duration_min: number;
  buffer_before_min: number;
  buffer_after_min: number;
}) => ({
  durationMin: s.duration_min,
  bufferBeforeMin: s.buffer_before_min,
  bufferAfterMin: s.buffer_after_min,
});

const withAddons = (
  d: { durationMin: number; bufferBeforeMin: number; bufferAfterMin: number },
  addonsMin: number,
) => ({ ...d, durationMin: d.durationMin + addonsMin });

/** Average published rating of completed appointments: the venue, per service and per professional. */
async function venueRatings(conn: Conn, businessId: string) {
  const rows = await conn
    .selectFrom('reviews as r')
    .innerJoin('bookings as b', 'b.id', 'r.booking_id')
    .select([
      'r.service_id',
      'b.staff_id',
      (eb) => eb.fn.sum<string>('r.rating').as('sum'),
      (eb) => eb.fn.countAll<string>().as('n'),
    ])
    .where('r.business_id', '=', businessId)
    .where('r.target_type', '=', 'booking')
    .where('r.status', '=', 'published')
    .groupBy(['r.service_id', 'b.staff_id'])
    .execute();
  const add = (m: Map<string, [number, number]>, k: string, sum: number, n: number) => {
    const [s0, n0] = m.get(k) ?? [0, 0];
    m.set(k, [s0 + sum, n0 + n]);
  };
  const byService = new Map<string, [number, number]>();
  const byStaff = new Map<string, [number, number]>();
  let total: [number, number] = [0, 0];
  for (const r of rows) {
    const sum = Number(r.sum);
    const n = Number(r.n);
    if (r.service_id) add(byService, r.service_id, sum, n);
    add(byStaff, r.staff_id, sum, n);
    total = [total[0] + sum, total[1] + n];
  }
  const summarise = (m: Map<string, [number, number]>) =>
    new Map([...m].map(([k, [sum, n]]) => [k, ratingSummary(sum, n)!]));
  return {
    services: summarise(byService),
    staff: summarise(byStaff),
    venue: ratingSummary(total[0], total[1]),
  };
}

/** A business's portfolio photos that are ready to show. */
export async function publicPortfolio(conn: Conn, businessId: string, base: string) {
  const rows = await conn
    .selectFrom('portfolio_items as p')
    .innerJoin('media as m', 'm.id', 'p.media_id')
    .select(['p.id', 'p.media_id', 'p.caption', 'p.service_id', 'p.staff_id'])
    .where('p.business_id', '=', businessId)
    .where('m.status', '=', 'ready')
    .orderBy('p.sort_order')
    .orderBy('p.created_at', 'desc')
    .limit(PORTFOLIO_ITEMS_MAX)
    .execute();
  return rows.map((r) => ({
    id: r.id,
    imageUrl: `${base}/media/${r.media_id}`,
    caption: r.caption,
    serviceId: r.service_id,
    staffId: r.staff_id,
  }));
}

const holdExpired = () =>
  new ApiError(
    HttpStatus.CONFLICT,
    'HOLD_EXPIRED',
    'The hold on this time has ended. Pick the time again.',
  );
