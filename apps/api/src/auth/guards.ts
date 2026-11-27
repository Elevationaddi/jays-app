import {
  type CanActivate,
  createParamDecorator,
  type ExecutionContext,
  HttpStatus,
  Inject,
  Injectable,
} from '@nestjs/common';
import type { Db } from '@jays/db';
import type { Request } from 'express';
import { CLOCK, type Clock } from '../common/clock.js';
import { ApiError } from '../common/error.filter.js';
import { DB } from '../common/tokens.js';
import { ACCESS_TOKENS, USER_SESSIONS } from './auth.module-tokens.js';
import type { AccessTokens } from './jwt.js';
import type { SessionStore } from './sessions.js';

export interface UserPrincipal {
  userId: string;
  sessionId: string;
}

export type AuthedRequest = Request & { user?: UserPrincipal; id?: unknown };

export function bearerToken(req: Request): string | null {
  const header = req.headers.authorization;
  if (typeof header !== 'string') return null;
  const match = /^Bearer ([A-Za-z0-9._~+/=-]+)$/.exec(header);
  return match?.[1] ?? null;
}

export const unauthenticated = () =>
  new ApiError(HttpStatus.UNAUTHORIZED, 'UNAUTHENTICATED', 'Please sign in.');

/**
 * Customer/business user authentication. Verifies the access token, then checks on every request
 * that the session is still open and the account active, so logout and suspension apply at once.
 */
@Injectable()
export class UserAuthGuard implements CanActivate {
  constructor(
    @Inject(ACCESS_TOKENS) private readonly tokens: AccessTokens,
    @Inject(USER_SESSIONS) private readonly sessions: SessionStore,
    @Inject(DB) private readonly db: Db,
    @Inject(CLOCK) private readonly clock: Clock,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest<AuthedRequest>();
    const token = bearerToken(req);
    if (!token) throw unauthenticated();
    const now = this.clock.now();
    const claims = await this.tokens.verify(token, 'user', now);
    if (!claims) throw unauthenticated();
    const [active, user] = await Promise.all([
      this.sessions.isActive(claims.sid, claims.sub, now),
      this.db.selectFrom('users').select('status').where('id', '=', claims.sub).executeTakeFirst(),
    ]);
    if (!active || user?.status !== 'active') throw unauthenticated();
    req.user = { userId: claims.sub, sessionId: claims.sid };
    return true;
  }
}

export const CurrentUser = createParamDecorator(
  (_data: unknown, context: ExecutionContext): UserPrincipal => {
    const user = context.switchToHttp().getRequest<AuthedRequest>().user;
    if (!user) throw unauthenticated();
    return user;
  },
);

export const Meta = createParamDecorator((_data: unknown, context: ExecutionContext) =>
  context.switchToHttp().getRequest<AuthedRequest>(),
);
