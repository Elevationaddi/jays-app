/**
 * Home services (ADR-0018 D9, ADR-0022). A service can be performed at the venue, at the
 * customer's address, or both. Home visits need an approved home-service licence, an address
 * inside one of the business's coverage areas, and a service price at or above its minimum.
 * The travel buffer widens the professional's occupied time on both sides of the visit.
 */

export const SERVICE_LOCATION_MODES = ['in_venue', 'home', 'both'] as const;
export type ServiceLocationMode = (typeof SERVICE_LOCATION_MODES)[number];

export const HOME_SERVICE_STATUSES = [
  'draft',
  'pending',
  'approved',
  'rejected',
  'suspended',
] as const;
export type HomeServiceStatus = (typeof HOME_SERVICE_STATUSES)[number];

export const BOOKING_LOCATIONS = ['venue', 'home'] as const;
export type BookingLocation = (typeof BOOKING_LOCATIONS)[number];

/** Statuses in which the business may change its licence details (the rest needs a new review). */
export const HOME_PROFILE_EDITABLE: readonly HomeServiceStatus[] = ['draft', 'rejected'];

export const MAX_TRAVEL_BUFFER_MIN = 120;

export function offersLocation(mode: ServiceLocationMode, location: BookingLocation): boolean {
  return location === 'home' ? mode !== 'in_venue' : mode !== 'home';
}

export interface CoverageArea {
  emirate: string;
  /** null covers the whole emirate. */
  area: string | null;
  travelFeeFils: number;
}

/** Areas compare without case, surrounding spaces or repeated spaces. */
export const normalizeArea = (area: string) => area.trim().replace(/\s+/g, ' ').toLowerCase();

/**
 * The coverage rule for an address: a named area beats the emirate-wide rule. Null when the
 * business does not visit that address.
 */
export function coverageFor<T extends CoverageArea>(
  areas: readonly T[],
  address: { emirate: string; area: string },
): T | null {
  const inEmirate = areas.filter((a) => a.emirate === address.emirate);
  const wanted = normalizeArea(address.area);
  return (
    inEmirate.find((a) => a.area !== null && normalizeArea(a.area) === wanted) ??
    inEmirate.find((a) => a.area === null) ??
    null
  );
}

export class HomeVisitError extends Error {
  constructor(
    readonly code:
      | 'HOME_SERVICES_NOT_AVAILABLE'
      | 'LOCATION_NOT_OFFERED'
      | 'ADDRESS_NOT_COVERED'
      | 'BELOW_HOME_MINIMUM',
    message: string,
  ) {
    super(message);
  }
}

/**
 * Checks a home visit and returns its travel fee and buffer. Throws HomeVisitError with the
 * first rule that fails.
 */
export function homeVisitTerms(input: {
  profile: { status: HomeServiceStatus; travelBufferMin: number; minOrderFils: number } | null;
  serviceMode: ServiceLocationMode;
  servicePriceFils: number;
  areas: readonly CoverageArea[];
  address: { emirate: string; area: string };
}): { travelFeeFils: number; travelBufferMin: number } {
  if (input.profile?.status !== 'approved') {
    throw new HomeVisitError(
      'HOME_SERVICES_NOT_AVAILABLE',
      'This business does not offer home visits right now.',
    );
  }
  if (!offersLocation(input.serviceMode, 'home')) {
    throw new HomeVisitError('LOCATION_NOT_OFFERED', 'This service is not offered at home.');
  }
  const area = coverageFor(input.areas, input.address);
  if (!area) {
    throw new HomeVisitError('ADDRESS_NOT_COVERED', 'This business does not visit that address.');
  }
  if (input.servicePriceFils < input.profile.minOrderFils) {
    throw new HomeVisitError(
      'BELOW_HOME_MINIMUM',
      'This service is below the minimum amount for a home visit.',
    );
  }
  return { travelFeeFils: area.travelFeeFils, travelBufferMin: input.profile.travelBufferMin };
}

/** Durations used for availability: the service's buffers plus travel on both sides. */
export function withTravel<
  T extends { durationMin: number; bufferBeforeMin: number; bufferAfterMin: number },
>(service: T, travelBufferMin: number): T {
  return {
    ...service,
    bufferBeforeMin: service.bufferBeforeMin + travelBufferMin,
    bufferAfterMin: service.bufferAfterMin + travelBufferMin,
  };
}

/** Which admin decisions apply from which status. */
export function homeServiceDecision(
  status: HomeServiceStatus,
  decision: 'approve' | 'reject' | 'suspend' | 'reinstate',
): HomeServiceStatus | null {
  switch (decision) {
    case 'approve':
      return status === 'pending' ? 'approved' : null;
    case 'reject':
      return status === 'pending' ? 'rejected' : null;
    case 'suspend':
      return status === 'approved' ? 'suspended' : null;
    case 'reinstate':
      return status === 'suspended' ? 'approved' : null;
  }
}
