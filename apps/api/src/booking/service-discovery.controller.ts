import {
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Inject,
  Patch,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiParam, ApiTags } from '@nestjs/swagger';
import {
  addonInputSchema,
  addonListSchema,
  addonSchema,
  createPortfolioItemRequestSchema,
  joinWaitlistRequestSchema,
  mediaSchema,
  nextAvailableQuerySchema,
  nextAvailableSchema,
  pageSchema,
  portfolioImageUploadRequestSchema,
  portfolioItemSchema,
  portfolioListSchema,
  publicServiceListItemSchema,
  rebookSchema,
  serviceListQuerySchema,
  updateAddonRequestSchema,
  uploadTicketSchema,
  waitlistEntrySchema,
  waitlistListSchema,
  type AddonInput,
  type CreatePortfolioItemRequest,
  type JoinWaitlistRequest,
  type NextAvailableQuery,
  type ServiceListQuery,
  type UpdateAddonRequest,
} from '@jays/contracts';
import type { Request } from 'express';
import type { z } from 'zod';
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
import { OnboardingService } from '../onboarding/onboarding.service.js';
import { ServiceDiscoveryService } from './service-discovery.service.js';

const uuidParam = (name: string) => ApiParam({ name, format: 'uuid' });

/** Service search, next free time, waitlists and rebooking (phase 8.7, ADR-0026). */
@ApiTags('bookings')
@Controller()
export class ServiceDiscoveryController {
  constructor(
    @Inject(ServiceDiscoveryService) private readonly discovery: ServiceDiscoveryService,
  ) {}

  @Get('services')
  @ApiOperation({
    summary: 'Search bookable services across venues',
    description:
      'Text matches the service title or description or the venue name, in English or Arabic. Ratings come only from published reviews of appointments; "popular" counts appointments in the last 90 days.',
  })
  @ApiZodQuery(serviceListQuerySchema)
  @ApiZodResponse(200, pageSchema(publicServiceListItemSchema), 'A page of services.')
  @ApiErrors(400)
  search(@ZodQuery(serviceListQuerySchema) query: ServiceListQuery) {
    return this.discovery.search(query);
  }

  @Get('services/:serviceId/next-available')
  @uuidParam('serviceId')
  @ApiOperation({
    summary: 'The earliest free time for a service in the next 14 days',
    description: 'Computed like availability; the hold still decides.',
  })
  @ApiZodQuery(nextAvailableQuerySchema)
  @ApiZodResponse(200, nextAvailableSchema, 'The next free time, or null.')
  @ApiErrors(400, 404)
  nextAvailable(
    @UuidParam('serviceId') serviceId: string,
    @ZodQuery(nextAvailableQuerySchema) query: NextAvailableQuery,
  ) {
    return this.discovery.nextAvailable(serviceId, query);
  }

  @Get('me/waitlist')
  @UseGuards(UserAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'My waitlist entries that are still waiting or were notified' })
  @ApiZodResponse(200, waitlistListSchema, 'Entries, soonest date first.')
  @ApiErrors(401)
  waitlist(@CurrentUser() user: UserPrincipal) {
    return this.discovery.listWaitlist(user.userId);
  }

  @Post('me/waitlist')
  @HttpCode(HttpStatus.OK)
  @UseGuards(UserAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({
    summary: 'Wait for a time to open (one entry per service, branch and date)',
    description:
      'Nothing is reserved: when a matching appointment is canceled or its hold expires, everyone waiting is told once and the first to book gets it. 409 WAITLIST_LIMIT after 5 active entries.',
  })
  @ApiZodBody(joinWaitlistRequestSchema)
  @ApiZodResponse(200, waitlistEntrySchema, 'The entry.')
  @ApiErrors(400, 401, 404, 409, 422)
  join(
    @CurrentUser() user: UserPrincipal,
    @ZodBody(joinWaitlistRequestSchema) body: JoinWaitlistRequest,
    @Req() req: Request,
  ) {
    return this.discovery.joinWaitlist(user.userId, body, requestMeta(req));
  }

  @Delete('me/waitlist/:entryId')
  @UseGuards(UserAuthGuard)
  @ApiBearerAuth()
  @uuidParam('entryId')
  @ApiOperation({ summary: 'Stop waiting' })
  @ApiZodResponse(200, waitlistListSchema, 'Remaining entries.')
  @ApiErrors(401, 404)
  leave(@CurrentUser() user: UserPrincipal, @UuidParam('entryId') entryId: string) {
    return this.discovery.leaveWaitlist(user.userId, entryId);
  }

  @Get('bookings/:bookingId/rebook')
  @UseGuards(UserAuthGuard)
  @ApiBearerAuth()
  @uuidParam('bookingId')
  @ApiOperation({
    summary: 'What "Book again" prefills from one of my appointments',
    description: 'Nothing is held; pick a time and hold as usual.',
  })
  @ApiZodResponse(200, rebookSchema, 'The prefill.')
  @ApiErrors(401, 404)
  rebook(@CurrentUser() user: UserPrincipal, @UuidParam('bookingId') bookingId: string) {
    return this.discovery.rebook(user.userId, bookingId);
  }
}

/** Add-ons and the portfolio of one business (phase 8.7). */
@ApiTags('business-services')
@ApiBearerAuth()
@UseGuards(UserAuthGuard, BusinessAccessGuard)
@Controller('businesses/:businessId')
export class BusinessServiceExtrasController {
  constructor(
    @Inject(ServiceDiscoveryService) private readonly discovery: ServiceDiscoveryService,
    @Inject(OnboardingService) private readonly onboarding: OnboardingService,
  ) {}

  private actor(ctx: BusinessContext, user: UserPrincipal, req: Request) {
    return { businessId: ctx.businessId, userId: user.userId, meta: requestMeta(req) };
  }

  @Get('services/:serviceId/addons')
  @RequireBusinessCapability('business.view')
  @uuidParam('businessId')
  @uuidParam('serviceId')
  @ApiOperation({ summary: "A service's add-ons, active first (any member)" })
  @ApiZodResponse(200, addonListSchema, 'Add-ons.')
  @ApiErrors(401, 403, 404)
  addons(@CurrentBusiness() ctx: BusinessContext, @UuidParam('serviceId') serviceId: string) {
    return this.discovery.listAddons(ctx.businessId, serviceId);
  }

  @Post('services/:serviceId/addons')
  @RequireBusinessCapability('services.manage')
  @uuidParam('businessId')
  @uuidParam('serviceId')
  @ApiOperation({
    summary: 'Add an add-on to a service (owner, manager)',
    description: 'Up to 20 active add-ons; price VAT-inclusive; minutes on the 5-minute grid.',
  })
  @ApiZodBody(addonInputSchema)
  @ApiZodResponse(201, addonSchema, 'The add-on.')
  @ApiErrors(400, 401, 403, 404, 409)
  createAddon(
    @CurrentBusiness() ctx: BusinessContext,
    @CurrentUser() user: UserPrincipal,
    @UuidParam('serviceId') serviceId: string,
    @ZodBody(addonInputSchema) body: AddonInput,
    @Req() req: Request,
  ) {
    return this.discovery.createAddon(this.actor(ctx, user, req), serviceId, body);
  }

  @Patch('addons/:addonId')
  @RequireBusinessCapability('services.manage')
  @uuidParam('businessId')
  @uuidParam('addonId')
  @ApiOperation({
    summary: 'Edit or archive an add-on (owner, manager)',
    description: 'Applies to new bookings only; booked appointments keep what was booked.',
  })
  @ApiZodBody(updateAddonRequestSchema)
  @ApiZodResponse(200, addonSchema, 'The add-on.')
  @ApiErrors(400, 401, 403, 404, 409)
  updateAddon(
    @CurrentBusiness() ctx: BusinessContext,
    @CurrentUser() user: UserPrincipal,
    @UuidParam('addonId') addonId: string,
    @ZodBody(updateAddonRequestSchema) body: UpdateAddonRequest,
    @Req() req: Request,
  ) {
    return this.discovery.updateAddon(this.actor(ctx, user, req), addonId, body);
  }

  @Get('portfolio')
  @RequireBusinessCapability('business.view')
  @uuidParam('businessId')
  @ApiOperation({ summary: 'Portfolio photos (any member)' })
  @ApiZodResponse(200, portfolioListSchema, 'Photos.')
  @ApiErrors(401, 403, 404)
  portfolio(@CurrentBusiness() ctx: BusinessContext) {
    return this.discovery.listPortfolio(ctx.businessId);
  }

  @Post('portfolio-images')
  @RequireBusinessCapability('services.manage')
  @uuidParam('businessId')
  @ApiOperation({
    summary: 'Start a portfolio photo upload; returns a signed PUT URL (owner, manager)',
    description: 'JPEG, PNG or WebP up to 5 MB, at least 600×600, aspect ratio 1:2 to 2:1.',
  })
  @ApiZodBody(portfolioImageUploadRequestSchema)
  @ApiZodResponse(201, uploadTicketSchema, 'Upload ticket.')
  @ApiErrors(400, 401, 403, 404, 429)
  createImage(
    @CurrentBusiness() ctx: BusinessContext,
    @CurrentUser() user: UserPrincipal,
    @ZodBody(portfolioImageUploadRequestSchema)
    body: z.infer<typeof portfolioImageUploadRequestSchema>,
  ) {
    return this.onboarding.createMediaUpload(ctx, user.userId, {
      ...body,
      purpose: 'portfolio_image',
    });
  }

  @Post('portfolio-images/:mediaId/complete')
  @HttpCode(HttpStatus.OK)
  @RequireBusinessCapability('services.manage')
  @uuidParam('businessId')
  @uuidParam('mediaId')
  @ApiOperation({ summary: 'Check an uploaded portfolio photo: type, size, dimensions' })
  @ApiZodResponse(200, mediaSchema, 'The photo, now ready.')
  @ApiErrors(401, 403, 404, 409, 422)
  completeImage(
    @CurrentBusiness() ctx: BusinessContext,
    @CurrentUser() user: UserPrincipal,
    @UuidParam('mediaId') mediaId: string,
    @Req() req: Request,
  ) {
    return this.onboarding.completeMedia(ctx, user.userId, mediaId, requestMeta(req));
  }

  @Post('portfolio')
  @RequireBusinessCapability('services.manage')
  @uuidParam('businessId')
  @ApiOperation({
    summary: 'Add an uploaded photo to the portfolio (owner, manager)',
    description: 'Optionally tagged with a service or professional. Up to 60 photos.',
  })
  @ApiZodBody(createPortfolioItemRequestSchema)
  @ApiZodResponse(201, portfolioItemSchema, 'The portfolio item.')
  @ApiErrors(400, 401, 403, 404, 409)
  addPortfolio(
    @CurrentBusiness() ctx: BusinessContext,
    @CurrentUser() user: UserPrincipal,
    @ZodBody(createPortfolioItemRequestSchema) body: CreatePortfolioItemRequest,
    @Req() req: Request,
  ) {
    return this.discovery.addPortfolioItem(this.actor(ctx, user, req), body);
  }

  @Delete('portfolio/:itemId')
  @RequireBusinessCapability('services.manage')
  @uuidParam('businessId')
  @uuidParam('itemId')
  @ApiOperation({ summary: 'Remove a photo from the portfolio (owner, manager)' })
  @ApiZodResponse(200, portfolioListSchema, 'Remaining photos.')
  @ApiErrors(401, 403, 404)
  removePortfolio(
    @CurrentBusiness() ctx: BusinessContext,
    @CurrentUser() user: UserPrincipal,
    @UuidParam('itemId') itemId: string,
    @Req() req: Request,
  ) {
    return this.discovery.removePortfolioItem(this.actor(ctx, user, req), itemId);
  }
}
