import {
  type CanActivate,
  createParamDecorator,
  type ExecutionContext,
  HttpStatus,
  Inject,
  Injectable,
  SetMetadata,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Db } from '@jays/db';
import { hasPlatformCapability, type PlatformCapability } from '@jays/domain';
import type { Request } from 'express';
import { CLOCK, type Clock } from '../common/clock.js';
import { ApiError } from '../common/error.filter.js';
import { DB } from '../common/tokens.js';
import { ACCESS_TOKENS, ADMIN_SESSIONS } from '../auth/auth.module-tokens.js';
import { bearerToken, unauthenticated } from '../auth/guards.js';
import type { AccessTokens } from '../auth/jwt.js';
import type { SessionStore } from '../auth/sessions.js';

export interface AdminPrincipal {
  adminId: string;
  sessionId: string;
  roles: string[];
}

const CAPABILITY_KEY = 'platform-capability';
export const RequirePlatformCapability = (capability: PlatformCapability) =>
  SetMetadata(CAPABILITY_KEY, capability);

/**
 * Admin authentication. Only tokens with the `admin` audience pass (user tokens never do), the
 * admin session must be open and the account active. Admin sessions only exist after password
 * plus TOTP, so every admin request is MFA-backed. Roles are loaded from the database.
 */
@Injectable()
export class AdminAuthGuard implements CanActivate {
  constructor(
    @Inject(ACCESS_TOKENS) private readonly tokens: AccessTokens,
    @Inject(ADMIN_SESSIONS) private readonly sessions: SessionStore,
    @Inject(DB) private readonly db: Db,
    @Inject(CLOCK) private readonly clock: Clock,
    @Inject(Reflector) private readonly reflector: Reflector,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest<Request & { admin?: AdminPrincipal }>();
    const token = bearerToken(req);
    if (!token) throw unauthenticated();
    const now = this.clock.now();
    const claims = await this.tokens.verify(token, 'admin', now);
    if (!claims) throw unauthenticated();
    const [active, admin, roles] = await Promise.all([
      this.sessions.isActive(claims.sid, claims.sub, now),
      this.db
        .selectFrom('admin_accounts')
        .select(['status', 'mfa_enabled_at'])
        .where('id', '=', claims.sub)
        .executeTakeFirst(),
      this.db.selectFrom('admin_roles').select('role').where('admin_id', '=', claims.sub).execute(),
    ]);
    if (!active || admin?.status !== 'active' || !admin.mfa_enabled_at) throw unauthenticated();
    const roleNames = roles.map((r) => r.role);
    const capability = this.reflector.get<PlatformCapability | undefined>(
      CAPABILITY_KEY,
      context.getHandler(),
    );
    if (capability && !hasPlatformCapability(roleNames, capability)) {
      throw new ApiError(HttpStatus.FORBIDDEN, 'FORBIDDEN', 'Your admin role does not allow this.');
    }
    req.admin = { adminId: claims.sub, sessionId: claims.sid, roles: roleNames };
    return true;
  }
}

export const CurrentAdmin = createParamDecorator(
  (_data: unknown, context: ExecutionContext): AdminPrincipal => {
    const admin = context.switchToHttp().getRequest<{ admin?: AdminPrincipal }>().admin;
    if (!admin) throw unauthenticated();
    return admin;
  },
);
