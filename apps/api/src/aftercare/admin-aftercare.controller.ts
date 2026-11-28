import { Controller, Get, Inject, Post, Req, Res, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiParam, ApiProduces, ApiTags } from '@nestjs/swagger';
import {
  adminDashboardSchema,
  adminOrderListQuerySchema,
  adminOrderSchema,
  adminReviewListQuerySchema,
  adminReviewSchema,
  adminTicketActionSchema,
  adminTicketListItemSchema,
  adminTicketListQuerySchema,
  adminTicketMessageSchema,
  adminTicketSchema,
  dashboardRangeSchema,
  exportKindSchema,
  exportQuerySchema,
  failedOutboxEventSchema,
  notificationTemplateInputSchema,
  notificationTemplateSchema,
  outboxHealthSchema,
  pageSchema,
  reviewModerationSchema,
  type AdminOrderListQuery,
  type AdminReviewListQuery,
  type AdminTicketListQuery,
  type DashboardRange,
  type ExportQuery,
  type ReviewModeration,
} from '@jays/contracts';
import type { Request, Response } from 'express';
import { z } from 'zod';
import {
  AdminAuthGuard,
  type AdminPrincipal,
  CurrentAdmin,
  RequirePlatformCapability,
} from '../admin/admin.guard.js';
import { ApiError } from '../common/error.filter.js';
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
import { sendCsv } from './business-aftercare.controller.js';
import { DashboardsService } from './dashboards.service.js';
import { ExportsService } from './exports.service.js';
import { FulfillmentService } from './fulfillment.service.js';
import { NotificationsService } from './notifications.service.js';
import { ReviewsService } from './reviews.service.js';
import { SupportService } from './support.service.js';

const idParam = (name: string) => ApiParam({ name, format: 'uuid' });

/**
 * Platform after-sales (docs/04-admin.md; ADR-0016): fulfillment monitoring (`orders.view`),
 * review moderation (`reviews.moderate`), the support queue (`support.handle`), notification
 * templates and outbox health (`notifications.manage`), the dashboard and CSV exports
 * (`exports.run`). Every change and every export is audited.
 */
@ApiTags('admin-aftercare')
@ApiBearerAuth()
@UseGuards(AdminAuthGuard)
@Controller('admin')
export class AdminAftercareController {
  constructor(
    @Inject(FulfillmentService) private readonly fulfillment: FulfillmentService,
    @Inject(ReviewsService) private readonly reviews: ReviewsService,
    @Inject(SupportService) private readonly support: SupportService,
    @Inject(NotificationsService) private readonly notifications: NotificationsService,
    @Inject(DashboardsService) private readonly dashboards: DashboardsService,
    @Inject(ExportsService) private readonly exports: ExportsService,
  ) {}

  @Get('dashboard')
  @RequirePlatformCapability('orders.view')
  @ApiOperation({ summary: 'Platform GMV, refunds, commission, activity and open work' })
  @ApiZodQuery(dashboardRangeSchema)
  @ApiZodResponse(200, adminDashboardSchema, 'The dashboard.')
  @ApiErrors(400, 401, 403)
  dashboard(@ZodQuery(dashboardRangeSchema) q: DashboardRange) {
    return this.dashboards.admin(q);
  }

  @Get('orders')
  @RequirePlatformCapability('orders.view')
  @ApiOperation({
    summary: 'Suborders across merchants; stuck=true for paid or processing over 2 days',
  })
  @ApiZodQuery(adminOrderListQuerySchema)
  @ApiZodResponse(200, pageSchema(adminOrderSchema), 'A page of suborders.')
  @ApiErrors(400, 401, 403)
  orders(@ZodQuery(adminOrderListQuerySchema) q: AdminOrderListQuery) {
    return this.fulfillment.adminList(q);
  }

  @Get('reviews')
  @RequirePlatformCapability('reviews.moderate')
  @ApiOperation({ summary: 'Reviews to moderate: reported (default), hidden or all' })
  @ApiZodQuery(adminReviewListQuerySchema)
  @ApiZodResponse(200, pageSchema(adminReviewSchema), 'A page of reviews.')
  @ApiErrors(400, 401, 403)
  reviewList(@ZodQuery(adminReviewListQuerySchema) q: AdminReviewListQuery) {
    return this.reviews.adminList(q);
  }

  @Post('reviews/:reviewId/moderation')
  @RequirePlatformCapability('reviews.moderate')
  @idParam('reviewId')
  @ApiOperation({
    summary: 'Hide, restore or dismiss the report on a review, with a reason (audited)',
    description: '409 INVALID_TRANSITION, NO_OPEN_REPORT.',
  })
  @ApiZodBody(reviewModerationSchema)
  @ApiZodResponse(201, adminReviewSchema, 'The review.')
  @ApiErrors(400, 401, 403, 404, 409)
  moderate(
    @CurrentAdmin() admin: AdminPrincipal,
    @UuidParam('reviewId') id: string,
    @ZodBody(reviewModerationSchema) body: ReviewModeration,
    @Req() req: Request,
  ) {
    return this.reviews.moderate(admin.adminId, id, body, requestMeta(req));
  }

  @Get('support/tickets')
  @RequirePlatformCapability('support.handle')
  @ApiOperation({ summary: 'The support queue, newest first, with SLA due times' })
  @ApiZodQuery(adminTicketListQuerySchema)
  @ApiZodResponse(200, pageSchema(adminTicketListItemSchema), 'A page of tickets.')
  @ApiErrors(400, 401, 403)
  tickets(
    @CurrentAdmin() admin: AdminPrincipal,
    @ZodQuery(adminTicketListQuerySchema) q: AdminTicketListQuery,
  ) {
    return this.support.adminList(admin.adminId, q);
  }

  @Get('support/tickets/:ticketId')
  @RequirePlatformCapability('support.handle')
  @idParam('ticketId')
  @ApiOperation({ summary: 'A ticket with its whole conversation, internal notes included' })
  @ApiZodResponse(200, adminTicketSchema, 'The ticket.')
  @ApiErrors(401, 403, 404)
  ticket(@UuidParam('ticketId') id: string) {
    return this.support.adminGet(id);
  }

  @Post('support/tickets/:ticketId/messages')
  @RequirePlatformCapability('support.handle')
  @idParam('ticketId')
  @ApiOperation({
    summary: 'Reply to the customer, or add an internal note (internal: true)',
    description: '409 INVALID_TRANSITION when replying to a resolved ticket.',
  })
  @ApiZodBody(adminTicketMessageSchema)
  @ApiZodResponse(201, adminTicketSchema, 'The ticket.')
  @ApiErrors(400, 401, 403, 404, 409)
  message(
    @CurrentAdmin() admin: AdminPrincipal,
    @UuidParam('ticketId') id: string,
    @ZodBody(adminTicketMessageSchema) body: z.infer<typeof adminTicketMessageSchema>,
    @Req() req: Request,
  ) {
    return this.support.adminMessage(admin.adminId, id, body, requestMeta(req));
  }

  @Post('support/tickets/:ticketId/actions')
  @RequirePlatformCapability('support.handle')
  @idParam('ticketId')
  @ApiOperation({ summary: 'Assign to me, unassign or resolve a ticket' })
  @ApiZodBody(adminTicketActionSchema)
  @ApiZodResponse(201, adminTicketSchema, 'The ticket.')
  @ApiErrors(400, 401, 403, 404, 409)
  ticketAction(
    @CurrentAdmin() admin: AdminPrincipal,
    @UuidParam('ticketId') id: string,
    @ZodBody(adminTicketActionSchema) body: z.infer<typeof adminTicketActionSchema>,
    @Req() req: Request,
  ) {
    return this.support.adminAction(admin.adminId, id, body.action, requestMeta(req));
  }

  @Get('notifications/templates')
  @RequirePlatformCapability('notifications.manage')
  @ApiOperation({ summary: 'The template in force for each event and language' })
  @ApiZodResponse(200, z.array(notificationTemplateSchema), 'Templates.')
  @ApiErrors(401, 403)
  templates() {
    return this.notifications.templates();
  }

  @Post('notifications/templates')
  @RequirePlatformCapability('notifications.manage')
  @ApiOperation({
    summary: 'Publish a new version of a template (history is kept)',
    description: '422 UNKNOWN_EVENT, UNKNOWN_PLACEHOLDER.',
  })
  @ApiZodBody(notificationTemplateInputSchema)
  @ApiZodResponse(201, z.array(notificationTemplateSchema), 'Templates.')
  @ApiErrors(400, 401, 403, 422)
  createTemplate(
    @CurrentAdmin() admin: AdminPrincipal,
    @ZodBody(notificationTemplateInputSchema) body: z.infer<typeof notificationTemplateInputSchema>,
    @Req() req: Request,
  ) {
    return this.notifications.createTemplate(admin.adminId, body, requestMeta(req));
  }

  @Get('notifications/health')
  @RequirePlatformCapability('notifications.manage')
  @ApiOperation({ summary: 'Outbox backlog: pending, retrying, failed and the oldest wait' })
  @ApiZodResponse(200, outboxHealthSchema, 'Outbox health.')
  @ApiErrors(401, 403)
  health() {
    return this.notifications.outboxHealth();
  }

  @Get('notifications/failed')
  @RequirePlatformCapability('notifications.manage')
  @ApiOperation({ summary: 'Events that used every attempt, newest first (no payloads)' })
  @ApiZodResponse(200, z.array(failedOutboxEventSchema), 'Failed events.')
  @ApiErrors(401, 403)
  failed() {
    return this.notifications.failedEvents();
  }

  @Post('notifications/failed/:outboxId/retry')
  @RequirePlatformCapability('notifications.manage')
  @idParam('outboxId')
  @ApiOperation({
    summary: 'Queue a failed event again with fresh attempts (audited)',
    description: 'Messages already delivered are not sent again. 409 NOT_FAILED.',
  })
  @ApiZodResponse(201, outboxHealthSchema, 'Outbox health after the retry.')
  @ApiErrors(401, 403, 404, 409)
  retry(
    @CurrentAdmin() admin: AdminPrincipal,
    @UuidParam('outboxId') outboxId: string,
    @Req() req: Request,
  ) {
    return this.notifications.retryFailed(admin.adminId, outboxId, requestMeta(req));
  }

  @Get('exports/:kind')
  @RequirePlatformCapability('exports.run')
  @ApiParam({ name: 'kind', enum: exportKindSchema.options })
  @ApiProduces('text/csv')
  @ApiOperation({
    summary: 'Download payments, refunds, payouts, orders or bookings as CSV (audited, no PII)',
  })
  @ApiZodQuery(exportQuerySchema)
  @ApiErrors(400, 401, 403, 404)
  async export(
    @CurrentAdmin() admin: AdminPrincipal,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
    @ZodQuery(exportQuerySchema) q: ExportQuery,
  ) {
    const kind = exportKindSchema.safeParse(req.params.kind);
    if (!kind.success) throw new ApiError(404, 'NOT_FOUND', 'Not found.');
    return sendCsv(res, await this.exports.admin(admin.adminId, kind.data, q, requestMeta(req)));
  }
}
