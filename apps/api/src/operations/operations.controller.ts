import { Controller, Get, HttpStatus, Inject, Param, Patch, Req, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiParam, ApiTags } from '@nestjs/swagger';
import {
  adminEmirateListSchema,
  emirateCodeSchema,
  updateEmirateRequestSchema,
} from '@jays/contracts';
import type { Request } from 'express';
import type { z } from 'zod';
import {
  AdminAuthGuard,
  type AdminPrincipal,
  CurrentAdmin,
  RequirePlatformCapability,
} from '../admin/admin.guard.js';
import { ApiError } from '../common/error.filter.js';
import { requestMeta } from '../common/request-context.js';
import { ApiErrors, ApiZodBody, ApiZodResponse, ZodBody } from '../common/zod.js';
import { OperationsService } from './operations.service.js';

/** Operations by emirate (D11). Operations admins and superadmins. */
@ApiTags('admin-operations')
@ApiBearerAuth()
@UseGuards(AdminAuthGuard)
@Controller('admin/operations')
export class AdminOperationsController {
  constructor(@Inject(OperationsService) private readonly ops: OperationsService) {}

  @Get('emirates')
  @RequirePlatformCapability('operations.manage')
  @ApiOperation({ summary: 'Emirates with whether the marketplace operates there' })
  @ApiZodResponse(200, adminEmirateListSchema, 'Emirates.')
  @ApiErrors(401, 403)
  emirates() {
    return this.ops.emirates();
  }

  @Patch('emirates/:code')
  @RequirePlatformCapability('operations.manage')
  @ApiParam({ name: 'code', example: 'AUH' })
  @ApiOperation({
    summary: 'Switch operations in an emirate on or off (new addresses, delivery and bookings)',
  })
  @ApiZodBody(updateEmirateRequestSchema)
  @ApiZodResponse(200, adminEmirateListSchema, 'Emirates.')
  @ApiErrors(400, 401, 403, 404)
  setEmirate(
    @CurrentAdmin() admin: AdminPrincipal,
    @Param('code') code: string,
    @ZodBody(updateEmirateRequestSchema) body: z.infer<typeof updateEmirateRequestSchema>,
    @Req() req: Request,
  ) {
    const parsed = emirateCodeSchema.safeParse(code);
    if (!parsed.success) {
      throw new ApiError(HttpStatus.BAD_REQUEST, 'VALIDATION_FAILED', 'The request is not valid.', {
        code: ['unknown emirate'],
      });
    }
    return this.ops.setEmirate(admin.adminId, parsed.data, body.enabled, requestMeta(req));
  }
}
