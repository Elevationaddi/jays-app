import { BRAND } from '@jays/i18n';
import { HttpStatus, Inject, Injectable } from '@nestjs/common';
import type { AdminListItem, AdminSession, AdminView, AuditLogItem } from '@jays/contracts';
import type { Db } from '@jays/db';
import { hasPlatformCapability, PLATFORM_CAPABILITIES, type PlatformRole } from '@jays/domain';
import { API_ENV, type ApiEnv } from '../config.js';
import { writeAudit } from '../common/audit.js';
import { addSeconds, CLOCK, type Clock } from '../common/clock.js';
import { ApiError } from '../common/error.filter.js';
import {
  afterCursor,
  cursorTs,
  decodeCursor,
  type ListQuery,
  toPage,
} from '../common/pagination.js';
import { enforce, RATE_LIMITER, type RateLimiter } from '../common/rate-limit.js';
import type { RequestMeta } from '../common/request-context.js';
import { DB, NOTIFIER } from '../common/tokens.js';
import { ADMIN_SESSIONS, SECRET_BOX } from '../auth/auth.module-tokens.js';
import {
  hashPassword,
  randomToken,
  type SecretBox,
  sha256,
  verifyAgainstDummy,
  verifyPassword,
} from '../auth/crypto.js';
import type { Notifier } from '../auth/notifier.js';
import { ADMIN_INVITE_TTL_SECONDS, LIMITS } from '../auth/policy.js';
import { refreshFailure, type SessionStore } from '../auth/sessions.js';
import { generateTotpSecret, otpauthUri, verifyTotp } from '../auth/totp.js';

const TOTP_ISSUER = BRAND.adminIssuer;

const invalidCredentials = () =>
  new ApiError(
    HttpStatus.UNAUTHORIZED,
    'INVALID_CREDENTIALS',
    'Email, password or authenticator code is not correct.',
  );
const invalidInvite = () =>
  new ApiError(
    HttpStatus.BAD_REQUEST,
    'INVITE_INVALID',
    'This invitation is not valid or has expired.',
  );

/**
 * Platform admins: a separate identity store from customers and businesses, invite-only, with
 * TOTP required at every sign-in (docs/04-admin.md, ADR-0010). There is no impersonation.
 */
@Injectable()
export class AdminService {
  constructor(
    @Inject(DB) private readonly db: Db,
    @Inject(CLOCK) private readonly clock: Clock,
    @Inject(RATE_LIMITER) private readonly limiter: RateLimiter,
    @Inject(NOTIFIER) private readonly notifier: Notifier,
    @Inject(ADMIN_SESSIONS) private readonly sessions: SessionStore,
    @Inject(SECRET_BOX) private readonly box: SecretBox,
    @Inject(API_ENV) private readonly env: ApiEnv,
  ) {}

  async login(
    email: string,
    password: string,
    totpCode: string,
    meta: RequestMeta,
  ): Promise<AdminSession> {
    await enforce(this.limiter, [
      [LIMITS.adminLoginPerEmail, sha256(email)],
      [LIMITS.adminLoginPerIp, meta.ip],
    ]);
    const admin = await this.db
      .selectFrom('admin_accounts')
      .selectAll()
      .where('email', '=', email)
      .executeTakeFirst();
    const passwordOk = admin?.password_hash
      ? await verifyPassword(admin.password_hash, password)
      : await verifyAgainstDummy(password);
    if (!admin || !passwordOk || admin.status !== 'active' || !admin.mfa_secret_enc) {
      if (admin) await this.auditFailedLogin(admin.id, meta);
      throw invalidCredentials();
    }
    const now = this.clock.now();
    const secret = this.box.open(admin.mfa_secret_enc);
    const accepted = await this.db.transaction().execute(async (trx) => {
      const locked = await trx
        .selectFrom('admin_accounts')
        .select('mfa_last_step')
        .where('id', '=', admin.id)
        .forUpdate()
        .executeTakeFirstOrThrow();
      const step = verifyTotp(
        secret,
        totpCode,
        now,
        locked.mfa_last_step === null ? null : Number(locked.mfa_last_step),
      );
      if (step === null) return false;
      await trx
        .updateTable('admin_accounts')
        .set({ mfa_last_step: step })
        .where('id', '=', admin.id)
        .execute();
      await writeAudit(trx, {
        actorType: 'admin',
        actorId: admin.id,
        action: 'admin.login',
        targetType: 'admin_account',
        targetId: admin.id,
        requestId: meta.requestId,
      });
      return true;
    });
    if (!accepted) {
      await this.auditFailedLogin(admin.id, meta);
      throw invalidCredentials();
    }
    const { tokens } = await this.sessions.create(this.db, admin.id, now, meta.userAgent);
    return { tokens, admin: await this.view(admin.id) };
  }

  async refresh(refreshToken: string, meta: RequestMeta) {
    await enforce(this.limiter, [[LIMITS.refreshPerIp, meta.ip]]);
    const outcome = await this.sessions.refresh(refreshToken, this.clock.now(), async (adminId) => {
      const row = await this.db
        .selectFrom('admin_accounts')
        .select('status')
        .where('id', '=', adminId)
        .executeTakeFirst();
      return row?.status === 'active';
    });
    if (!outcome.ok) {
      if (outcome.reason === 'reused' && outcome.subjectId) {
        await writeAudit(this.db, {
          actorType: 'system',
          actorId: null,
          action: 'admin_session.refresh_reuse_detected',
          targetType: 'admin_account',
          targetId: outcome.subjectId,
          requestId: meta.requestId,
        });
      }
      throw refreshFailure(outcome.reason);
    }
    return outcome.tokens;
  }

  async logout(refreshToken: string): Promise<void> {
    await this.sessions.revokeByToken(refreshToken, this.clock.now());
  }

  async view(adminId: string): Promise<AdminView> {
    const admin = await this.db
      .selectFrom('admin_accounts')
      .select(['id', 'email', 'display_name'])
      .where('id', '=', adminId)
      .executeTakeFirstOrThrow();
    const roles = await this.roles(adminId);
    return {
      id: admin.id,
      email: admin.email,
      displayName: admin.display_name,
      roles,
      capabilities: PLATFORM_CAPABILITIES.filter((c) => hasPlatformCapability(roles, c)),
    };
  }

  async roles(adminId: string): Promise<PlatformRole[]> {
    const rows = await this.db
      .selectFrom('admin_roles')
      .select('role')
      .where('admin_id', '=', adminId)
      .orderBy('role')
      .execute();
    return rows.map((r) => r.role as PlatformRole);
  }

  /** Invites a new admin. The one-time link goes to the invitee by email, never back to the inviter. */
  async invite(
    actorId: string,
    body: { email: string; displayName: string; roles: PlatformRole[]; reason: string },
    meta: RequestMeta,
  ) {
    const token = randomToken();
    const now = this.clock.now();
    const expiresAt = addSeconds(now, ADMIN_INVITE_TTL_SECONDS);
    const adminId = await this.db.transaction().execute(async (trx) => {
      const existing = await trx
        .selectFrom('admin_accounts')
        .select('id')
        .where('email', '=', body.email)
        .executeTakeFirst();
      if (existing) {
        throw new ApiError(
          HttpStatus.CONFLICT,
          'ADMIN_EXISTS',
          'An admin account with this email already exists.',
        );
      }
      const admin = await trx
        .insertInto('admin_accounts')
        .values({
          email: body.email,
          display_name: body.displayName,
          status: 'invited',
          invite_token_hash: sha256(token),
          invite_expires_at: expiresAt,
          invited_by: actorId,
        })
        .returning('id')
        .executeTakeFirstOrThrow();
      await trx
        .insertInto('admin_roles')
        .values(body.roles.map((role) => ({ admin_id: admin.id, role, granted_by: actorId })))
        .execute();
      await writeAudit(trx, {
        actorType: 'admin',
        actorId,
        action: 'admin.invited',
        targetType: 'admin_account',
        targetId: admin.id,
        reason: body.reason,
        diff: { roles: body.roles },
        requestId: meta.requestId,
      });
      return admin.id;
    });
    const link = new URL('/invite', this.env.ADMIN_WEB_URL);
    link.searchParams.set('token', token);
    try {
      await this.notifier.send({
        channel: 'email',
        to: body.email,
        template: 'admin.invite',
        locale: 'en',
        params: { link: link.toString(), expiresAt: expiresAt.toISOString() },
      });
    } catch {
      throw new ApiError(
        HttpStatus.SERVICE_UNAVAILABLE,
        'DEPENDENCY_UNAVAILABLE',
        'The invitation was saved but the email could not be sent.',
      );
    }
    return {
      adminId,
      email: body.email,
      status: 'invited' as const,
      expiresAt: expiresAt.toISOString(),
    };
  }

  /** Step 1 of accepting: set a password and receive a new TOTP secret to enrol. */
  async acceptInvite(token: string, password: string, meta: RequestMeta) {
    await enforce(this.limiter, [[LIMITS.adminInviteAcceptPerIp, meta.ip]]);
    const passwordHash = await hashPassword(password);
    const secret = generateTotpSecret();
    const admin = await this.db.transaction().execute(async (trx) => {
      const row = await this.lockInvite(trx, token);
      await trx
        .updateTable('admin_accounts')
        .set({
          password_hash: passwordHash,
          mfa_secret_enc: this.box.seal(secret),
          mfa_last_step: null,
        })
        .where('id', '=', row.id)
        .execute();
      return row;
    });
    return { secret, otpauthUri: otpauthUri(TOTP_ISSUER, admin.email, secret) };
  }

  /** Step 2: prove the authenticator works. Only then is the account active. */
  async confirmMfa(token: string, totpCode: string, meta: RequestMeta): Promise<AdminSession> {
    await enforce(this.limiter, [[LIMITS.adminInviteAcceptPerIp, meta.ip]]);
    const now = this.clock.now();
    const adminId = await this.db.transaction().execute(async (trx) => {
      const row = await this.lockInvite(trx, token);
      if (!row.password_hash || !row.mfa_secret_enc) throw invalidInvite();
      const step = verifyTotp(this.box.open(row.mfa_secret_enc), totpCode, now, null);
      if (step === null) {
        throw new ApiError(
          HttpStatus.BAD_REQUEST,
          'TOTP_INVALID',
          'That authenticator code is not correct.',
        );
      }
      await trx
        .updateTable('admin_accounts')
        .set({
          status: 'active',
          mfa_enabled_at: now,
          mfa_last_step: step,
          invite_token_hash: null,
          invite_expires_at: null,
        })
        .where('id', '=', row.id)
        .execute();
      await writeAudit(trx, {
        actorType: 'admin',
        actorId: row.id,
        action: 'admin.activated',
        targetType: 'admin_account',
        targetId: row.id,
        diff: { mfa: 'totp' },
        requestId: meta.requestId,
      });
      return row.id;
    });
    const { tokens } = await this.sessions.create(this.db, adminId, now, meta.userAgent);
    return { tokens, admin: await this.view(adminId) };
  }

  async listAdmins(query: ListQuery) {
    const cursor = decodeCursor(query.cursor);
    let q = this.db
      .selectFrom('admin_accounts')
      .select(['id', 'email', 'display_name', 'status', 'mfa_enabled_at', 'created_at'])
      .select(cursorTs('created_at').as('cursor_ts'));
    if (cursor) q = q.where(afterCursor('created_at', 'id', cursor));
    const rows = await q
      .orderBy('created_at')
      .orderBy('id')
      .limit(query.limit + 1)
      .execute();
    const ids = rows.map((r) => r.id);
    const roles = ids.length
      ? await this.db
          .selectFrom('admin_roles')
          .select(['admin_id', 'role'])
          .where('admin_id', 'in', ids)
          .orderBy('role')
          .execute()
      : [];
    return toPage(rows, query.limit, (row): AdminListItem => ({
      id: row.id,
      email: row.email,
      displayName: row.display_name,
      status: row.status,
      roles: roles.filter((r) => r.admin_id === row.id).map((r) => r.role as PlatformRole),
      mfaEnabled: row.mfa_enabled_at !== null,
      createdAt: row.created_at.toISOString(),
    }));
  }

  /** Newest first. Diffs are not returned in lists; they may hold personal data. */
  async listAuditLogs(query: ListQuery) {
    const cursor = decodeCursor(query.cursor);
    let q = this.db
      .selectFrom('audit_logs')
      .select([
        'id',
        'actor_type',
        'actor_id',
        'action',
        'target_type',
        'target_id',
        'business_id',
        'reason',
        'request_id',
        'created_at',
      ])
      .select(cursorTs('created_at').as('cursor_ts'));
    if (cursor) q = q.where(afterCursor('created_at', 'id', cursor, 'desc'));
    const rows = await q
      .orderBy('created_at', 'desc')
      .orderBy('id', 'desc')
      .limit(query.limit + 1)
      .execute();
    return toPage(rows, query.limit, (row): AuditLogItem => ({
      id: row.id,
      actorType: row.actor_type,
      actorId: row.actor_id,
      action: row.action,
      targetType: row.target_type,
      targetId: row.target_id,
      businessId: row.business_id,
      reason: row.reason,
      requestId: row.request_id,
      createdAt: row.created_at.toISOString(),
    }));
  }

  private async lockInvite(trx: Db, token: string) {
    const row = await trx
      .selectFrom('admin_accounts')
      .selectAll()
      .where('invite_token_hash', '=', sha256(token))
      .where('status', '=', 'invited')
      .forUpdate()
      .executeTakeFirst();
    if (!row || !row.invite_expires_at || row.invite_expires_at <= this.clock.now())
      throw invalidInvite();
    return row;
  }

  private async auditFailedLogin(adminId: string, meta: RequestMeta): Promise<void> {
    await writeAudit(this.db, {
      actorType: 'system',
      actorId: null,
      action: 'admin.login_failed',
      targetType: 'admin_account',
      targetId: adminId,
      requestId: meta.requestId,
    });
  }
}
