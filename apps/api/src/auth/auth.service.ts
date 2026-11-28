import { HttpStatus, Inject, Injectable } from '@nestjs/common';
import type { Challenge, RegisterRequest, Session } from '@jays/contracts';
import type { ChallengePurpose, ContactChannel, Db, User } from '@jays/db';
import type { Locale } from '@jays/i18n';
import { API_ENV, type ApiEnv } from '../config.js';
import { writeAudit } from '../common/audit.js';
import { addSeconds, CLOCK, type Clock } from '../common/clock.js';
import { ApiError } from '../common/error.filter.js';
import { enforce, RATE_LIMITER, type RateLimiter } from '../common/rate-limit.js';
import type { RequestMeta } from '../common/request-context.js';
import { DB, NOTIFIER } from '../common/tokens.js';
import { USER_SESSIONS } from './auth.module-tokens.js';
import {
  constantTimeEqual,
  generateOtp,
  hashOtp,
  hashPassword,
  maskContact,
  sha256,
  verifyAgainstDummy,
  verifyPassword,
} from './crypto.js';
import type { MessageTemplate, Notifier } from './notifier.js';
import {
  LIMITS,
  OTP_MAX_ATTEMPTS,
  OTP_MAX_SENDS,
  OTP_RESEND_COOLDOWN_SECONDS,
  OTP_TTL_SECONDS,
  MARKETING_POLICY_VERSION,
  TERMS_VERSION,
} from './policy.js';
import { refreshFailure, type SessionStore } from './sessions.js';
import { findUserByIdentifier, normalizeIdentifier, toMe } from './users.js';

export type LoginResult =
  | ({ status: 'authenticated' } & Session)
  | { status: 'verification_required'; challenge: Challenge };

interface PendingSend {
  channel: ContactChannel;
  to: string;
  template: MessageTemplate;
  locale: Locale;
  code?: string;
}

const invalidCode = () =>
  new ApiError(HttpStatus.BAD_REQUEST, 'OTP_INVALID', 'That code is not correct.');

@Injectable()
export class AuthService {
  constructor(
    @Inject(DB) private readonly db: Db,
    @Inject(CLOCK) private readonly clock: Clock,
    @Inject(RATE_LIMITER) private readonly limiter: RateLimiter,
    @Inject(NOTIFIER) private readonly notifier: Notifier,
    @Inject(USER_SESSIONS) private readonly sessions: SessionStore,
    @Inject(API_ENV) private readonly env: ApiEnv,
  ) {}

  /**
   * Creates an unverified account and sends a code. If the contact is already registered the
   * response is identical (a decoy challenge that can never verify) and the owner is told by
   * message instead, so this endpoint cannot be used to discover accounts.
   */
  async register(body: RegisterRequest, meta: RequestMeta): Promise<Challenge> {
    const channel: ContactChannel = body.email ? 'email' : 'sms';
    const destination = (body.email ?? body.phone) as string;
    await enforce(this.limiter, [
      [LIMITS.registerPerIp, meta.ip],
      [LIMITS.otpSendPerDestination, sha256(destination)],
    ]);
    // Hash before looking the contact up, so both paths take the same time.
    const passwordHash = await hashPassword(body.password);
    const now = this.clock.now();

    const { challenge, send } = await this.db.transaction().execute(async (trx) => {
      const existing = await trx
        .selectFrom('users')
        .select(['id', 'locale'])
        .where(channel === 'email' ? 'email' : 'phone', '=', destination)
        .executeTakeFirst();
      if (existing) {
        const decoy = await this.createChallenge(
          trx,
          null,
          'verify_contact',
          channel,
          destination,
          now,
        );
        return {
          challenge: decoy.challenge,
          send: {
            channel,
            to: destination,
            template: 'account.exists',
            locale: existing.locale,
          } satisfies PendingSend,
        };
      }
      const user = await trx
        .insertInto('users')
        .values({
          email: body.email ?? null,
          phone: body.phone ?? null,
          password_hash: passwordHash,
          locale: body.locale,
          terms_version: TERMS_VERSION,
          terms_accepted_at: now,
          marketing_email: body.marketing.email === true,
          marketing_sms: body.marketing.sms === true,
          marketing_push: body.marketing.push === true,
        })
        .returning(['id'])
        .executeTakeFirstOrThrow();
      const granted = (['email', 'sms', 'push'] as const).filter((c) => body.marketing[c]);
      if (granted.length > 0) {
        await trx
          .insertInto('consent_records')
          .values(
            granted.map((c) => ({
              user_id: user.id,
              purpose: `marketing_${c}` as const,
              granted: true,
              source: 'signup' as const,
              locale: body.locale,
              policy_version: MARKETING_POLICY_VERSION,
              request_id: meta.requestId,
            })),
          )
          .execute();
      }
      await writeAudit(trx, {
        actorType: 'user',
        actorId: user.id,
        action: 'user.registered',
        targetType: 'user',
        targetId: user.id,
        diff: { channel, termsVersion: TERMS_VERSION, marketing: granted },
        requestId: meta.requestId,
      });
      const real = await this.createChallenge(
        trx,
        user.id,
        'verify_contact',
        channel,
        destination,
        now,
      );
      return {
        challenge: real.challenge,
        send: {
          channel,
          to: destination,
          template: 'otp.verify_contact',
          locale: body.locale,
          code: real.code,
        } satisfies PendingSend,
      };
    });
    await this.deliver(send);
    return challenge;
  }

  /** Confirms a contact with its code, activates the account and signs the user in. */
  async verify(challengeId: string, code: string, meta: RequestMeta): Promise<Session> {
    await enforce(this.limiter, [[LIMITS.verifyPerIp, meta.ip]]);
    const userId = await this.consumeChallenge(
      challengeId,
      code,
      'verify_contact',
      async (trx, user, challenge) => {
        const now = this.clock.now();
        await trx
          .updateTable('users')
          .set({
            ...(challenge.channel === 'email'
              ? { email_verified_at: now }
              : { phone_verified_at: now }),
            ...(user.status === 'pending_verification' ? { status: 'active' as const } : {}),
          })
          .where('id', '=', user.id)
          .execute();
        await writeAudit(trx, {
          actorType: 'user',
          actorId: user.id,
          action: 'user.contact_verified',
          targetType: 'user',
          targetId: user.id,
          diff: { channel: challenge.channel },
          requestId: meta.requestId,
        });
      },
    );
    return this.startSession(userId, meta);
  }

  /** Sends a fresh code for an open challenge, after a cooldown and up to a maximum. */
  async resend(challengeId: string, meta: RequestMeta): Promise<Challenge> {
    await enforce(this.limiter, [[LIMITS.verifyPerIp, meta.ip]]);
    const now = this.clock.now();
    const result = await this.db.transaction().execute(async (trx) => {
      const row = await trx
        .selectFrom('verification_challenges')
        .selectAll()
        .where('id', '=', challengeId)
        .forUpdate()
        .executeTakeFirst();
      if (!row || row.consumed_at) return { error: 'gone' as const };
      if (row.resend_available_at > now)
        return { error: 'cooldown' as const, retryAt: row.resend_available_at };
      if (row.send_count >= OTP_MAX_SENDS) return { error: 'exhausted' as const };
      const code = generateOtp();
      const updated = await trx
        .updateTable('verification_challenges')
        .set({
          code_hash: hashOtp(this.env.OTP_SECRET, row.id, code),
          attempts: 0,
          send_count: row.send_count + 1,
          expires_at: addSeconds(now, OTP_TTL_SECONDS),
          resend_available_at: addSeconds(now, OTP_RESEND_COOLDOWN_SECONDS),
        })
        .where('id', '=', row.id)
        .returningAll()
        .executeTakeFirstOrThrow();
      let locale: Locale = 'en';
      if (row.user_id) {
        const user = await trx
          .selectFrom('users')
          .select('locale')
          .where('id', '=', row.user_id)
          .executeTakeFirst();
        locale = user?.locale ?? 'en';
      }
      return { updated, code, real: row.user_id !== null, locale };
    });
    if ('error' in result) {
      if (result.error === 'cooldown') {
        const wait = Math.ceil((result.retryAt!.getTime() - now.getTime()) / 1000);
        throw Object.assign(
          new ApiError(
            HttpStatus.TOO_MANY_REQUESTS,
            'OTP_RESEND_COOLDOWN',
            'Please wait before asking for another code.',
          ),
          { retryAfterSeconds: wait },
        );
      }
      if (result.error === 'exhausted') {
        throw new ApiError(
          HttpStatus.TOO_MANY_REQUESTS,
          'OTP_SEND_LIMIT',
          'Too many codes requested. Please start again later.',
        );
      }
      throw new ApiError(HttpStatus.NOT_FOUND, 'NOT_FOUND', 'This code request is no longer open.');
    }
    await enforce(this.limiter, [
      [LIMITS.otpSendPerDestination, sha256(result.updated.destination)],
    ]);
    if (result.real) {
      await this.deliver({
        channel: result.updated.channel,
        to: result.updated.destination,
        template:
          result.updated.purpose === 'password_reset' ? 'otp.password_reset' : 'otp.verify_contact',
        locale: result.locale,
        code: result.code,
      });
    }
    return this.challengeView(result.updated);
  }

  async login(identifier: string, password: string, meta: RequestMeta): Promise<LoginResult> {
    const { value } = normalizeIdentifier(identifier);
    await enforce(this.limiter, [
      [LIMITS.loginPerIdentifier, sha256(value)],
      [LIMITS.loginPerIp, meta.ip],
    ]);
    const user = await findUserByIdentifier(this.db, identifier);
    const ok = user
      ? await verifyPassword(user.password_hash, password)
      : await verifyAgainstDummy(password);
    if (!user || !ok || user.status === 'deactivated') {
      throw new ApiError(
        HttpStatus.UNAUTHORIZED,
        'INVALID_CREDENTIALS',
        'Email, phone or password is not correct.',
      );
    }
    if (user.status === 'pending_verification') {
      // The password proves who this is, so it is safe to send a new code to the registered contact.
      const channel: ContactChannel = user.email ? 'email' : 'sms';
      const destination = (user.email ?? user.phone) as string;
      await enforce(this.limiter, [[LIMITS.otpSendPerDestination, sha256(destination)]]);
      const now = this.clock.now();
      const { challenge, code } = await this.db
        .transaction()
        .execute((trx) =>
          this.createChallenge(trx, user.id, 'verify_contact', channel, destination, now),
        );
      await this.deliver({
        channel,
        to: destination,
        template: 'otp.verify_contact',
        locale: user.locale,
        code,
      });
      return { status: 'verification_required', challenge };
    }
    return { status: 'authenticated', ...(await this.startSession(user.id, meta)) };
  }

  async refresh(refreshToken: string, meta: RequestMeta) {
    await enforce(this.limiter, [[LIMITS.refreshPerIp, meta.ip]]);
    const outcome = await this.sessions.refresh(refreshToken, this.clock.now(), async (userId) => {
      const user = await this.db
        .selectFrom('users')
        .select('status')
        .where('id', '=', userId)
        .executeTakeFirst();
      return user?.status === 'active';
    });
    if (!outcome.ok) {
      if (outcome.reason === 'reused' && outcome.subjectId) {
        await writeAudit(this.db, {
          actorType: 'system',
          actorId: null,
          action: 'session.refresh_reuse_detected',
          targetType: 'user',
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

  /** Always answers the same way, whether or not the account exists. */
  async requestPasswordReset(identifier: string, meta: RequestMeta): Promise<Challenge> {
    const { kind, value } = normalizeIdentifier(identifier);
    await enforce(this.limiter, [
      [LIMITS.resetPerIp, meta.ip],
      [LIMITS.otpSendPerDestination, sha256(value)],
    ]);
    const channel: ContactChannel = kind === 'email' ? 'email' : 'sms';
    const user = await findUserByIdentifier(this.db, identifier);
    const now = this.clock.now();
    const eligible = user && user.status !== 'deactivated';
    const { challenge, code } = await this.db
      .transaction()
      .execute((trx) =>
        this.createChallenge(trx, eligible ? user.id : null, 'password_reset', channel, value, now),
      );
    if (eligible) {
      await this.deliver({
        channel,
        to: value,
        template: 'otp.password_reset',
        locale: user.locale,
        code,
      });
    }
    return challenge;
  }

  /** Sets a new password, proves the contact, and ends every existing session. */
  async confirmPasswordReset(
    challengeId: string,
    code: string,
    newPassword: string,
    meta: RequestMeta,
  ): Promise<Session> {
    await enforce(this.limiter, [[LIMITS.verifyPerIp, meta.ip]]);
    const passwordHash = await hashPassword(newPassword);
    const userId = await this.consumeChallenge(
      challengeId,
      code,
      'password_reset',
      async (trx, user, challenge) => {
        const now = this.clock.now();
        const contactMatches =
          challenge.channel === 'email'
            ? user.email === challenge.destination
            : user.phone === challenge.destination;
        await trx
          .updateTable('users')
          .set({
            password_hash: passwordHash,
            ...(contactMatches && challenge.channel === 'email' && !user.email_verified_at
              ? { email_verified_at: now }
              : {}),
            ...(contactMatches && challenge.channel === 'sms' && !user.phone_verified_at
              ? { phone_verified_at: now }
              : {}),
            ...(contactMatches && user.status === 'pending_verification'
              ? { status: 'active' as const }
              : {}),
          })
          .where('id', '=', user.id)
          .execute();
        await this.sessions.revokeAllForSubject(trx, user.id, now, 'password_reset');
        await writeAudit(trx, {
          actorType: 'user',
          actorId: user.id,
          action: 'user.password_reset',
          targetType: 'user',
          targetId: user.id,
          requestId: meta.requestId,
        });
      },
    );
    return this.startSession(userId, meta);
  }

  // ------------------------------------------------------------------------------------------

  private async startSession(userId: string, meta: RequestMeta): Promise<Session> {
    const user = await this.db
      .selectFrom('users')
      .selectAll()
      .where('id', '=', userId)
      .executeTakeFirstOrThrow();
    if (user.status !== 'active') {
      throw new ApiError(
        HttpStatus.FORBIDDEN,
        'ACCOUNT_NOT_ACTIVE',
        'This account cannot sign in.',
      );
    }
    const { tokens } = await this.sessions.create(
      this.db,
      user.id,
      this.clock.now(),
      meta.userAgent,
    );
    return { tokens, user: await toMe(this.db, user) };
  }

  private async createChallenge(
    trx: Db,
    userId: string | null,
    purpose: ChallengePurpose,
    channel: ContactChannel,
    destination: string,
    now: Date,
  ): Promise<{ challenge: Challenge; code: string }> {
    const code = generateOtp();
    const id = crypto.randomUUID();
    // Earlier open challenges for the same user and purpose stop working.
    if (userId) {
      await trx
        .updateTable('verification_challenges')
        .set({ consumed_at: now })
        .where('user_id', '=', userId)
        .where('purpose', '=', purpose)
        .where('consumed_at', 'is', null)
        .execute();
    }
    const row = await trx
      .insertInto('verification_challenges')
      .values({
        id,
        user_id: userId,
        purpose,
        channel,
        destination,
        code_hash: hashOtp(this.env.OTP_SECRET, id, code),
        expires_at: addSeconds(now, OTP_TTL_SECONDS),
        resend_available_at: addSeconds(now, OTP_RESEND_COOLDOWN_SECONDS),
        max_attempts: OTP_MAX_ATTEMPTS,
      })
      .returningAll()
      .executeTakeFirstOrThrow();
    return { challenge: this.challengeView(row), code };
  }

  private challengeView(row: {
    id: string;
    channel: ContactChannel;
    destination: string;
    expires_at: Date;
    resend_available_at: Date;
  }): Challenge {
    return {
      challengeId: row.id,
      channel: row.channel,
      destination: maskContact(row.destination),
      expiresAt: row.expires_at.toISOString(),
      resendAvailableAt: row.resend_available_at.toISOString(),
    };
  }

  /**
   * Checks a code with the challenge row locked. A wrong code still counts as an attempt (that
   * update commits); after the maximum the challenge is dead. Expired codes are always refused.
   */
  private async consumeChallenge(
    challengeId: string,
    code: string,
    purpose: ChallengePurpose,
    onSuccess: (
      trx: Db,
      user: User,
      challenge: { channel: ContactChannel; destination: string },
    ) => Promise<void>,
  ): Promise<string> {
    const now = this.clock.now();
    const outcome = await this.db.transaction().execute(async (trx) => {
      const row = await trx
        .selectFrom('verification_challenges')
        .selectAll()
        .where('id', '=', challengeId)
        .forUpdate()
        .executeTakeFirst();
      if (!row || row.purpose !== purpose || row.consumed_at) return 'invalid' as const;
      if (row.attempts >= row.max_attempts) return 'exhausted' as const;
      if (row.expires_at <= now) return 'expired' as const;
      await trx
        .updateTable('verification_challenges')
        .set({ attempts: row.attempts + 1 })
        .where('id', '=', row.id)
        .execute();
      const matches = constantTimeEqual(row.code_hash, hashOtp(this.env.OTP_SECRET, row.id, code));
      if (!matches || !row.user_id) return 'invalid' as const;
      const user = await trx
        .selectFrom('users')
        .selectAll()
        .where('id', '=', row.user_id)
        .forUpdate()
        .executeTakeFirstOrThrow();
      if (user.status === 'deactivated') return 'invalid' as const;
      await trx
        .updateTable('verification_challenges')
        .set({ consumed_at: now })
        .where('id', '=', row.id)
        .execute();
      await onSuccess(trx, user, row);
      return { userId: user.id };
    });
    if (outcome === 'invalid') throw invalidCode();
    if (outcome === 'expired') {
      throw new ApiError(
        HttpStatus.BAD_REQUEST,
        'OTP_EXPIRED',
        'That code has expired. Ask for a new one.',
      );
    }
    if (outcome === 'exhausted') {
      throw new ApiError(
        HttpStatus.TOO_MANY_REQUESTS,
        'OTP_ATTEMPTS_EXCEEDED',
        'Too many wrong codes. Ask for a new one.',
      );
    }
    return outcome.userId;
  }

  private async deliver(send: PendingSend): Promise<void> {
    try {
      await this.notifier.send({
        channel: send.channel,
        to: send.to,
        template: send.template,
        locale: send.locale,
        params: send.code ? { code: send.code } : {},
      });
    } catch {
      throw new ApiError(
        HttpStatus.SERVICE_UNAVAILABLE,
        'DEPENDENCY_UNAVAILABLE',
        'We could not send the message. Please try again.',
      );
    }
  }
}
