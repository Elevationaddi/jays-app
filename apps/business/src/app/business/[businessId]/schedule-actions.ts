'use server';

import { ApiClientError } from '@jays/api-client';
import {
  BLOCK_KINDS,
  BUSINESS_BOOKING_TRANSITIONS,
  DEFAULT_TIMEZONE,
  EMIRATE_CODES,
  SERVICE_LOCATION_MODES,
  TAX_CLASSES,
  localToUtc,
} from '@jays/domain';
import { redirect } from 'next/navigation';
import { serverApi } from '../../../lib/api';
import { parseAed } from '../../../lib/workspace';

const UUID = /^[0-9a-f-]{36}$/i;
const TIME = /^([01]\d|2[0-3]):[0-5]\d$/;
const text = (f: FormData, name: string) => String(f.get(name) ?? '').trim();
const ids = (f: FormData, name: string) =>
  f
    .getAll(name)
    .map(String)
    .filter((v) => UUID.test(v));

function uuid(f: FormData, name: string): string {
  const id = text(f, name);
  if (!UUID.test(id)) redirect('/business/gateway');
  return id;
}

function fail(path: string, error: unknown): never {
  const code = error instanceof ApiClientError ? error.code : 'INTERNAL';
  redirect(`${path}${path.includes('?') ? '&' : '?'}error=${encodeURIComponent(code)}`);
}

const int = (f: FormData, name: string, fallback: number) => {
  const v = text(f, name);
  return /^\d+$/.test(v) ? Number(v) : fallback;
};

/** "2026-12-07T10:30" from a datetime-local field, read as wall-clock time in the branch zone. */
function localInstant(value: string, timeZone = DEFAULT_TIMEZONE): string | null {
  const m = /^(\d{4}-\d{2}-\d{2})T(\d{2}):(\d{2})$/.exec(value);
  if (!m) return null;
  return localToUtc(m[1] as string, Number(m[2]) * 60 + Number(m[3]), timeZone).toISOString();
}

/** Weekly hours from `open-{d}`, `from-{d}`, `to-{d}` fields (one interval a day). */
function hours(f: FormData) {
  const out: { weekday: number; start: string; end: string }[] = [];
  for (let d = 0; d < 7; d += 1) {
    if (f.get(`open-${d}`) !== 'on') continue;
    const start = text(f, `from-${d}`);
    const end = text(f, `to-${d}`);
    if (TIME.test(start) && TIME.test(end)) out.push({ weekday: d, start, end });
  }
  return out;
}

// Branches ---------------------------------------------------------------------------------------

function branchBody(f: FormData) {
  const emirate = text(f, 'emirate');
  return {
    name: { en: text(f, 'nameEn'), ar: text(f, 'nameAr') },
    emirate: ((EMIRATE_CODES as readonly string[]).includes(emirate)
      ? emirate
      : 'DXB') as (typeof EMIRATE_CODES)[number],
    area: text(f, 'area'),
    street: text(f, 'street'),
    building: text(f, 'building'),
    hours: hours(f),
  };
}

export async function createBranch(f: FormData) {
  const id = uuid(f, 'businessId');
  const path = `/business/${id}/services`;
  try {
    await (await serverApi()).createBranch(id, branchBody(f));
  } catch (error) {
    fail(path, error);
  }
  redirect(`${path}?saved=1`);
}

export async function updateBranch(f: FormData) {
  const id = uuid(f, 'businessId');
  const branchId = uuid(f, 'branchId');
  const path = `/business/${id}/services/branches/${branchId}`;
  try {
    await (
      await serverApi()
    ).updateBranch(id, branchId, f.get('archive') === '1' ? { status: 'archived' } : branchBody(f));
  } catch (error) {
    fail(path, error);
  }
  redirect(f.get('archive') === '1' ? `/business/${id}/services?saved=1` : `${path}?saved=1`);
}

export async function addClosure(f: FormData) {
  const id = uuid(f, 'businessId');
  const branchId = uuid(f, 'branchId');
  const path = `/business/${id}/services/branches/${branchId}`;
  const startsAt = localInstant(text(f, 'startsAt'));
  const endsAt = localInstant(text(f, 'endsAt'));
  if (!startsAt || !endsAt) redirect(`${path}?error=VALIDATION_FAILED`);
  try {
    await (
      await serverApi()
    ).addClosure(id, branchId, { startsAt, endsAt, reason: text(f, 'reason') || null });
  } catch (error) {
    fail(path, error);
  }
  redirect(`${path}?saved=1`);
}

export async function removeClosure(f: FormData) {
  const id = uuid(f, 'businessId');
  const branchId = uuid(f, 'branchId');
  const path = `/business/${id}/services/branches/${branchId}`;
  try {
    await (await serverApi()).removeClosure(id, branchId, uuid(f, 'closureId'));
  } catch (error) {
    fail(path, error);
  }
  redirect(`${path}?saved=1`);
}

// Services ---------------------------------------------------------------------------------------

function serviceBody(f: FormData) {
  const tax = text(f, 'taxClass');
  const percent = Number(text(f, 'lateRefundPercent') || '0');
  const location = text(f, 'locationMode');
  return {
    categoryId: text(f, 'categoryId'),
    title: { en: text(f, 'titleEn'), ar: text(f, 'titleAr') },
    description: { en: text(f, 'descriptionEn'), ar: text(f, 'descriptionAr') },
    priceFils: parseAed(f.get('price')) ?? -1,
    taxClass: ((TAX_CLASSES as readonly string[]).includes(tax)
      ? tax
      : 'standard') as (typeof TAX_CLASSES)[number],
    durationMin: int(f, 'durationMin', 60),
    bufferBeforeMin: int(f, 'bufferBeforeMin', 0),
    bufferAfterMin: int(f, 'bufferAfterMin', 0),
    cancelCutoffHours: int(f, 'cancelCutoffHours', 24),
    lateCancelRefundBps: Number.isFinite(percent) ? Math.round(percent * 100) : -1,
    branchIds: ids(f, 'branchIds'),
    locationMode: ((SERVICE_LOCATION_MODES as readonly string[]).includes(location)
      ? location
      : 'in_venue') as (typeof SERVICE_LOCATION_MODES)[number],
  };
}

export async function createService(f: FormData) {
  const id = uuid(f, 'businessId');
  const path = `/business/${id}/services`;
  try {
    await (await serverApi()).createService(id, serviceBody(f));
  } catch (error) {
    fail(path, error);
  }
  redirect(`${path}?saved=1`);
}

export async function updateService(f: FormData) {
  const id = uuid(f, 'businessId');
  const serviceId = uuid(f, 'serviceId');
  const path = `/business/${id}/services/${serviceId}`;
  const archive = f.get('archive') === '1';
  try {
    await (
      await serverApi()
    ).updateService(id, serviceId, archive ? { status: 'archived' } : serviceBody(f));
  } catch (error) {
    fail(path, error);
  }
  redirect(archive ? `/business/${id}/services?saved=1` : `${path}?saved=1`);
}

// Staff ------------------------------------------------------------------------------------------

function staffBody(f: FormData) {
  const member = text(f, 'membershipId');
  return {
    displayName: text(f, 'displayName'),
    membershipId: UUID.test(member) ? member : null,
    branchIds: ids(f, 'branchIds'),
    serviceIds: ids(f, 'serviceIds'),
  };
}

export async function createStaff(f: FormData) {
  const id = uuid(f, 'businessId');
  const path = `/business/${id}/staff`;
  let staffId: string;
  try {
    staffId = (await (await serverApi()).createStaff(id, staffBody(f))).id;
  } catch (error) {
    fail(path, error);
  }
  redirect(`${path}/${staffId}?saved=1`);
}

export async function updateStaff(f: FormData) {
  const id = uuid(f, 'businessId');
  const staffId = uuid(f, 'staffId');
  const path = `/business/${id}/staff/${staffId}`;
  const archive = f.get('archive') === '1';
  try {
    await (
      await serverApi()
    ).updateStaff(id, staffId, archive ? { status: 'archived' } : staffBody(f));
  } catch (error) {
    fail(path, error);
  }
  redirect(archive ? `/business/${id}/staff?saved=1` : `${path}?saved=1`);
}

/** Shifts from `branch-{d}`, `from-{d}`, `to-{d}` rows (one shift a day, optional second). */
export async function saveShifts(f: FormData) {
  const id = uuid(f, 'businessId');
  const staffId = uuid(f, 'staffId');
  const path = `/business/${id}/staff/${staffId}`;
  const shifts: { branchId: string; weekday: number; start: string; end: string }[] = [];
  for (let d = 0; d < 7; d += 1) {
    for (const slot of ['a', 'b']) {
      const branchId = text(f, `branch-${d}-${slot}`);
      const start = text(f, `from-${d}-${slot}`);
      const end = text(f, `to-${d}-${slot}`);
      if (UUID.test(branchId) && TIME.test(start) && TIME.test(end)) {
        shifts.push({ branchId, weekday: d, start, end });
      }
    }
  }
  try {
    await (await serverApi()).putShifts(id, staffId, { shifts });
  } catch (error) {
    fail(path, error);
  }
  redirect(`${path}?saved=1`);
}

export async function addBlock(f: FormData) {
  const id = uuid(f, 'businessId');
  const staffId = uuid(f, 'staffId');
  const path = `/business/${id}/staff/${staffId}`;
  const kind = text(f, 'kind');
  const startsAt = localInstant(text(f, 'startsAt'));
  const endsAt = localInstant(text(f, 'endsAt'));
  if (!startsAt || !endsAt || !(BLOCK_KINDS as readonly string[]).includes(kind)) {
    redirect(`${path}?error=VALIDATION_FAILED`);
  }
  try {
    await (
      await serverApi()
    ).addBlock(id, {
      staffId,
      startsAt,
      endsAt,
      kind: kind as (typeof BLOCK_KINDS)[number],
      reason: text(f, 'reason') || null,
    });
  } catch (error) {
    fail(path, error);
  }
  redirect(`${path}?saved=1`);
}

export async function removeBlock(f: FormData) {
  const id = uuid(f, 'businessId');
  const staffId = uuid(f, 'staffId');
  const path = `/business/${id}/staff/${staffId}`;
  try {
    await (await serverApi()).removeBlock(id, uuid(f, 'blockId'));
  } catch (error) {
    fail(path, error);
  }
  redirect(`${path}?saved=1`);
}

// Calendar ---------------------------------------------------------------------------------------

function calendarPath(id: string, f: FormData) {
  const date = text(f, 'date');
  const branch = text(f, 'branch');
  const params = new URLSearchParams();
  if (/^\d{4}-\d{2}-\d{2}$/.test(date)) params.set('date', date);
  if (UUID.test(branch)) params.set('branch', branch);
  const qs = params.toString();
  return `/business/${id}/calendar${qs ? `?${qs}` : ''}`;
}

export async function bookingAction(f: FormData) {
  const id = uuid(f, 'businessId');
  const bookingId = uuid(f, 'bookingId');
  const path = calendarPath(id, f);
  const action = text(f, 'action');
  if (!(BUSINESS_BOOKING_TRANSITIONS as readonly string[]).includes(action)) {
    redirect(path);
  }
  try {
    await (
      await serverApi()
    ).bookingAction(id, bookingId, {
      action: action as (typeof BUSINESS_BOOKING_TRANSITIONS)[number],
      expectedVersion: int(f, 'version', 1),
      reason: text(f, 'reason') || null,
    });
  } catch (error) {
    fail(path, error);
  }
  redirect(`${path}${path.includes('?') ? '&' : '?'}saved=1`);
}

export async function createManualBooking(f: FormData) {
  const id = uuid(f, 'businessId');
  const path = calendarPath(id, f);
  const date = text(f, 'date');
  const time = text(f, 'time');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !TIME.test(time)) {
    redirect(`${path}${path.includes('?') ? '&' : '?'}error=VALIDATION_FAILED`);
  }
  const phone = text(f, 'customerPhone').replace(/\s+/g, '');
  try {
    await (
      await serverApi()
    ).createManualBooking(id, {
      branchId: uuid(f, 'branchId'),
      serviceId: uuid(f, 'serviceId'),
      staffId: uuid(f, 'staffId'),
      startAt: localInstant(`${date}T${time}`) as string,
      customerName: text(f, 'customerName'),
      customerPhone: phone || null,
      note: text(f, 'note') || null,
    });
  } catch (error) {
    fail(path, error);
  }
  redirect(`${path}${path.includes('?') ? '&' : '?'}saved=1`);
}
