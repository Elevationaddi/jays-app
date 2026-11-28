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
  customerCancelRequestSchema,
  markNotificationsReadSchema,
  myReviewSchema,
  notificationListQuerySchema,
  notificationPageSchema,
  orderSchema,
  pageSchema,
  returnListQuerySchema,
  returnRequestInputSchema,
  returnSchema,
  reviewInputSchema,
  reviewListQuerySchema,
  reviewSummarySchema,
  ticketInputSchema,
  ticketListItemSchema,
  ticketListQuerySchema,
  ticketReplySchema,
  ticketSchema,
  type CustomerCancelRequest,
  type ReturnListQuery,
  type ReturnRequestInput,
  type ReviewInput,
  type TicketInput,
} from '@jays/contracts';
import type { Request } from 'express';
import type { z } from 'zod';
import { CurrentUser, UserAuthGuard, type UserPrincipal } from '../auth/guards.js';
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
import { FulfillmentService } from './fulfillment.service.js';
import { NotificationsService } from './notifications.service.js';
import { ReturnsService } from './returns.service.js';
import { ReviewsService } from './reviews.service.js';
import { SupportService } from './support.service.js';

const idParam = (name: string) => ApiParam({ name, format: 'uuid' });
type Cursor = { cursor?: string | undefined; limit: number };

/** Public review lists (docs/02-customer.md): published reviews only, first names only. */
@ApiTags('reviews')
@Controller()
export class PublicReviewsController {
  constructor(@Inject(ReviewsService) private readonly reviews: ReviewsService) {}

  @Get('products/:productId/reviews')
  @idParam('productId')
  @ApiOperation({ summary: 'Published reviews of a product, with the average rating' })
  @ApiZodQuery(reviewListQuerySchema)
  @ApiZodResponse(200, reviewSummarySchema, 'Reviews.')
  @ApiErrors(400, 404)
  product(@UuidParam('productId') id: string, @ZodQuery(reviewListQuerySchema) q: Cursor) {
    return this.reviews.forProduct(id, q);
  }

  @Get('venues/:businessId/reviews')
  @idParam('businessId')
  @ApiOperation({ summary: 'Published appointment reviews of a venue, with the average rating' })
  @ApiZodQuery(reviewListQuerySchema)
  @ApiZodResponse(200, reviewSummarySchema, 'Reviews.')
  @ApiErrors(400, 404)
  venue(@UuidParam('businessId') id: string, @ZodQuery(reviewListQuerySchema) q: Cursor) {
    return this.reviews.forVenue(id, q);
  }
}

/**
 * The customer side of after-sales (docs/02-customer.md; ADR-0016): cancel a suborder the
 * merchant has not started, request a return, review, contact support and read notifications.
 * Everything is scoped to the signed-in customer; anyone else's ids answer 404.
 */
@ApiTags('aftercare')
@ApiBearerAuth()
@UseGuards(UserAuthGuard)
@Controller()
export class CustomerAftercareController {
  constructor(
    @Inject(FulfillmentService) private readonly fulfillment: FulfillmentService,
    @Inject(ReturnsService) private readonly returns: ReturnsService,
    @Inject(ReviewsService) private readonly reviews: ReviewsService,
    @Inject(SupportService) private readonly support: SupportService,
    @Inject(NotificationsService) private readonly notifications: NotificationsService,
  ) {}

  @Post('orders/:orderId/cancel')
  @HttpCode(HttpStatus.OK)
  @idParam('orderId')
  @ApiOperation({
    summary: 'Cancel one seller’s part of my order before the seller starts it (full refund)',
    description: '409 INVALID_TRANSITION once processing has started; 422 NOT_REFUNDABLE.',
  })
  @ApiZodBody(customerCancelRequestSchema)
  @ApiZodResponse(200, orderSchema, 'The order.')
  @ApiErrors(400, 401, 404, 409, 422)
  cancel(
    @CurrentUser() user: UserPrincipal,
    @UuidParam('orderId') orderId: string,
    @ZodBody(customerCancelRequestSchema) body: CustomerCancelRequest,
    @Req() req: Request,
  ) {
    return this.fulfillment.customerCancel(user.userId, orderId, body, requestMeta(req));
  }

  @Post('orders/:orderId/returns')
  @idParam('orderId')
  @ApiOperation({
    summary: 'Ask to return delivered items',
    description:
      'Within 14 days of delivery (proposed default). 409 NOT_DELIVERED, RETURN_OPEN; 422 RETURN_WINDOW_CLOSED, RETURN_EXCEEDS_PURCHASE.',
  })
  @ApiZodBody(returnRequestInputSchema)
  @ApiZodResponse(201, returnSchema, 'The return request.')
  @ApiErrors(400, 401, 404, 409, 422)
  requestReturn(
    @CurrentUser() user: UserPrincipal,
    @UuidParam('orderId') orderId: string,
    @ZodBody(returnRequestInputSchema) body: ReturnRequestInput,
    @Req() req: Request,
  ) {
    return this.returns.create(user.userId, orderId, body, requestMeta(req));
  }

  @Get('me/returns')
  @ApiOperation({ summary: 'My returns, newest first' })
  @ApiZodQuery(returnListQuerySchema)
  @ApiZodResponse(200, pageSchema(returnSchema), 'A page of returns.')
  @ApiErrors(400, 401)
  myReturns(
    @CurrentUser() user: UserPrincipal,
    @ZodQuery(returnListQuerySchema) q: ReturnListQuery,
  ) {
    return this.returns.listForUser(user.userId, q);
  }

  @Post('reviews')
  @ApiOperation({
    summary: 'Review a delivered item or a completed appointment (T10)',
    description: '422 NOT_REVIEWABLE; 409 ALREADY_REVIEWED.',
  })
  @ApiZodBody(reviewInputSchema)
  @ApiZodResponse(201, myReviewSchema, 'The review.')
  @ApiErrors(400, 401, 404, 409, 422)
  review(
    @CurrentUser() user: UserPrincipal,
    @ZodBody(reviewInputSchema) body: ReviewInput,
    @Req() req: Request,
  ) {
    return this.reviews.create(user.userId, body, requestMeta(req));
  }

  @Get('me/reviews')
  @ApiOperation({ summary: 'My reviews, newest first' })
  @ApiZodQuery(reviewListQuerySchema)
  @ApiZodResponse(200, pageSchema(myReviewSchema), 'A page of reviews.')
  @ApiErrors(400, 401)
  myReviews(@CurrentUser() user: UserPrincipal, @ZodQuery(reviewListQuerySchema) q: Cursor) {
    return this.reviews.mine(user.userId, q);
  }

  @Post('support/tickets')
  @ApiOperation({ summary: 'Contact support about an order, a booking, a payment or my account' })
  @ApiZodBody(ticketInputSchema)
  @ApiZodResponse(201, ticketSchema, 'The ticket.')
  @ApiErrors(400, 401, 404)
  openTicket(
    @CurrentUser() user: UserPrincipal,
    @ZodBody(ticketInputSchema) body: TicketInput,
    @Req() req: Request,
  ) {
    return this.support.create(user.userId, body, requestMeta(req));
  }

  @Get('support/tickets')
  @ApiOperation({ summary: 'My support tickets, newest first' })
  @ApiZodQuery(ticketListQuerySchema)
  @ApiZodResponse(200, pageSchema(ticketListItemSchema), 'A page of tickets.')
  @ApiErrors(400, 401)
  tickets(@CurrentUser() user: UserPrincipal, @ZodQuery(ticketListQuerySchema) q: Cursor) {
    return this.support.listForUser(user.userId, q);
  }

  @Get('support/tickets/:ticketId')
  @idParam('ticketId')
  @ApiOperation({ summary: 'One of my tickets with its conversation (internal notes excluded)' })
  @ApiZodResponse(200, ticketSchema, 'The ticket.')
  @ApiErrors(401, 404)
  ticket(@CurrentUser() user: UserPrincipal, @UuidParam('ticketId') id: string) {
    return this.support.getForUser(user.userId, id);
  }

  @Post('support/tickets/:ticketId/messages')
  @idParam('ticketId')
  @ApiOperation({ summary: 'Reply on my ticket; replying to a resolved ticket reopens it' })
  @ApiZodBody(ticketReplySchema)
  @ApiZodResponse(201, ticketSchema, 'The ticket.')
  @ApiErrors(400, 401, 404)
  reply(
    @CurrentUser() user: UserPrincipal,
    @UuidParam('ticketId') id: string,
    @ZodBody(ticketReplySchema) body: z.infer<typeof ticketReplySchema>,
    @Req() req: Request,
  ) {
    return this.support.customerReply(user.userId, id, body.body, requestMeta(req));
  }

  @Get('me/notifications')
  @ApiOperation({ summary: 'My in-app notifications, newest first, with the unread count' })
  @ApiZodQuery(notificationListQuerySchema)
  @ApiZodResponse(200, notificationPageSchema, 'Notifications.')
  @ApiErrors(400, 401)
  notificationsList(
    @CurrentUser() user: UserPrincipal,
    @ZodQuery(notificationListQuerySchema) q: Cursor,
  ) {
    return this.notifications.list(user.userId, q);
  }

  @Post('me/notifications/read')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Mark notifications read (all of them when ids is omitted)' })
  @ApiZodBody(markNotificationsReadSchema)
  @ApiZodResponse(200, notificationPageSchema, 'Notifications.')
  @ApiErrors(400, 401)
  markRead(
    @CurrentUser() user: UserPrincipal,
    @ZodBody(markNotificationsReadSchema) body: z.infer<typeof markNotificationsReadSchema>,
  ) {
    return this.notifications.markRead(user.userId, body.ids);
  }
}
