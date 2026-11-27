import {
  Controller,
  Inject,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiParam, ApiTags } from '@nestjs/swagger';
import {
  businessSchema,
  createBusinessRequestSchema,
  inviteMemberRequestSchema,
  memberSchema,
  modeSchema,
  pageSchema,
  updateMemberRequestSchema,
  type CreateBusinessRequest,
} from '@jays/contracts';
import type { Request } from 'express';
import { z } from 'zod';
import { CurrentUser, UserAuthGuard, type UserPrincipal } from '../auth/guards.js';
import { listQuerySchema, type ListQuery } from '../common/pagination.js';
import { UuidParam } from '../common/params.js';
import { requestMeta } from '../common/request-context.js';
import {
  ApiErrors,
  ApiZodBody,
  ApiZodQuery,
  ApiZodResponse,
  ZodBody,
  ZodPipe,
  ZodQuery,
} from '../common/zod.js';
import {
  BusinessAccessGuard,
  type BusinessContext,
  CurrentBusiness,
  RequireBusinessCapability,
} from './business-access.guard.js';
import { BusinessesService } from './businesses.service.js';

@ApiTags('businesses')
@ApiBearerAuth()
@Controller('businesses')
export class BusinessesController {
  constructor(@Inject(BusinessesService) private readonly businesses: BusinessesService) {}

  @Post()
  @UseGuards(UserAuthGuard)
  @ApiOperation({
    summary: 'Start a business (the caller becomes its owner)',
    description:
      'Creates a draft business with onboarding started for the chosen modes. Nothing is public until approved.',
  })
  @ApiZodBody(createBusinessRequestSchema)
  @ApiZodResponse(201, businessSchema, 'Created.')
  @ApiErrors(400, 401, 429)
  create(
    @CurrentUser() user: UserPrincipal,
    @ZodBody(createBusinessRequestSchema) body: CreateBusinessRequest,
    @Req() req: Request,
  ) {
    return this.businesses.create(user.userId, body, requestMeta(req));
  }

  @Get(':businessId')
  @UseGuards(UserAuthGuard, BusinessAccessGuard)
  @RequireBusinessCapability('business.view')
  @ApiParam({ name: 'businessId', format: 'uuid' })
  @ApiOperation({ summary: 'A business I am an active member of' })
  @ApiZodResponse(200, businessSchema, 'The business, with my permissions.')
  @ApiErrors(401, 404)
  get(@CurrentBusiness() ctx: BusinessContext) {
    return this.businesses.view(ctx.businessId, ctx.permissions);
  }

  @Post(':businessId/modes/:mode/activate')
  @HttpCode(HttpStatus.OK)
  @UseGuards(UserAuthGuard, BusinessAccessGuard)
  @RequireBusinessCapability('modes.manage')
  @ApiParam({ name: 'businessId', format: 'uuid' })
  @ApiParam({ name: 'mode', enum: ['shop', 'services'] })
  @ApiOperation({ summary: 'Start onboarding for Shop Products or Book Services (owner only)' })
  @ApiZodResponse(200, businessSchema, 'Mode is in onboarding (or already further along).')
  @ApiErrors(400, 401, 403, 404)
  activateMode(
    @CurrentBusiness() ctx: BusinessContext,
    @CurrentUser() user: UserPrincipal,
    @Param('mode', new ZodPipe(modeSchema)) mode: z.infer<typeof modeSchema>,
    @Req() req: Request,
  ) {
    return this.businesses.activateMode(ctx, user.userId, mode, requestMeta(req));
  }

  @Get(':businessId/members')
  @UseGuards(UserAuthGuard, BusinessAccessGuard)
  @RequireBusinessCapability('members.view')
  @ApiParam({ name: 'businessId', format: 'uuid' })
  @ApiOperation({ summary: 'Team members and pending invitations' })
  @ApiZodQuery(listQuerySchema)
  @ApiZodResponse(200, pageSchema(memberSchema), 'A page of members.')
  @ApiErrors(400, 401, 403, 404)
  listMembers(
    @CurrentBusiness() ctx: BusinessContext,
    @ZodQuery(listQuerySchema) query: ListQuery,
  ) {
    return this.businesses.listMembers(ctx, query);
  }

  @Post(':businessId/members')
  @UseGuards(UserAuthGuard, BusinessAccessGuard)
  @RequireBusinessCapability('members.manage')
  @ApiParam({ name: 'businessId', format: 'uuid' })
  @ApiOperation({
    summary: 'Invite an existing verified account with permissions',
    description:
      'Managers can grant fulfillment, scheduler and professional. Only owners can grant owner, manager or finance.',
  })
  @ApiZodBody(inviteMemberRequestSchema)
  @ApiZodResponse(201, memberSchema, 'Invitation created; the invitee must accept.')
  @ApiErrors(400, 401, 403, 404, 409, 429)
  invite(
    @CurrentBusiness() ctx: BusinessContext,
    @CurrentUser() user: UserPrincipal,
    @ZodBody(inviteMemberRequestSchema) body: z.infer<typeof inviteMemberRequestSchema>,
    @Req() req: Request,
  ) {
    return this.businesses.inviteMember(
      ctx,
      user.userId,
      body.identifier,
      body.permissions,
      requestMeta(req),
    );
  }

  @Patch(':businessId/members/:memberId')
  @UseGuards(UserAuthGuard, BusinessAccessGuard)
  @RequireBusinessCapability('members.manage')
  @ApiParam({ name: 'businessId', format: 'uuid' })
  @ApiParam({ name: 'memberId', format: 'uuid' })
  @ApiOperation({ summary: "Change a member's permissions" })
  @ApiZodBody(updateMemberRequestSchema)
  @ApiZodResponse(200, memberSchema, 'Updated.')
  @ApiErrors(400, 401, 403, 404, 409)
  updateMember(
    @CurrentBusiness() ctx: BusinessContext,
    @CurrentUser() user: UserPrincipal,
    @UuidParam('memberId') memberId: string,
    @ZodBody(updateMemberRequestSchema) body: z.infer<typeof updateMemberRequestSchema>,
    @Req() req: Request,
  ) {
    return this.businesses.updateMember(
      ctx,
      user.userId,
      memberId,
      body.permissions,
      requestMeta(req),
    );
  }

  @Delete(':businessId/members/:memberId')
  @HttpCode(HttpStatus.NO_CONTENT)
  @UseGuards(UserAuthGuard, BusinessAccessGuard)
  @RequireBusinessCapability('members.manage')
  @ApiParam({ name: 'businessId', format: 'uuid' })
  @ApiParam({ name: 'memberId', format: 'uuid' })
  @ApiOperation({ summary: 'Remove a member or cancel an invitation' })
  @ApiZodResponse(204, z.null(), 'Removed.')
  @ApiErrors(401, 403, 404, 409)
  async removeMember(
    @CurrentBusiness() ctx: BusinessContext,
    @CurrentUser() user: UserPrincipal,
    @UuidParam('memberId') memberId: string,
    @Req() req: Request,
  ) {
    await this.businesses.removeMember(ctx, user.userId, memberId, requestMeta(req));
  }
}
