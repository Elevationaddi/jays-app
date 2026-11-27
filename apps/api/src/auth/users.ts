import type { Me } from '@jays/contracts';
import type { Db, User } from '@jays/db';

/** Normalizes a sign-in identifier: emails are lower-cased, phone numbers lose spaces and dashes. */
export function normalizeIdentifier(identifier: string): {
  kind: 'email' | 'phone';
  value: string;
} {
  const trimmed = identifier.trim();
  if (trimmed.includes('@')) return { kind: 'email', value: trimmed.toLowerCase() };
  return { kind: 'phone', value: trimmed.replace(/[\s()-]/g, '') };
}

export async function findUserByIdentifier(db: Db, identifier: string): Promise<User | undefined> {
  const { kind, value } = normalizeIdentifier(identifier);
  return db.selectFrom('users').selectAll().where(kind, '=', value).executeTakeFirst();
}

export async function toMe(db: Db, user: User): Promise<Me> {
  const membership = await db
    .selectFrom('memberships')
    .select('id')
    .where('user_id', '=', user.id)
    .where('status', '=', 'active')
    .limit(1)
    .executeTakeFirst();
  return {
    id: user.id,
    email: user.email,
    emailVerified: user.email_verified_at !== null,
    phone: user.phone,
    phoneVerified: user.phone_verified_at !== null,
    status: user.status,
    displayName: user.display_name,
    locale: user.locale,
    emirate: (user.emirate_code as Me['emirate']) ?? null,
    preferredMode: user.preferred_mode,
    marketingConsent: user.marketing_consent,
    hasBusinessMembership: membership !== undefined,
    createdAt: user.created_at.toISOString(),
  };
}
