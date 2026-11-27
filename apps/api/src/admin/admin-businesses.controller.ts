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
  adminBusinessDetailSchema,
  adminBusinessListItemSchema,
  adminBusinessListQuerySchema,
  businessActionRequestSchema,
  pageSchema,
  signedUrlSchema,
  type AdminBusinessListQuery,
  type BusinessActionRequest,
} from '@jays/contracts';
import { ACTION_CAPABILITY, hasPlatformCapability } from '@jays/domain';
import type { Request } from 'express';
import { UuidParam } from '../common/params.js';
import { requestMeta } from '../common/request-context.js';
import { ApiError } from '../common/error.filter.js';
import {
  ApiErrors,
  ApiZodBody,
  ApiZodQuery,
  ApiZodResponse,
  ZodBody,
  ZodQuery,
} from '../common/zod.js';
import {
  AdminAuthGuard,
  type AdminPrincipal,
  CurrentAdmin,
  RequirePlatformCapability,
} from './admin.guard.js';
import { AdminBusinessesService } from './admin-businesses.service.js';

const businessParam = ApiParam({ name: 'businessId', format: 'uuid' });

@ApiTags('admin-businesses')
@ApiBearerAuth()
@UseGuards(AdminAuthGuard)
@Controller('admin/businesses')
export class AdminBusinessesController {
  constructor(
    @Inject(AdminBusinessesService) private readonly businesses: AdminBusinessesService,
  ) {}

  @Get()
  @RequirePlatformCapability('businesses.view')
  @ApiOperation({
    summary: 'Review queue and merchant list',
    description:
      '`status=pending` (default) lists everything waiting for a decision: submissions, reviews in progress, new modes and storefront changes. Oldest first.',
  })
  @ApiZodQuery(adminBusinessListQuerySchema)
  @ApiZodResponse(200, pageSchema(adminBusinessListItemSchema), 'A page of businesses.')
  @ApiErrors(400, 401, 403)
  list(@ZodQuery(adminBusinessListQuerySchema) query: AdminBusinessListQuery) {
    return this.businesses.list(query);
  }

  @Get(':businessId')
  @RequirePlatformCapability('businesses.view')
  @businessParam
  @ApiOperation({ summary: 'A business with legal profile, documents, storefront and history' })
  @ApiZodResponse(200, adminBusinessDetailSchema, 'Business detail.')
  @ApiErrors(401, 403, 404)
  detail(@UuidParam('businessId') businessId: string) {
    return this.businesses.detail(businessId);
  }

  @Get(':businessId/documents/:documentId/download')
  @RequirePlatformCapability('documents.view')
  @businessParam
  @ApiParam({ name: 'documentId', format: 'uuid' })
  @ApiOperation({
    summary: 'A five-minute link to a private document (superadmin, compliance; audited)',
  })
  @ApiZodResponse(200, signedUrlSchema, 'Signed download URL.')
  @ApiErrors(401, 403, 404)
  download(
    @CurrentAdmin() admin: AdminPrincipal,
    @UuidParam('businessId') businessId: string,
    @UuidParam('documentId') documentId: string,
    @Req() req: Request,
  ) {
    return this.businesses.documentDownload(
      admin.adminId,
      businessId,
      documentId,
      requestMeta(req),
    );
  }

  @Post(':businessId/actions')
  @HttpCode(HttpStatus.OK)
  @RequirePlatformCapability('businesses.view')
  @businessParam
  @ApiOperation({
    summary: 'Apply a review action with a version precondition',
    description:
      'Typed allowlist: start_review, approve, reject, approve_mode, reject_mode (businesses.review); suspend, reactivate (businesses.suspend); approve_storefront_changes, reject_storefront_changes (storefronts.review). Rejecting, suspending and reactivating need a reason. 409 VERSION_CONFLICT when expectedVersion is stale, 409 INVALID_TRANSITION when the status does not allow the action.',
  })
  @ApiZodBody(businessActionRequestSchema)
  @ApiZodResponse(200, adminBusinessDetailSchema, 'The business after the action.')
  @ApiErrors(400, 401, 403, 404, 409, 422)
  act(
    @CurrentAdmin() admin: AdminPrincipal,
    @UuidParam('businessId') businessId: string,
    @ZodBody(businessActionRequestSchema) body: BusinessActionRequest,
    @Req() req: Request,
  ) {
    if (!hasPlatformCapability(admin.roles, ACTION_CAPABILITY[body.action])) {
      throw new ApiError(
        HttpStatus.FORBIDDEN,
        'FORBIDDEN',
        'Your admin role does not allow this action.',
      );
    }
    return this.businesses.act(admin.adminId, businessId, body, requestMeta(req));
  }
}
