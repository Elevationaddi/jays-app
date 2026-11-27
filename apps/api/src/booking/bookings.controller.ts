import {
  Controller,
  Get,
  Headers,
  HttpCode,
  HttpStatus,
  Inject,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiHeader, ApiOperation, ApiParam, ApiTags } from '@nestjs/swagger';
import {
  availabilityQuerySchema,
  availabilitySchema,
  bookingListQuerySchema,
  bookingSchema,
  cancelBookingRequestSchema,
  holdRequestSchema,
  pageSchema,
  payBookingResponseSchema,
  publicVenueSchema,
  rescheduleRequestSchema,
  type AvailabilityQuery,
  type BookingListQuery,
  type CancelBookingRequest,
  type HoldRequest,
  type RescheduleRequest,
} from '@jays/contracts';
import type { Request } from 'express';
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
import { BookingsService } from './bookings.service.js';

const bookingParam = ApiParam({ name: 'bookingId', format: 'uuid' });

/** Public venues and availability, and the customer's own bookings (docs/07-api.md). */
@ApiTags('bookings')
@Controller()
export class BookingsController {
  constructor(@Inject(BookingsService) private readonly bookings: BookingsService) {}

  @Get('venues/:businessId')
  @ApiParam({ name: 'businessId', format: 'uuid' })
  @ApiOperation({
    summary: 'A bookable venue: branches with hours, services and staff',
    description:
      'Only approved businesses with an active services mode and a published storefront.',
  })
  @ApiZodResponse(200, publicVenueSchema, 'The venue.')
  @ApiErrors(404)
  venue(@UuidParam('businessId') businessId: string) {
    return this.bookings.venue(businessId);
  }

  @Get('availability')
  @ApiOperation({
    summary: 'Bookable start times for a service at a branch on a local date',
    description:
      'The date is in the branch timezone; slots are UTC instants with the staff free for each. Up to 60 days ahead. Availability can change: the hold decides.',
  })
  @ApiZodQuery(availabilityQuerySchema)
  @ApiZodResponse(200, availabilitySchema, 'Slots.')
  @ApiErrors(400, 404, 422)
  availability(@ZodQuery(availabilityQuerySchema) query: AvailabilityQuery) {
    return this.bookings.availability(query);
  }

  @Post('bookings/hold')
  @UseGuards(UserAuthGuard)
  @ApiBearerAuth()
  @ApiHeader({ name: 'Idempotency-Key', required: true, description: 'Required (docs/07-api.md).' })
  @ApiOperation({
    summary: 'Hold a slot for 10 minutes',
    description:
      'Omit staffId for any professional (fewest appointments that day, then a stable order). 409 SLOT_UNAVAILABLE, 409 HOLD_LIMIT (two open holds), 422 OUTSIDE_BOOKING_WINDOW. Pay with POST /bookings/{id}/pay.',
  })
  @ApiZodBody(holdRequestSchema)
  @ApiZodResponse(201, bookingSchema, 'The held booking.')
  @ApiErrors(400, 401, 404, 409, 422)
  hold(
    @CurrentUser() user: UserPrincipal,
    @ZodBody(holdRequestSchema) body: HoldRequest,
    @Headers('idempotency-key') key: string | undefined,
    @Req() req: Request,
  ) {
    return this.bookings.hold(user.userId, body, key, requestMeta(req));
  }

  @Post('bookings/:bookingId/pay')
  @HttpCode(HttpStatus.OK)
  @UseGuards(UserAuthGuard)
  @ApiBearerAuth()
  @bookingParam
  @ApiOperation({
    summary: 'Open the payment for a held booking',
    description:
      'Safe to retry: always the same payment. The booking is confirmed only when the provider confirms by verified webhook; poll GET /bookings/{id}. 409 HOLD_EXPIRED, 503 PAYMENT_PROVIDER_UNAVAILABLE.',
  })
  @ApiZodResponse(200, payBookingResponseSchema, 'The payment to complete.')
  @ApiErrors(401, 404, 409, 503)
  pay(@CurrentUser() user: UserPrincipal, @UuidParam('bookingId') bookingId: string) {
    return this.bookings.pay(user.userId, bookingId);
  }

  @Get('bookings')
  @UseGuards(UserAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'My appointments: upcoming (soonest first) or past (latest first)' })
  @ApiZodQuery(bookingListQuerySchema)
  @ApiZodResponse(200, pageSchema(bookingSchema), 'A page of appointments.')
  @ApiErrors(400, 401)
  list(
    @CurrentUser() user: UserPrincipal,
    @ZodQuery(bookingListQuerySchema) query: BookingListQuery,
  ) {
    return this.bookings.listForUser(user.userId, query);
  }

  @Get('bookings/:bookingId')
  @UseGuards(UserAuthGuard)
  @ApiBearerAuth()
  @bookingParam
  @ApiOperation({ summary: 'One of my appointments (404 for anyone else)' })
  @ApiZodResponse(200, bookingSchema, 'The appointment.')
  @ApiErrors(401, 404)
  get(@CurrentUser() user: UserPrincipal, @UuidParam('bookingId') bookingId: string) {
    return this.bookings.getForUser(user.userId, bookingId);
  }

  @Post('bookings/:bookingId/cancel')
  @HttpCode(HttpStatus.OK)
  @UseGuards(UserAuthGuard)
  @ApiBearerAuth()
  @bookingParam
  @ApiOperation({
    summary: 'Cancel my appointment',
    description:
      'Full refund up to the cutoff in the policy shown at booking, then the late share; 422 CANCEL_TOO_LATE once it has started. cancelRefundFils on the booking shows the amount beforehand.',
  })
  @ApiZodBody(cancelBookingRequestSchema)
  @ApiZodResponse(200, bookingSchema, 'The canceled appointment.')
  @ApiErrors(400, 401, 404, 409, 422)
  cancel(
    @CurrentUser() user: UserPrincipal,
    @UuidParam('bookingId') bookingId: string,
    @ZodBody(cancelBookingRequestSchema) body: CancelBookingRequest,
    @Req() req: Request,
  ) {
    return this.bookings.cancelForUser(user.userId, bookingId, body, requestMeta(req));
  }

  @Post('bookings/:bookingId/reschedule')
  @HttpCode(HttpStatus.OK)
  @UseGuards(UserAuthGuard)
  @ApiBearerAuth()
  @bookingParam
  @ApiOperation({
    summary: 'Move my appointment to another time at the same branch',
    description:
      'Until the free-cancellation cutoff (422 RESCHEDULE_NOT_ALLOWED). Atomic: on 409 SLOT_UNAVAILABLE the original time is kept.',
  })
  @ApiZodBody(rescheduleRequestSchema)
  @ApiZodResponse(200, bookingSchema, 'The moved appointment.')
  @ApiErrors(400, 401, 404, 409, 422)
  reschedule(
    @CurrentUser() user: UserPrincipal,
    @UuidParam('bookingId') bookingId: string,
    @ZodBody(rescheduleRequestSchema) body: RescheduleRequest,
    @Req() req: Request,
  ) {
    return this.bookings.rescheduleForUser(user.userId, bookingId, body, requestMeta(req));
  }
}
