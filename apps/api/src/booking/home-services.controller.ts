import {
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Inject,
  Post,
  Put,
  Req,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiParam, ApiTags } from '@nestjs/swagger';
import {
  adminHomeServiceListQuerySchema,
  adminHomeServiceSchema,
  homeServiceDecisionRequestSchema,
  homeServiceProfileInputSchema,
  homeServiceProfileSchema,
  pageSchema,
  type AdminHomeServiceListQuery,
  type HomeServiceDecisionRequest,
  type HomeServiceProfileInput,
} from '@jays/contracts';
import type { Request } from 'express';
import {
  AdminAuthGuard,
  type AdminPrincipal,
  CurrentAdmin,
  RequirePlatformCapability,
} from '../admin/admin.guard.js';
import { CurrentUser, UserAuthGuard, type UserPrincipal } from '../auth/guards.js';
import {
  BusinessAccessGuard,
  type BusinessContext,
  CurrentBusiness,
  RequireBusinessCapability,
} from '../businesses/business-access.guard.js';
import { UuidParam } from '../common/params.js';
import { requestMeta } from '../common/request-context.js';
import {
  ApiErrors,
  ApiZodBody,
  ApiZodQuery,
  ApiZodResponse,
  ZodBody,
  ZodQuery,
} from '../common/zod.js';
import { HomeServicesService } from './home-services.service.js';

const businessParam = ApiParam({ name: 'businessId', format: 'uuid' });

/** A business's home-service licence, travel terms and coverage areas (D9, ADR-0022). */
@ApiTags('business-services')
@ApiBearerAuth()
@UseGuards(UserAuthGuard, BusinessAccessGuard)
@Controller('businesses/:businessId/home-services')
export class BusinessHomeServicesController {
  constructor(@Inject(HomeServicesService) private readonly home: HomeServicesService) {}

  @Get()
  @RequireBusinessCapability('business.view')
  @businessParam
  @ApiOperation({ summary: 'Home-service licence, travel terms and coverage (any member)' })
  @ApiZodResponse(200, homeServiceProfileSchema, 'The profile, or a blank draft.')
  @ApiErrors(401, 403, 404)
  get(@CurrentBusiness() ctx: BusinessContext) {
    return this.home.get(ctx.businessId);
  }

  @Put()
  @RequireBusinessCapability('onboarding.manage')
  @businessParam
  @ApiOperation({
    summary: 'Save the licence, travel buffer, minimum and coverage areas (owner)',
    description:
      'Licence details change only while a draft or rejected (409 HOME_PROFILE_LOCKED). Travel terms and areas apply to new bookings only.',
  })
  @ApiZodBody(homeServiceProfileInputSchema)
  @ApiZodResponse(200, homeServiceProfileSchema, 'The saved profile.')
  @ApiErrors(400, 401, 403, 404, 409)
  save(
    @CurrentBusiness() ctx: BusinessContext,
    @CurrentUser() user: UserPrincipal,
    @ZodBody(homeServiceProfileInputSchema) body: HomeServiceProfileInput,
    @Req() req: Request,
  ) {
    return this.home.save(
      { businessId: ctx.businessId, userId: user.userId },
      body,
      requestMeta(req),
    );
  }

  @Post('submit')
  @HttpCode(HttpStatus.OK)
  @RequireBusinessCapability('onboarding.manage')
  @businessParam
  @ApiOperation({
    summary: 'Ask the marketplace to approve home visits (owner)',
    description: '422 HOME_PROFILE_INCOMPLETE lists what is missing; 409 INVALID_TRANSITION.',
  })
  @ApiZodResponse(200, homeServiceProfileSchema, 'The profile, now pending.')
  @ApiErrors(401, 403, 404, 409, 422)
  submit(
    @CurrentBusiness() ctx: BusinessContext,
    @CurrentUser() user: UserPrincipal,
    @Req() req: Request,
  ) {
    return this.home.submit({ businessId: ctx.businessId, userId: user.userId }, requestMeta(req));
  }
}

/** Review of home-service applications (compliance). */
@ApiTags('admin-bookings')
@ApiBearerAuth()
@UseGuards(AdminAuthGuard)
@Controller('admin/home-services')
export class AdminHomeServicesController {
  constructor(@Inject(HomeServicesService) private readonly home: HomeServicesService) {}

  @Get()
  @RequirePlatformCapability('businesses.view')
  @ApiOperation({ summary: 'Home-service applications and approvals, latest first' })
  @ApiZodQuery(adminHomeServiceListQuerySchema)
  @ApiZodResponse(200, pageSchema(adminHomeServiceSchema), 'A page of profiles.')
  @ApiErrors(400, 401, 403)
  list(@ZodQuery(adminHomeServiceListQuerySchema) query: AdminHomeServiceListQuery) {
    return this.home.list(query);
  }

  @Get(':businessId')
  @RequirePlatformCapability('businesses.view')
  @businessParam
  @ApiOperation({ summary: "A business's home-service profile" })
  @ApiZodResponse(200, adminHomeServiceSchema, 'The profile.')
  @ApiErrors(401, 403, 404)
  get(@UuidParam('businessId') businessId: string) {
    return this.home.adminGet(businessId);
  }

  @Post(':businessId/decision')
  @HttpCode(HttpStatus.OK)
  @RequirePlatformCapability('businesses.review')
  @businessParam
  @ApiOperation({
    summary: 'Approve, reject, suspend or reinstate home visits (compliance)',
    description:
      'A reason is required to reject or suspend. 409 VERSION_CONFLICT, INVALID_TRANSITION or LICENSE_EXPIRED.',
  })
  @ApiZodBody(homeServiceDecisionRequestSchema)
  @ApiZodResponse(200, adminHomeServiceSchema, 'The profile after the decision.')
  @ApiErrors(400, 401, 403, 404, 409)
  decide(
    @CurrentAdmin() admin: AdminPrincipal,
    @UuidParam('businessId') businessId: string,
    @ZodBody(homeServiceDecisionRequestSchema) body: HomeServiceDecisionRequest,
    @Req() req: Request,
  ) {
    return this.home.decide(admin.adminId, businessId, body, requestMeta(req));
  }
}
