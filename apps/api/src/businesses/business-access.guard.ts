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
import { type BusinessCapability, hasBusinessCapability } from '@jays/domain';
import { ApiError } from '../common/error.filter.js';
import { UuidOr404Pipe } from '../common/params.js';
import { DB } from '../common/tokens.js';
import type { AuthedRequest } from '../auth/guards.js';

export interface BusinessContext {
  businessId: string;
  membershipId: string;
  permissions: string[];
}

const CAPABILITY_KEY = 'business-capability';

/** Declares the capability a business route needs. Business routes without it are refused. */
export const RequireBusinessCapability = (capability: BusinessCapability) =>
  SetMetadata(CAPABILITY_KEY, capability);

/**
 * Tenant isolation: resolves the caller's membership of `:businessId` from the database (never
 * from the request or token). Not a member → 404, so other tenants' businesses are invisible.
 * Member without the capability → 403. Must run after UserAuthGuard.
 */
@Injectable()
export class BusinessAccessGuard implements CanActivate {
  constructor(
    @Inject(DB) private readonly db: Db,
    @Inject(Reflector) private readonly reflector: Reflector,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest<AuthedRequest & { business?: BusinessContext }>();
    const capability = this.reflector.get<BusinessCapability | undefined>(
      CAPABILITY_KEY,
      context.getHandler(),
    );
    if (!capability) throw new ApiError(HttpStatus.FORBIDDEN, 'FORBIDDEN', 'Not allowed.'); // default deny
    if (!req.user)
      throw new ApiError(HttpStatus.UNAUTHORIZED, 'UNAUTHENTICATED', 'Please sign in.');
    const businessId = new UuidOr404Pipe().transform(String(req.params['businessId'] ?? ''));
    const membership = await this.db
      .selectFrom('memberships')
      .select(['id', 'permissions'])
      .where('business_id', '=', businessId)
      .where('user_id', '=', req.user.userId)
      .where('status', '=', 'active')
      .executeTakeFirst();
    if (!membership) throw new ApiError(HttpStatus.NOT_FOUND, 'NOT_FOUND', 'Not found.');
    if (!hasBusinessCapability(membership.permissions, capability)) {
      throw new ApiError(
        HttpStatus.FORBIDDEN,
        'FORBIDDEN',
        'Your role in this business does not allow this.',
      );
    }
    req.business = { businessId, membershipId: membership.id, permissions: membership.permissions };
    return true;
  }
}

export const CurrentBusiness = createParamDecorator(
  (_data: unknown, context: ExecutionContext): BusinessContext => {
    const business = context.switchToHttp().getRequest<{ business?: BusinessContext }>().business;
    if (!business) throw new ApiError(HttpStatus.FORBIDDEN, 'FORBIDDEN', 'Not allowed.');
    return business;
  },
);
