import {
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Inject,
  Patch,
  Post,
  Put,
  Req,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiParam, ApiTags } from '@nestjs/swagger';
import {
  blockInputSchema,
  blockListQuerySchema,
  blockSchema,
  bookingActionRequestSchema,
  branchInputSchema,
  branchSchema,
  closureInputSchema,
  closureSchema,
  manualBookingRequestSchema,
  merchantBookingListQuerySchema,
  merchantBookingSchema,
  pageSchema,
  putShiftsRequestSchema,
  serviceInputSchema,
  serviceSchema,
  staffInputSchema,
  staffSchema,
  updateBranchRequestSchema,
  updateServiceRequestSchema,
  updateStaffRequestSchema,
  type BlockInput,
  type BlockListQuery,
  type BookingActionRequest,
  type BranchInput,
  type ClosureInput,
  type ManualBookingRequest,
  type MerchantBookingListQuery,
  type PutShiftsRequest,
  type ServiceInput,
  type StaffInput,
  type UpdateBranchRequest,
  type UpdateServiceRequest,
  type UpdateStaffRequest,
} from '@jays/contracts';
import type { Request } from 'express';
import { z } from 'zod';
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
import { BookingsService } from './bookings.service.js';
import { ScheduleService } from './schedule.service.js';

const businessParam = ApiParam({ name: 'businessId', format: 'uuid' });
const idParam = (name: string) => ApiParam({ name, format: 'uuid' });
const conflict =
  '409 SCHEDULE_CONFLICT (fieldErrors.bookings lists the affected bookings) when an upcoming booking would no longer fit.';

/**
 * Branches, services, staff, shifts, blocks and the appointment calendar of one business
 * (docs/03-business.md, services sidebar). Business context comes from the caller's verified
 * membership (BusinessAccessGuard); every query is scoped to it.
 */
@ApiTags('business-services')
@ApiBearerAuth()
@UseGuards(UserAuthGuard, BusinessAccessGuard)
@Controller('businesses/:businessId')
export class BusinessScheduleController {
  constructor(
    @Inject(ScheduleService) private readonly schedule: ScheduleService,
    @Inject(BookingsService) private readonly bookings: BookingsService,
  ) {}

  private actor(ctx: BusinessContext, user: UserPrincipal, req: Request) {
    return { businessId: ctx.businessId, userId: user.userId, meta: requestMeta(req) };
  }

  // Branches -----------------------------------------------------------------------------------

  @Get('branches')
  @RequireBusinessCapability('business.view')
  @businessParam
  @ApiOperation({ summary: 'Branches with weekly opening hours (any member)' })
  @ApiZodResponse(200, z.array(branchSchema), 'Branches.')
  @ApiErrors(401, 403, 404)
  branches(@CurrentBusiness() ctx: BusinessContext) {
    return this.schedule.listBranches(ctx.businessId);
  }

  @Post('branches')
  @RequireBusinessCapability('services.manage')
  @businessParam
  @ApiOperation({
    summary: 'Create a branch (owner, manager)',
    description: 'Hours are local wall-clock times in the branch timezone (Asia/Dubai).',
  })
  @ApiZodBody(branchInputSchema)
  @ApiZodResponse(201, branchSchema, 'The branch.')
  @ApiErrors(400, 401, 403, 404)
  createBranch(
    @CurrentBusiness() ctx: BusinessContext,
    @CurrentUser() user: UserPrincipal,
    @ZodBody(branchInputSchema) body: BranchInput,
    @Req() req: Request,
  ) {
    return this.schedule.createBranch(this.actor(ctx, user, req), body);
  }

  @Get('branches/:branchId')
  @RequireBusinessCapability('business.view')
  @businessParam
  @idParam('branchId')
  @ApiOperation({ summary: 'A branch' })
  @ApiZodResponse(200, branchSchema, 'The branch.')
  @ApiErrors(401, 403, 404)
  branch(@CurrentBusiness() ctx: BusinessContext, @UuidParam('branchId') branchId: string) {
    return this.schedule.getBranch(ctx.businessId, branchId);
  }

  @Patch('branches/:branchId')
  @RequireBusinessCapability('services.manage')
  @businessParam
  @idParam('branchId')
  @ApiOperation({
    summary: 'Edit a branch, replace its hours or archive it (owner, manager)',
    description: conflict,
  })
  @ApiZodBody(updateBranchRequestSchema)
  @ApiZodResponse(200, branchSchema, 'The branch.')
  @ApiErrors(400, 401, 403, 404, 409)
  updateBranch(
    @CurrentBusiness() ctx: BusinessContext,
    @CurrentUser() user: UserPrincipal,
    @UuidParam('branchId') branchId: string,
    @ZodBody(updateBranchRequestSchema) body: UpdateBranchRequest,
    @Req() req: Request,
  ) {
    return this.schedule.updateBranch(this.actor(ctx, user, req), branchId, body);
  }

  @Get('branches/:branchId/closures')
  @RequireBusinessCapability('business.view')
  @businessParam
  @idParam('branchId')
  @ApiOperation({ summary: 'Upcoming one-off closures of a branch' })
  @ApiZodResponse(200, z.array(closureSchema), 'Closures.')
  @ApiErrors(401, 403, 404)
  closures(@CurrentBusiness() ctx: BusinessContext, @UuidParam('branchId') branchId: string) {
    return this.schedule.listClosures(ctx.businessId, branchId);
  }

  @Post('branches/:branchId/closures')
  @RequireBusinessCapability('services.manage')
  @businessParam
  @idParam('branchId')
  @ApiOperation({ summary: 'Close a branch for a period (owner, manager)', description: conflict })
  @ApiZodBody(closureInputSchema)
  @ApiZodResponse(201, closureSchema, 'The closure.')
  @ApiErrors(400, 401, 403, 404, 409)
  addClosure(
    @CurrentBusiness() ctx: BusinessContext,
    @CurrentUser() user: UserPrincipal,
    @UuidParam('branchId') branchId: string,
    @ZodBody(closureInputSchema) body: ClosureInput,
    @Req() req: Request,
  ) {
    return this.schedule.addClosure(this.actor(ctx, user, req), branchId, body);
  }

  @Delete('branches/:branchId/closures/:closureId')
  @HttpCode(HttpStatus.NO_CONTENT)
  @RequireBusinessCapability('services.manage')
  @businessParam
  @idParam('branchId')
  @idParam('closureId')
  @ApiOperation({ summary: 'Remove a closure (owner, manager)' })
  @ApiErrors(401, 403, 404)
  async removeClosure(
    @CurrentBusiness() ctx: BusinessContext,
    @CurrentUser() user: UserPrincipal,
    @UuidParam('branchId') branchId: string,
    @UuidParam('closureId') closureId: string,
    @Req() req: Request,
  ) {
    await this.schedule.removeClosure(this.actor(ctx, user, req), branchId, closureId);
  }

  // Services -----------------------------------------------------------------------------------

  @Get('services')
  @RequireBusinessCapability('business.view')
  @businessParam
  @ApiOperation({ summary: 'Services (not archived) with branch and staff assignments' })
  @ApiZodResponse(200, z.array(serviceSchema), 'Services.')
  @ApiErrors(401, 403, 404)
  services(@CurrentBusiness() ctx: BusinessContext) {
    return this.schedule.listServices(ctx.businessId);
  }

  @Post('services')
  @RequireBusinessCapability('services.manage')
  @businessParam
  @ApiOperation({
    summary: 'Create a service (owner, manager)',
    description:
      'Fixed VAT-inclusive price, duration and buffers on a 5-minute grid, and the cancellation policy bookings will snapshot. Bookable once a qualified staff member has a shift at one of its branches.',
  })
  @ApiZodBody(serviceInputSchema)
  @ApiZodResponse(201, serviceSchema, 'The service.')
  @ApiErrors(400, 401, 403, 404, 422)
  createService(
    @CurrentBusiness() ctx: BusinessContext,
    @CurrentUser() user: UserPrincipal,
    @ZodBody(serviceInputSchema) body: ServiceInput,
    @Req() req: Request,
  ) {
    return this.schedule.createService(this.actor(ctx, user, req), body);
  }

  @Get('services/:serviceId')
  @RequireBusinessCapability('business.view')
  @businessParam
  @idParam('serviceId')
  @ApiOperation({ summary: 'A service' })
  @ApiZodResponse(200, serviceSchema, 'The service.')
  @ApiErrors(401, 403, 404)
  service(@CurrentBusiness() ctx: BusinessContext, @UuidParam('serviceId') serviceId: string) {
    return this.schedule.getService(ctx.businessId, serviceId);
  }

  @Patch('services/:serviceId')
  @RequireBusinessCapability('services.manage')
  @businessParam
  @idParam('serviceId')
  @ApiOperation({
    summary: 'Edit or archive a service (owner, manager)',
    description:
      'Existing bookings keep their price, duration and policy. 409 SCHEDULE_CONFLICT when archiving or removing a branch with upcoming bookings; 409 SERVICE_SUSPENDED when reactivating a service the marketplace suspended.',
  })
  @ApiZodBody(updateServiceRequestSchema)
  @ApiZodResponse(200, serviceSchema, 'The service.')
  @ApiErrors(400, 401, 403, 404, 409, 422)
  updateService(
    @CurrentBusiness() ctx: BusinessContext,
    @CurrentUser() user: UserPrincipal,
    @UuidParam('serviceId') serviceId: string,
    @ZodBody(updateServiceRequestSchema) body: UpdateServiceRequest,
    @Req() req: Request,
  ) {
    return this.schedule.updateService(this.actor(ctx, user, req), serviceId, body);
  }

  // Staff --------------------------------------------------------------------------------------

  @Get('staff')
  @RequireBusinessCapability('business.view')
  @businessParam
  @ApiOperation({ summary: 'Active staff with branches, services and weekly shifts' })
  @ApiZodResponse(200, z.array(staffSchema), 'Staff.')
  @ApiErrors(401, 403, 404)
  staff(@CurrentBusiness() ctx: BusinessContext) {
    return this.schedule.listStaff(ctx.businessId);
  }

  @Post('staff')
  @RequireBusinessCapability('services.manage')
  @businessParam
  @ApiOperation({
    summary: 'Add a staff profile (owner, manager)',
    description:
      'Optionally linked to a member, who then sees their own appointments. 409 MEMBER_ALREADY_STAFF.',
  })
  @ApiZodBody(staffInputSchema)
  @ApiZodResponse(201, staffSchema, 'The staff profile.')
  @ApiErrors(400, 401, 403, 404, 409, 422)
  createStaff(
    @CurrentBusiness() ctx: BusinessContext,
    @CurrentUser() user: UserPrincipal,
    @ZodBody(staffInputSchema) body: StaffInput,
    @Req() req: Request,
  ) {
    return this.schedule.createStaff(this.actor(ctx, user, req), body);
  }

  @Get('staff/:staffId')
  @RequireBusinessCapability('business.view')
  @businessParam
  @idParam('staffId')
  @ApiOperation({ summary: 'A staff profile' })
  @ApiZodResponse(200, staffSchema, 'The staff profile.')
  @ApiErrors(401, 403, 404)
  oneStaff(@CurrentBusiness() ctx: BusinessContext, @UuidParam('staffId') staffId: string) {
    return this.schedule.getStaff(ctx.businessId, staffId);
  }

  @Patch('staff/:staffId')
  @RequireBusinessCapability('services.manage')
  @businessParam
  @idParam('staffId')
  @ApiOperation({
    summary: 'Edit, reassign or archive a staff profile (owner, manager)',
    description: `Removing a branch also removes the shifts there. ${conflict}`,
  })
  @ApiZodBody(updateStaffRequestSchema)
  @ApiZodResponse(200, staffSchema, 'The staff profile.')
  @ApiErrors(400, 401, 403, 404, 409, 422)
  updateStaff(
    @CurrentBusiness() ctx: BusinessContext,
    @CurrentUser() user: UserPrincipal,
    @UuidParam('staffId') staffId: string,
    @ZodBody(updateStaffRequestSchema) body: UpdateStaffRequest,
    @Req() req: Request,
  ) {
    return this.schedule.updateStaff(this.actor(ctx, user, req), staffId, body);
  }

  @Put('staff/:staffId/shifts')
  @RequireBusinessCapability('services.manage')
  @businessParam
  @idParam('staffId')
  @ApiOperation({
    summary: 'Replace weekly shifts (owner, manager)',
    description: `Local times at branches this person works at. ${conflict}`,
  })
  @ApiZodBody(putShiftsRequestSchema)
  @ApiZodResponse(200, staffSchema, 'The staff profile.')
  @ApiErrors(400, 401, 403, 404, 409, 422)
  putShifts(
    @CurrentBusiness() ctx: BusinessContext,
    @CurrentUser() user: UserPrincipal,
    @UuidParam('staffId') staffId: string,
    @ZodBody(putShiftsRequestSchema) body: PutShiftsRequest,
    @Req() req: Request,
  ) {
    return this.schedule.putShifts(this.actor(ctx, user, req), staffId, body);
  }

  // Blocks -------------------------------------------------------------------------------------

  @Get('blocks')
  @RequireBusinessCapability('bookings.schedule')
  @businessParam
  @ApiOperation({ summary: 'Upcoming breaks, leave and other blocks (owner, manager, scheduler)' })
  @ApiZodQuery(blockListQuerySchema)
  @ApiZodResponse(200, pageSchema(blockSchema), 'A page of blocks.')
  @ApiErrors(400, 401, 403, 404)
  blocks(
    @CurrentBusiness() ctx: BusinessContext,
    @ZodQuery(blockListQuerySchema) query: BlockListQuery,
  ) {
    return this.schedule.listBlocks(ctx.businessId, query);
  }

  @Post('blocks')
  @RequireBusinessCapability('bookings.schedule')
  @businessParam
  @ApiOperation({
    summary: 'Block time for a staff member (owner, manager, scheduler)',
    description: conflict,
  })
  @ApiZodBody(blockInputSchema)
  @ApiZodResponse(201, blockSchema, 'The block.')
  @ApiErrors(400, 401, 403, 404, 409)
  addBlock(
    @CurrentBusiness() ctx: BusinessContext,
    @CurrentUser() user: UserPrincipal,
    @ZodBody(blockInputSchema) body: BlockInput,
    @Req() req: Request,
  ) {
    return this.schedule.addBlock(this.actor(ctx, user, req), body);
  }

  @Delete('blocks/:blockId')
  @HttpCode(HttpStatus.NO_CONTENT)
  @RequireBusinessCapability('bookings.schedule')
  @businessParam
  @idParam('blockId')
  @ApiOperation({ summary: 'Remove a block (owner, manager, scheduler)' })
  @ApiErrors(401, 403, 404)
  async removeBlock(
    @CurrentBusiness() ctx: BusinessContext,
    @CurrentUser() user: UserPrincipal,
    @UuidParam('blockId') blockId: string,
    @Req() req: Request,
  ) {
    await this.schedule.removeBlock(this.actor(ctx, user, req), blockId);
  }

  // Calendar -----------------------------------------------------------------------------------

  @Get('bookings')
  @RequireBusinessCapability('business.view')
  @businessParam
  @ApiOperation({
    summary: 'Appointments by start time in a local date range (at most 31 days)',
    description:
      'Owners, managers and schedulers see every appointment; professionals see their own (appointments.view_own). Expired holds are left out unless asked for.',
  })
  @ApiZodQuery(merchantBookingListQuerySchema)
  @ApiZodResponse(200, pageSchema(merchantBookingSchema), 'A page of appointments.')
  @ApiErrors(400, 401, 403, 404)
  calendar(
    @CurrentBusiness() ctx: BusinessContext,
    @ZodQuery(merchantBookingListQuerySchema) query: MerchantBookingListQuery,
  ) {
    return this.bookings.listForBusiness(ctx, query);
  }

  @Post('bookings')
  @RequireBusinessCapability('bookings.schedule')
  @businessParam
  @ApiOperation({
    summary: 'Add a phone or walk-in appointment (owner, manager, scheduler)',
    description:
      'Confirmed at once and paid at the venue. Same availability rules as customers: 409 SLOT_UNAVAILABLE.',
  })
  @ApiZodBody(manualBookingRequestSchema)
  @ApiZodResponse(201, merchantBookingSchema, 'The appointment.')
  @ApiErrors(400, 401, 403, 404, 409, 422)
  manual(
    @CurrentBusiness() ctx: BusinessContext,
    @CurrentUser() user: UserPrincipal,
    @ZodBody(manualBookingRequestSchema) body: ManualBookingRequest,
    @Req() req: Request,
  ) {
    return this.bookings.createManual(ctx, user.userId, body, requestMeta(req));
  }

  @Get('bookings/:bookingId')
  @RequireBusinessCapability('business.view')
  @businessParam
  @idParam('bookingId')
  @ApiOperation({ summary: 'An appointment (professionals: only their own)' })
  @ApiZodResponse(200, merchantBookingSchema, 'The appointment.')
  @ApiErrors(401, 403, 404)
  booking(@CurrentBusiness() ctx: BusinessContext, @UuidParam('bookingId') bookingId: string) {
    return this.bookings.getForBusiness(ctx, bookingId);
  }

  @Post('bookings/:bookingId/actions')
  @HttpCode(HttpStatus.OK)
  @RequireBusinessCapability('bookings.schedule')
  @businessParam
  @idParam('bookingId')
  @ApiOperation({
    summary: 'Check in, complete, mark no-show or cancel (owner, manager, scheduler)',
    description:
      'check_in from an hour before the start; no_show 15 minutes after the start; cancel refunds a prepaid booking in full. 409 VERSION_CONFLICT or INVALID_TRANSITION, 422 TOO_EARLY.',
  })
  @ApiZodBody(bookingActionRequestSchema)
  @ApiZodResponse(200, merchantBookingSchema, 'The appointment after the action.')
  @ApiErrors(400, 401, 403, 404, 409, 422)
  act(
    @CurrentBusiness() ctx: BusinessContext,
    @CurrentUser() user: UserPrincipal,
    @UuidParam('bookingId') bookingId: string,
    @ZodBody(bookingActionRequestSchema) body: BookingActionRequest,
    @Req() req: Request,
  ) {
    return this.bookings.act(ctx, user.userId, bookingId, body, requestMeta(req));
  }
}
