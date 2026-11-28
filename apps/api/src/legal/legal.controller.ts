import {
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Inject,
  Param,
  Patch,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiParam, ApiTags } from '@nestjs/swagger';
import {
  acceptLegalRequestSchema,
  acceptMerchantAgreementRequestSchema,
  adminLegalDocumentSchema,
  adminLegalListSchema,
  createLegalDraftRequestSchema,
  legalDocumentKindSchema,
  legalDocumentListSchema,
  legalDocumentSchema,
  merchantAgreementSchema,
  myLegalSchema,
  publishLegalRequestSchema,
  updateLegalDraftRequestSchema,
  type AcceptLegalRequest,
  type AcceptMerchantAgreementRequest,
  type CreateLegalDraftRequest,
  type PublishLegalRequest,
  type UpdateLegalDraftRequest,
} from '@jays/contracts';
import type { LegalDocumentKind } from '@jays/domain';
import type { Request } from 'express';
import {
  AdminAuthGuard,
  type AdminPrincipal,
  CurrentAdmin,
  RequirePlatformCapability,
} from '../admin/admin.guard.js';
import { CurrentUser, UserAuthGuard, type UserPrincipal } from '../auth/guards.js';
import {
  BusinessAccessGuard,
  type BusinessContext,
  CurrentBusiness,
  RequireBusinessCapability,
} from '../businesses/business-access.guard.js';
import { ApiError } from '../common/error.filter.js';
import { UuidParam } from '../common/params.js';
import { requestMeta } from '../common/request-context.js';
import { ApiErrors, ApiZodBody, ApiZodResponse, ZodBody } from '../common/zod.js';
import { LegalService } from './legal.service.js';

function kindOf(value: string): LegalDocumentKind {
  const parsed = legalDocumentKindSchema.safeParse(value);
  if (!parsed.success) {
    throw new ApiError(HttpStatus.NOT_FOUND, 'NOT_FOUND', 'That document does not exist.');
  }
  return parsed.data;
}

function versionOf(value: string): number {
  const n = Number(value);
  if (!Number.isSafeInteger(n) || n < 1) {
    throw new ApiError(HttpStatus.NOT_FOUND, 'NOT_FOUND', 'That document does not exist.');
  }
  return n;
}

const kindParam = ApiParam({ name: 'kind', example: 'customer_terms' });

/** Legal documents in force, and the customer's own acceptances (D13, ADR-0028). */
@ApiTags('legal')
@Controller()
export class LegalController {
  constructor(@Inject(LegalService) private readonly legal: LegalService) {}

  @Get('legal')
  @ApiOperation({
    summary: 'The legal documents in force (drafts awaiting legal review)',
    description: 'Every document says legalReview "pending": none has been reviewed by a lawyer.',
  })
  @ApiZodResponse(200, legalDocumentListSchema, 'Documents, without their text.')
  list() {
    return this.legal.list();
  }

  @Get('legal/:kind')
  @kindParam
  @ApiOperation({ summary: 'The version of a document in force, in English and Arabic' })
  @ApiZodResponse(200, legalDocumentSchema, 'The document.')
  @ApiErrors(404)
  current(@Param('kind') kind: string) {
    return this.legal.current(kindOf(kind));
  }

  @Get('legal/:kind/versions/:version')
  @kindParam
  @ApiParam({ name: 'version', example: 1 })
  @ApiOperation({ summary: 'A published or retired version, for the record' })
  @ApiZodResponse(200, legalDocumentSchema, 'The document.')
  @ApiErrors(404)
  version(@Param('kind') kind: string, @Param('version') version: string) {
    return this.legal.version(kindOf(kind), versionOf(version));
  }

  @Get('me/legal')
  @UseGuards(UserAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Which documents I accepted, and which new versions need accepting' })
  @ApiZodResponse(200, myLegalSchema, 'Acceptances.')
  @ApiErrors(401)
  mine(@CurrentUser() user: UserPrincipal) {
    return this.legal.mine(user.userId);
  }

  @Post('me/legal/accept')
  @HttpCode(HttpStatus.OK)
  @UseGuards(UserAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({
    summary: 'Accept the versions in force',
    description:
      'Each version must be the one in force (409 VERSION_NOT_CURRENT). Recorded with time, language and request id; never edited.',
  })
  @ApiZodBody(acceptLegalRequestSchema)
  @ApiZodResponse(200, myLegalSchema, 'Acceptances.')
  @ApiErrors(400, 401, 409, 422)
  accept(
    @CurrentUser() user: UserPrincipal,
    @ZodBody(acceptLegalRequestSchema) body: AcceptLegalRequest,
    @Req() req: Request,
  ) {
    return this.legal.accept(user.userId, body, requestMeta(req));
  }
}

/** The merchant agreement for one business (D13). The owner accepts it. */
@ApiTags('business-legal')
@ApiBearerAuth()
@UseGuards(UserAuthGuard, BusinessAccessGuard)
@Controller('businesses/:businessId/legal')
export class BusinessLegalController {
  constructor(@Inject(LegalService) private readonly legal: LegalService) {}

  @Get('merchant-agreement')
  @RequireBusinessCapability('business.view')
  @ApiParam({ name: 'businessId', format: 'uuid' })
  @ApiOperation({
    summary: 'The merchant agreement in force and whether this business accepted it',
  })
  @ApiZodResponse(200, merchantAgreementSchema, 'Status.')
  @ApiErrors(401, 403, 404)
  status(@CurrentBusiness() ctx: BusinessContext) {
    return this.legal.merchantAgreement(ctx);
  }

  @Post('merchant-agreement/accept')
  @HttpCode(HttpStatus.OK)
  @RequireBusinessCapability('onboarding.manage')
  @ApiParam({ name: 'businessId', format: 'uuid' })
  @ApiOperation({
    summary: 'Accept the merchant agreement in force for this business (owner)',
    description: '409 VERSION_NOT_CURRENT when the version is not the one in force.',
  })
  @ApiZodBody(acceptMerchantAgreementRequestSchema)
  @ApiZodResponse(200, merchantAgreementSchema, 'Status.')
  @ApiErrors(400, 401, 403, 404, 409)
  accept(
    @CurrentBusiness() ctx: BusinessContext,
    @CurrentUser() user: UserPrincipal,
    @ZodBody(acceptMerchantAgreementRequestSchema) body: AcceptMerchantAgreementRequest,
    @Req() req: Request,
  ) {
    return this.legal.acceptMerchantAgreement(ctx, user.userId, body.version, requestMeta(req));
  }
}

/** Drafts and versions (ADR-0028). Compliance admins and superadmins. */
@ApiTags('admin-legal')
@ApiBearerAuth()
@UseGuards(AdminAuthGuard)
@Controller('admin/legal')
export class AdminLegalController {
  constructor(@Inject(LegalService) private readonly legal: LegalService) {}

  @Get()
  @RequirePlatformCapability('legal.manage')
  @ApiOperation({ summary: 'Every version of every document, newest first' })
  @ApiZodResponse(200, adminLegalListSchema, 'Versions without their text.')
  @ApiErrors(401, 403)
  list() {
    return this.legal.adminList();
  }

  @Get(':id')
  @RequirePlatformCapability('legal.manage')
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiOperation({ summary: 'One version with its text and how many people accepted it' })
  @ApiZodResponse(200, adminLegalDocumentSchema, 'The version.')
  @ApiErrors(401, 403, 404)
  get(@UuidParam('id') id: string) {
    return this.legal.adminGet(id);
  }

  @Post()
  @RequirePlatformCapability('legal.manage')
  @ApiOperation({
    summary: 'Start a new draft version of a document',
    description: '409 DRAFT_EXISTS when the document already has an open draft.',
  })
  @ApiZodBody(createLegalDraftRequestSchema)
  @ApiZodResponse(201, adminLegalDocumentSchema, 'The draft.')
  @ApiErrors(400, 401, 403, 409)
  create(
    @CurrentAdmin() admin: AdminPrincipal,
    @ZodBody(createLegalDraftRequestSchema) body: CreateLegalDraftRequest,
    @Req() req: Request,
  ) {
    return this.legal.createDraft(admin.adminId, body, requestMeta(req));
  }

  @Patch(':id')
  @RequirePlatformCapability('legal.manage')
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiOperation({ summary: 'Edit a draft (published versions are frozen: 409 DOCUMENT_FROZEN)' })
  @ApiZodBody(updateLegalDraftRequestSchema)
  @ApiZodResponse(200, adminLegalDocumentSchema, 'The draft.')
  @ApiErrors(400, 401, 403, 404, 409)
  update(
    @CurrentAdmin() admin: AdminPrincipal,
    @UuidParam('id') id: string,
    @ZodBody(updateLegalDraftRequestSchema) body: UpdateLegalDraftRequest,
    @Req() req: Request,
  ) {
    return this.legal.updateDraft(admin.adminId, id, body, requestMeta(req));
  }

  @Post(':id/publish')
  @HttpCode(HttpStatus.OK)
  @RequirePlatformCapability('legal.manage')
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiOperation({
    summary: 'Put a draft in force and retire the previous version',
    description:
      'Refused in production (409 LEGAL_REVIEW_REQUIRED) until a UAE lawyer has reviewed the documents. Customers are asked to accept the new version.',
  })
  @ApiZodBody(publishLegalRequestSchema)
  @ApiZodResponse(200, adminLegalDocumentSchema, 'The published version.')
  @ApiErrors(400, 401, 403, 404, 409, 422)
  publish(
    @CurrentAdmin() admin: AdminPrincipal,
    @UuidParam('id') id: string,
    @ZodBody(publishLegalRequestSchema) body: PublishLegalRequest,
    @Req() req: Request,
  ) {
    return this.legal.publish(admin.adminId, id, body, requestMeta(req));
  }
}
