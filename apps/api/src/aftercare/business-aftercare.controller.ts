import { Controller, Get, Inject, Post, Req, Res, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiParam, ApiProduces, ApiTags } from '@nestjs/swagger';
import {
  businessDashboardSchema,
  dashboardRangeSchema,
  exportQuerySchema,
  fulfillmentActionRequestSchema,
  merchantOrderSchema,
  merchantReviewSchema,
  pageSchema,
  returnActionRequestSchema,
  returnListQuerySchema,
  returnSchema,
  reviewListQuerySchema,
  reviewReplySchema,
  reviewReportSchema,
  type DashboardRange,
  type ExportQuery,
  type FulfillmentActionRequest,
  type ReturnActionRequest,
  type ReturnListQuery,
} from '@jays/contracts';
import type { Request, Response } from 'express';
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
import { DashboardsService } from './dashboards.service.js';
import { ExportsService } from './exports.service.js';
import { FulfillmentService } from './fulfillment.service.js';
import { ReturnsService } from './returns.service.js';
import { ReviewsService } from './reviews.service.js';

const businessParam = ApiParam({ name: 'businessId', format: 'uuid' });
const idParam = (name: string) => ApiParam({ name, format: 'uuid' });
type Cursor = { cursor?: string | undefined; limit: number };

export function sendCsv(res: Response, file: { filename: string; csv: string }) {
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="${file.filename}"`);
  res.setHeader('Cache-Control', 'no-store');
  // A byte-order mark so spreadsheet apps read Arabic names as UTF-8.
  return `\uFEFF${file.csv}`;
}

/**
 * The merchant side of after-sales (docs/03-business.md; ADR-0016): fulfil suborders, handle
 * returns, answer reviews, read the dashboard and download a statement. Each route names the
 * capability it needs (ADR-0010); everything is scoped to the business in the path.
 */
@ApiTags('business-aftercare')
@ApiBearerAuth()
@UseGuards(UserAuthGuard, BusinessAccessGuard)
@Controller('businesses/:businessId')
export class BusinessAftercareController {
  constructor(
    @Inject(FulfillmentService) private readonly fulfillment: FulfillmentService,
    @Inject(ReturnsService) private readonly returns: ReturnsService,
    @Inject(ReviewsService) private readonly reviews: ReviewsService,
    @Inject(DashboardsService) private readonly dashboards: DashboardsService,
    @Inject(ExportsService) private readonly exports: ExportsService,
  ) {}

  @Post('orders/:merchantOrderId/fulfillment')
  @RequireBusinessCapability('orders.fulfill')
  @businessParam
  @idParam('merchantOrderId')
  @ApiOperation({
    summary: 'Process, ship (carrier and tracking), deliver or cancel a suborder',
    description:
      'expectedStatus must match the current status (409 VERSION_CONFLICT). Cancelling is possible before dispatch and refunds the whole suborder (409 INVALID_TRANSITION otherwise; 422 NOT_REFUNDABLE).',
  })
  @ApiZodBody(fulfillmentActionRequestSchema)
  @ApiZodResponse(201, merchantOrderSchema, 'The suborder.')
  @ApiErrors(400, 401, 403, 404, 409, 422)
  fulfil(
    @CurrentBusiness() ctx: BusinessContext,
    @CurrentUser() user: UserPrincipal,
    @UuidParam('merchantOrderId') id: string,
    @ZodBody(fulfillmentActionRequestSchema) body: FulfillmentActionRequest,
    @Req() req: Request,
  ) {
    return this.fulfillment.merchantAction(ctx.businessId, user.userId, id, body, requestMeta(req));
  }

  @Get('returns')
  @RequireBusinessCapability('returns.manage')
  @businessParam
  @ApiOperation({ summary: 'Return requests, newest first' })
  @ApiZodQuery(returnListQuerySchema)
  @ApiZodResponse(200, pageSchema(returnSchema), 'A page of returns.')
  @ApiErrors(400, 401, 403, 404)
  returnList(
    @CurrentBusiness() ctx: BusinessContext,
    @ZodQuery(returnListQuerySchema) q: ReturnListQuery,
  ) {
    return this.returns.listForBusiness(ctx.businessId, q);
  }

  @Get('returns/:returnId')
  @RequireBusinessCapability('returns.manage')
  @businessParam
  @idParam('returnId')
  @ApiOperation({ summary: 'One return request' })
  @ApiZodResponse(200, returnSchema, 'The return.')
  @ApiErrors(401, 403, 404)
  returnOne(@CurrentBusiness() ctx: BusinessContext, @UuidParam('returnId') id: string) {
    return this.returns.get({ businessId: ctx.businessId }, id);
  }

  @Post('returns/:returnId/actions')
  @RequireBusinessCapability('returns.manage')
  @businessParam
  @idParam('returnId')
  @ApiOperation({
    summary: 'Approve, reject (with a reason) or mark a return received (starts the refund)',
    description: '409 INVALID_TRANSITION.',
  })
  @ApiZodBody(returnActionRequestSchema)
  @ApiZodResponse(201, returnSchema, 'The return.')
  @ApiErrors(400, 401, 403, 404, 409)
  returnAction(
    @CurrentBusiness() ctx: BusinessContext,
    @CurrentUser() user: UserPrincipal,
    @UuidParam('returnId') id: string,
    @ZodBody(returnActionRequestSchema) body: ReturnActionRequest,
    @Req() req: Request,
  ) {
    return this.returns.merchantAction(ctx.businessId, user.userId, id, body, requestMeta(req));
  }

  @Get('reviews')
  @RequireBusinessCapability('reviews.respond')
  @businessParam
  @ApiOperation({ summary: 'Reviews of this business, including hidden ones, newest first' })
  @ApiZodQuery(reviewListQuerySchema)
  @ApiZodResponse(200, pageSchema(merchantReviewSchema), 'A page of reviews.')
  @ApiErrors(400, 401, 403, 404)
  reviewList(@CurrentBusiness() ctx: BusinessContext, @ZodQuery(reviewListQuerySchema) q: Cursor) {
    return this.reviews.listForBusiness(ctx.businessId, q);
  }

  @Post('reviews/:reviewId/replies')
  @RequireBusinessCapability('reviews.respond')
  @businessParam
  @idParam('reviewId')
  @ApiOperation({ summary: 'Reply to a review (a new reply supersedes, history is kept)' })
  @ApiZodBody(reviewReplySchema)
  @ApiZodResponse(201, merchantReviewSchema, 'The review.')
  @ApiErrors(400, 401, 403, 404)
  replyToReview(
    @CurrentBusiness() ctx: BusinessContext,
    @CurrentUser() user: UserPrincipal,
    @UuidParam('reviewId') id: string,
    @ZodBody(reviewReplySchema) body: z.infer<typeof reviewReplySchema>,
    @Req() req: Request,
  ) {
    return this.reviews.reply(ctx.businessId, user.userId, id, body.body, requestMeta(req));
  }

  @Post('reviews/:reviewId/report')
  @RequireBusinessCapability('reviews.respond')
  @businessParam
  @idParam('reviewId')
  @ApiOperation({
    summary: 'Report a review to moderation (merchants cannot hide reviews)',
    description: '409 ALREADY_REPORTED.',
  })
  @ApiZodBody(reviewReportSchema)
  @ApiZodResponse(201, merchantReviewSchema, 'The review.')
  @ApiErrors(400, 401, 403, 404, 409)
  reportReview(
    @CurrentBusiness() ctx: BusinessContext,
    @CurrentUser() user: UserPrincipal,
    @UuidParam('reviewId') id: string,
    @ZodBody(reviewReportSchema) body: z.infer<typeof reviewReportSchema>,
    @Req() req: Request,
  ) {
    return this.reviews.report(ctx.businessId, user.userId, id, body.reason, requestMeta(req));
  }

  @Get('dashboard')
  @RequireBusinessCapability('dashboard.view')
  @businessParam
  @ApiOperation({
    summary: 'Sales, orders, returns, stock, bookings and occupancy for a date range',
  })
  @ApiZodQuery(dashboardRangeSchema)
  @ApiZodResponse(200, businessDashboardSchema, 'The dashboard.')
  @ApiErrors(400, 401, 403, 404)
  dashboard(
    @CurrentBusiness() ctx: BusinessContext,
    @ZodQuery(dashboardRangeSchema) q: DashboardRange,
  ) {
    return this.dashboards.business(ctx.businessId, q);
  }

  @Get('finance/statement')
  @RequireBusinessCapability('finance.view')
  @businessParam
  @ApiProduces('text/csv')
  @ApiOperation({
    summary: 'Download earnings, fees and refunds for a date range as CSV (audited)',
  })
  @ApiZodQuery(exportQuerySchema)
  @ApiErrors(400, 401, 403, 404)
  async statement(
    @CurrentBusiness() ctx: BusinessContext,
    @CurrentUser() user: UserPrincipal,
    @ZodQuery(exportQuerySchema) q: ExportQuery,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    return sendCsv(
      res,
      await this.exports.businessStatement(ctx.businessId, user.userId, q, requestMeta(req)),
    );
  }
}
