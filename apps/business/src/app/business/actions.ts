'use server';

import { ApiClientError } from '@jays/api-client';
import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { serverApi, safeReturnTo } from '../../lib/api';
import { WORKSPACE_COOKIE } from '../../lib/session';

const UUID = /^[0-9a-f-]{36}$/i;

function back(path: string, error: unknown): never {
  const code = error instanceof ApiClientError ? error.code : 'INTERNAL';
  const sep = path.includes('?') ? '&' : '?';
  redirect(`${path}${sep}error=${encodeURIComponent(code)}`);
}

/** Remembers the chosen business so every page and mode opens in the same workspace. */
export async function switchBusiness(formData: FormData) {
  const id = String(formData.get('businessId') ?? '');
  if (UUID.test(id)) {
    (await cookies()).set(WORKSPACE_COOKIE, id, {
      httpOnly: true,
      sameSite: 'lax',
      path: '/',
      secure: process.env.NODE_ENV === 'production',
      maxAge: 365 * 24 * 3600,
    });
  }
  redirect(safeReturnTo(formData.get('returnTo'), '/business/gateway'));
}

export async function activateMode(formData: FormData) {
  const id = String(formData.get('businessId') ?? '');
  const mode = formData.get('mode') === 'services' ? 'services' : 'shop';
  try {
    await (await serverApi()).activateMode(id, mode);
  } catch (error) {
    back('/business/gateway', error);
  }
  redirect(`/business/${id}/onboarding/${mode}`);
}

export async function respondToInvitation(formData: FormData) {
  const id = String(formData.get('membershipId') ?? '');
  const accept = formData.get('decision') === 'accept';
  try {
    const api = await serverApi();
    if (accept) {
      const membership = await api.acceptMembership(id);
      (await cookies()).set(WORKSPACE_COOKIE, membership.business.id, {
        httpOnly: true,
        sameSite: 'lax',
        path: '/',
        secure: process.env.NODE_ENV === 'production',
      });
    } else {
      await api.declineMembership(id);
    }
  } catch (error) {
    back('/business/gateway', error);
  }
  redirect('/business/gateway');
}

export async function createBusiness(formData: FormData) {
  const modes = (['shop', 'services'] as const).filter((m) => formData.get(`mode-${m}`) === 'on');
  let id: string;
  try {
    const business = await (
      await serverApi()
    ).createBusiness({
      displayName: {
        en: String(formData.get('nameEn') ?? ''),
        ar: String(formData.get('nameAr') ?? ''),
      },
      modes,
    });
    id = business.id;
    (await cookies()).set(WORKSPACE_COOKIE, id, {
      httpOnly: true,
      sameSite: 'lax',
      path: '/',
      secure: process.env.NODE_ENV === 'production',
    });
  } catch (error) {
    back('/business/new', error);
  }
  redirect('/business/gateway');
}

export async function inviteMember(formData: FormData) {
  const id = String(formData.get('businessId') ?? '');
  const permissions = String(formData.getAll('permissions').join(',')).split(',').filter(Boolean);
  try {
    await (
      await serverApi()
    ).inviteMember(id, {
      identifier: String(formData.get('identifier') ?? '').trim(),
      permissions: permissions as never,
    });
  } catch (error) {
    back(`/business/${id}/team`, error);
  }
  redirect(`/business/${id}/team?invited=1`);
}

export async function removeMember(formData: FormData) {
  const id = String(formData.get('businessId') ?? '');
  try {
    await (await serverApi()).removeMember(id, String(formData.get('memberId') ?? ''));
  } catch (error) {
    back(`/business/${id}/team`, error);
  }
  redirect(`/business/${id}/team`);
}
