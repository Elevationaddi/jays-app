import {
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Inject,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiParam, ApiTags } from '@nestjs/swagger';
import {
  adminPilotPromotionSchema,
  businessPromotionSchema,
  cancelPilotPromotionRequestSchema,
  createPilotPromotionRequestSchema,
  pilotDashboardSchema,
  type CreatePilotPromotionRequest,
} from '@jays/contracts';
import type { Request } from 'express';
import type { z } from 'zod';
import {
  AdminAuthGuard,
  type AdminPrincipal,
  CurrentAdmin,
  RequirePlatformCapability,
} from '../admin/admin.guard.js';
import { UserAuthGuard } from '../auth/guards.js';
import {
  BusinessAccessGuard,
  type BusinessContext,
  CurrentBusiness,
  RequireBusinessCapability,
} from '../businesses/business-access.guard.js';
import { UuidParam } from '../common/params.js';
import { requestMeta } from '../common/request-context.js';
import { ApiErrors, ApiZodBody, ApiZodResponse, ZodBody } from '../common/zod.js';
import { PilotService } from './pilot.service.js';

/**
 * The Abu Dhabi pilot (ADR-0034): the dashboard for finance admins, and recording each approved
 * business's 0% commission promotion with the founder's approval reference. Audited.
 */
@ApiTags('admin-pilot')
@ApiBearerAuth()
@UseGuards(AdminAuthGuard)
@Controller('admin/pilot')
export class AdminPilotController {
  constructor(@Inject(PilotService) private readonly pilot: PilotService) {}

  @Get()
  @RequirePlatformCapability('finance.view')
  @ApiOperation({ summary: 'Pilot dashboard: targets, enrolled businesses, promotions and sales' })
  @ApiZodResponse(200, pilotDashboardSchema, 'The pilot dashboard.')
  @ApiErrors(401, 403)
  dashboard() {
    return this.pilot.dashboard();
  }

  @Post('promotions')
  @RequirePlatformCapability('finance.manage')
  @ApiOperation({
    summary: "Record an approved pilot business's 0% commission for 30 days",
    description:
      '422 EFFECTIVE_IN_PAST or BUSINESS_NOT_APPROVED; 409 PROMOTION_EXISTS (offered once per business).',
  })
  @ApiZodBody(createPilotPromotionRequestSchema)
  @ApiZodResponse(201, adminPilotPromotionSchema, 'The promotion.')
  @ApiErrors(400, 401, 403, 404, 409, 422)
  create(
    @CurrentAdmin() admin: AdminPrincipal,
    @ZodBody(createPilotPromotionRequestSchema) body: CreatePilotPromotionRequest,
    @Req() req: Request,
  ) {
    return this.pilot.create(admin.adminId, body, requestMeta(req));
  }

  @Post('promotions/:id/cancel')
  @HttpCode(HttpStatus.OK)
  @RequirePlatformCapability('finance.manage')
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiOperation({ summary: 'End a promotion now (earlier sales keep their rate)' })
  @ApiZodBody(cancelPilotPromotionRequestSchema)
  @ApiZodResponse(200, adminPilotPromotionSchema, 'The promotion.')
  @ApiErrors(400, 401, 403, 404, 409)
  cancel(
    @CurrentAdmin() admin: AdminPrincipal,
    @UuidParam('id') id: string,
    @ZodBody(cancelPilotPromotionRequestSchema)
    body: z.infer<typeof cancelPilotPromotionRequestSchema>,
    @Req() req: Request,
  ) {
    return this.pilot.cancel(admin.adminId, id, body.reason, requestMeta(req));
  }
}

@ApiTags('business-finance')
@ApiBearerAuth()
@UseGuards(UserAuthGuard, BusinessAccessGuard)
@Controller('businesses/:businessId/finance')
export class BusinessPromotionController {
  constructor(@Inject(PilotService) private readonly pilot: PilotService) {}

  @Get('promotion')
  @RequireBusinessCapability('finance.view')
  @ApiParam({ name: 'businessId', format: 'uuid' })
  @ApiOperation({ summary: 'The pilot 0% commission promotion, if any, and the rate after it' })
  @ApiZodResponse(200, businessPromotionSchema, 'Promotion.')
  @ApiErrors(401, 403, 404)
  promotion(@CurrentBusiness() ctx: BusinessContext) {
    return this.pilot.forBusiness(ctx.businessId);
  }
}
