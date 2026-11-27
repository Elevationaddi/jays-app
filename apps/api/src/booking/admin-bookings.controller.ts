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
  adminBookingListQuerySchema,
  adminBookingSchema,
  adminServiceActionRequestSchema,
  adminServiceListQuerySchema,
  adminServiceSchema,
  pageSchema,
  type AdminBookingListQuery,
  type AdminServiceActionRequest,
  type AdminServiceListQuery,
} from '@jays/contracts';
import type { Request } from 'express';
import {
  AdminAuthGuard,
  type AdminPrincipal,
  CurrentAdmin,
  RequirePlatformCapability,
} from '../admin/admin.guard.js';
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
import { AdminBookingsService } from './admin-bookings.service.js';

@ApiTags('admin-bookings')
@ApiBearerAuth()
@UseGuards(AdminAuthGuard)
@Controller('admin')
export class AdminBookingsController {
  constructor(@Inject(AdminBookingsService) private readonly admin: AdminBookingsService) {}

  @Get('bookings')
  @RequirePlatformCapability('bookings.view')
  @ApiOperation({ summary: 'Bookings across businesses, newest first (operations, support)' })
  @ApiZodQuery(adminBookingListQuerySchema)
  @ApiZodResponse(200, pageSchema(adminBookingSchema), 'A page of bookings.')
  @ApiErrors(400, 401, 403)
  bookings(@ZodQuery(adminBookingListQuerySchema) query: AdminBookingListQuery) {
    return this.admin.listBookings(query);
  }

  @Get('services')
  @RequirePlatformCapability('services.takedown')
  @ApiOperation({ summary: 'Services across businesses, newest first' })
  @ApiZodQuery(adminServiceListQuerySchema)
  @ApiZodResponse(200, pageSchema(adminServiceSchema), 'A page of services.')
  @ApiErrors(400, 401, 403)
  services(@ZodQuery(adminServiceListQuerySchema) query: AdminServiceListQuery) {
    return this.admin.listServices(query);
  }

  @Post('services/:serviceId/actions')
  @HttpCode(HttpStatus.OK)
  @RequirePlatformCapability('services.takedown')
  @ApiParam({ name: 'serviceId', format: 'uuid' })
  @ApiOperation({
    summary: 'Suspend or reinstate a service (catalog, compliance, operations)',
    description:
      'A suspended service is hidden and cannot be booked; existing bookings stay. 409 VERSION_CONFLICT or INVALID_TRANSITION.',
  })
  @ApiZodBody(adminServiceActionRequestSchema)
  @ApiZodResponse(200, adminServiceSchema, 'The service after the action.')
  @ApiErrors(400, 401, 403, 404, 409)
  act(
    @CurrentAdmin() admin: AdminPrincipal,
    @UuidParam('serviceId') serviceId: string,
    @ZodBody(adminServiceActionRequestSchema) body: AdminServiceActionRequest,
    @Req() req: Request,
  ) {
    return this.admin.actOnService(admin.adminId, serviceId, body, requestMeta(req));
  }
}
