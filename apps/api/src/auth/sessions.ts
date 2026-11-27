import { HttpStatus } from '@nestjs/common';
import type { Db } from '@jays/db';
import { sql } from 'kysely';
import { ApiError } from '../common/error.filter.js';
import { addSeconds } from '../common/clock.js';
import { constantTimeEqual, randomToken, sha256 } from './crypto.js';
import type { AccessTokens, Audience } from './jwt.js';

export interface SessionPolicy {
  audience: Audience;
  table: 'sessions' | 'admin_sessions';
  subjectColumn: 'user_id' | 'admin_id';
  accessTtlSeconds: number;
  refreshIdleSeconds: number;
  refreshAbsoluteSeconds: number;
}

export interface IssuedTokens {
  tokenType: 'Bearer';
  accessToken: string;
  accessTokenExpiresAt: string;
  refreshToken: string;
  refreshTokenExpiresAt: string;
}

export type RefreshOutcome =
  | { ok: true; subjectId: string; sessionId: string; tokens: IssuedTokens }
  | { ok: false; reason: 'invalid' | 'expired' | 'reused' | 'revoked'; subjectId?: string };

interface SessionRow {
  id: string;
  subject_id: string;
  refresh_hash: string;
  generation: number;
  expires_at: Date;
  absolute_expires_at: Date;
  revoked_at: Date | null;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/** Refresh token format: `<session uuid>.<random secret>`. Only sha256(secret) is stored. */
export function parseRefreshToken(token: string): { sessionId: string; secret: string } | null {
  const dot = token.indexOf('.');
  if (dot <= 0) return null;
  const sessionId = token.slice(0, dot);
  const secret = token.slice(dot + 1);
  if (!UUID.test(sessionId) || secret.length < 20) return null;
  return { sessionId, secret };
}

/**
 * Sessions with rotating refresh tokens and reuse detection (ADR-0009). Used for both customer/
 * business users and platform admins, which live in separate tables and token audiences.
 */
export class SessionStore {
  constructor(
    private readonly db: Db,
    private readonly tokens: AccessTokens,
    private readonly policy: SessionPolicy,
  ) {}

  private get table() {
    return sql.table(this.policy.table);
  }

  private get subject() {
    return sql.ref(this.policy.subjectColumn);
  }

  async create(
    /** The database or an open transaction (Kysely transactions are Db instances). */
    executor: Db,
    subjectId: string,
    now: Date,
    userAgent: string | null,
  ): Promise<{ sessionId: string; tokens: IssuedTokens }> {
    const secret = randomToken();
    const absolute = addSeconds(now, this.policy.refreshAbsoluteSeconds);
    const expires = addSeconds(now, this.policy.refreshIdleSeconds);
    const { rows } = await sql<{ id: string }>`
      INSERT INTO ${this.table} (${this.subject}, refresh_hash, expires_at, absolute_expires_at, last_used_at, user_agent)
      VALUES (${subjectId}, ${sha256(secret)}, ${expires}, ${absolute}, ${now}, ${userAgent})
      RETURNING id`.execute(executor);
    const sessionId = (rows[0] as { id: string }).id;
    return { sessionId, tokens: await this.issue(subjectId, sessionId, secret, now, expires) };
  }

  private async issue(
    subjectId: string,
    sessionId: string,
    secret: string,
    now: Date,
    refreshExpires: Date,
  ): Promise<IssuedTokens> {
    const access = await this.tokens.sign(
      { sub: subjectId, sid: sessionId, aud: this.policy.audience },
      now,
      this.policy.accessTtlSeconds,
    );
    return {
      tokenType: 'Bearer',
      accessToken: access.token,
      accessTokenExpiresAt: access.expiresAt.toISOString(),
      refreshToken: `${sessionId}.${secret}`,
      refreshTokenExpiresAt: refreshExpires.toISOString(),
    };
  }

  /**
   * Rotates a refresh token. Runs in one transaction with the session row locked, so two
   * concurrent refreshes with the same token cannot both succeed: the second one sees a stale
   * secret, is treated as reuse, and revokes the session.
   */
  async refresh(
    token: string,
    now: Date,
    isSubjectActive: (subjectId: string) => Promise<boolean>,
  ): Promise<RefreshOutcome> {
    const parsed = parseRefreshToken(token);
    if (!parsed) return { ok: false, reason: 'invalid' };
    return this.db.transaction().execute(async (trx) => {
      const { rows } = await sql<SessionRow>`
        SELECT id, ${this.subject} AS subject_id, refresh_hash, generation, expires_at, absolute_expires_at, revoked_at
          FROM ${this.table} WHERE id = ${parsed.sessionId} FOR UPDATE`.execute(trx);
      const session = rows[0];
      if (!session) return { ok: false, reason: 'invalid' } as const;
      if (session.revoked_at)
        return { ok: false, reason: 'revoked', subjectId: session.subject_id } as const;
      if (!constantTimeEqual(session.refresh_hash, sha256(parsed.secret))) {
        await sql`UPDATE ${this.table} SET revoked_at = ${now}, revoke_reason = 'refresh_reuse' WHERE id = ${session.id}`.execute(
          trx,
        );
        return { ok: false, reason: 'reused', subjectId: session.subject_id } as const;
      }
      if (session.expires_at <= now || session.absolute_expires_at <= now) {
        return { ok: false, reason: 'expired', subjectId: session.subject_id } as const;
      }
      if (!(await isSubjectActive(session.subject_id))) {
        return { ok: false, reason: 'revoked', subjectId: session.subject_id } as const;
      }
      const secret = randomToken();
      const idle = addSeconds(now, this.policy.refreshIdleSeconds);
      const expires = idle < session.absolute_expires_at ? idle : session.absolute_expires_at;
      await sql`UPDATE ${this.table}
          SET refresh_hash = ${sha256(secret)}, generation = generation + 1, expires_at = ${expires}, last_used_at = ${now}
        WHERE id = ${session.id}`.execute(trx);
      return {
        ok: true,
        subjectId: session.subject_id,
        sessionId: session.id,
        tokens: await this.issue(session.subject_id, session.id, secret, now, expires),
      } as const;
    });
  }

  /** Revokes the session a refresh token belongs to, if the token is current. Idempotent. */
  async revokeByToken(token: string, now: Date): Promise<string | null> {
    const parsed = parseRefreshToken(token);
    if (!parsed) return null;
    const { rows } = await sql<{ subject_id: string }>`
      UPDATE ${this.table} SET revoked_at = ${now}, revoke_reason = 'logout'
       WHERE id = ${parsed.sessionId} AND refresh_hash = ${sha256(parsed.secret)} AND revoked_at IS NULL
      RETURNING ${this.subject} AS subject_id`.execute(this.db);
    return rows[0]?.subject_id ?? null;
  }

  async revokeAllForSubject(
    executor: Db,
    subjectId: string,
    now: Date,
    reason: 'password_reset' | 'admin',
  ): Promise<void> {
    await sql`UPDATE ${this.table} SET revoked_at = ${now}, revoke_reason = ${reason}
       WHERE ${this.subject} = ${subjectId} AND revoked_at IS NULL`.execute(executor);
  }

  /** True when the session exists, is not revoked and has not expired. Checked on every request. */
  async isActive(sessionId: string, subjectId: string, now: Date): Promise<boolean> {
    const { rows } = await sql<{ ok: number }>`
      SELECT 1 AS ok FROM ${this.table}
       WHERE id = ${sessionId} AND ${this.subject} = ${subjectId} AND revoked_at IS NULL
         AND expires_at > ${now} AND absolute_expires_at > ${now}`.execute(this.db);
    return rows.length === 1;
  }
}

export function refreshFailure(reason: 'invalid' | 'expired' | 'reused' | 'revoked'): ApiError {
  const messages = {
    invalid: ['INVALID_REFRESH_TOKEN', 'Please sign in again.'],
    revoked: ['SESSION_REVOKED', 'This session has ended. Please sign in again.'],
    expired: ['SESSION_EXPIRED', 'Your session has expired. Please sign in again.'],
    reused: [
      'REFRESH_TOKEN_REUSED',
      'This sign-in was ended for your security. Please sign in again.',
    ],
  } as const;
  const [code, message] = messages[reason];
  return new ApiError(HttpStatus.UNAUTHORIZED, code, message);
}
