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
  acceptAgreementRequestSchema,
  createDocumentUploadRequestSchema,
  createMediaUploadRequestSchema,
  documentSchema,
  mediaSchema,
  onboardingSchema,
  signedUrlSchema,
  storefrontSchema,
  updateOnboardingRequestSchema,
  updateStorefrontRequestSchema,
  uploadTicketSchema,
  type UpdateOnboardingRequest,
  type UpdateStorefrontRequest,
} from '@jays/contracts';
import type { Request } from 'express';
import { z } from 'zod';
import { CurrentUser, UserAuthGuard, type UserPrincipal } from '../auth/guards.js';
import { UuidParam } from '../common/params.js';
import { requestMeta } from '../common/request-context.js';
import { ApiErrors, ApiZodBody, ApiZodResponse, ZodBody } from '../common/zod.js';
import {
  BusinessAccessGuard,
  type BusinessContext,
  CurrentBusiness,
  RequireBusinessCapability,
} from '../businesses/business-access.guard.js';
import { OnboardingService } from './onboarding.service.js';

const businessParam = ApiParam({ name: 'businessId', format: 'uuid' });

@ApiTags('onboarding')
@ApiBearerAuth()
@UseGuards(UserAuthGuard, BusinessAccessGuard)
@Controller('businesses/:businessId')
export class OnboardingController {
  constructor(@Inject(OnboardingService) private readonly onboarding: OnboardingService) {}

  @Get('onboarding')
  @RequireBusinessCapability('onboarding.manage')
  @businessParam
  @ApiOperation({
    summary: 'Onboarding: legal profile, documents, storefront, modes and checklist (owner)',
  })
  @ApiZodResponse(200, onboardingSchema, 'Onboarding state.')
  @ApiErrors(401, 403, 404)
  view(@CurrentBusiness() ctx: BusinessContext) {
    return this.onboarding.view(ctx.businessId);
  }

  @Patch('onboarding')
  @RequireBusinessCapability('onboarding.manage')
  @businessParam
  @ApiOperation({
    summary: 'Update the legal profile, address and tax registration (owner)',
    description:
      'Only while the business is a draft or was rejected; 409 during review and after approval.',
  })
  @ApiZodBody(updateOnboardingRequestSchema)
  @ApiZodResponse(200, onboardingSchema, 'Updated onboarding state.')
  @ApiErrors(400, 401, 403, 404, 409)
  update(
    @CurrentBusiness() ctx: BusinessContext,
    @CurrentUser() user: UserPrincipal,
    @ZodBody(updateOnboardingRequestSchema) body: UpdateOnboardingRequest,
    @Req() req: Request,
  ) {
    return this.onboarding.update(ctx, user.userId, body, requestMeta(req));
  }

  @Post('agreement')
  @HttpCode(HttpStatus.OK)
  @RequireBusinessCapability('onboarding.manage')
  @businessParam
  @ApiOperation({ summary: 'Accept the current merchant agreement version (owner)' })
  @ApiZodBody(acceptAgreementRequestSchema)
  @ApiZodResponse(200, onboardingSchema, 'Accepted.')
  @ApiErrors(400, 401, 403, 404, 409)
  acceptAgreement(
    @CurrentBusiness() ctx: BusinessContext,
    @CurrentUser() user: UserPrincipal,
    @ZodBody(acceptAgreementRequestSchema) body: z.infer<typeof acceptAgreementRequestSchema>,
    @Req() req: Request,
  ) {
    return this.onboarding.acceptAgreement(ctx, user.userId, body.version, requestMeta(req));
  }

  @Post('submit')
  @HttpCode(HttpStatus.OK)
  @RequireBusinessCapability('onboarding.manage')
  @businessParam
  @ApiOperation({
    summary: 'Submit for review, or resubmit after a rejection (owner)',
    description:
      'A draft or rejected business goes to `submitted` with its modes. An approved business can submit a newly activated or rejected mode on its own. 422 ONBOARDING_INCOMPLETE lists missing checklist items in fieldErrors.checklist.',
  })
  @ApiZodResponse(200, onboardingSchema, 'Submitted.')
  @ApiErrors(401, 403, 404, 409, 422)
  submit(
    @CurrentBusiness() ctx: BusinessContext,
    @CurrentUser() user: UserPrincipal,
    @Req() req: Request,
  ) {
    return this.onboarding.submit(ctx, user.userId, requestMeta(req));
  }

  @Post('documents')
  @RequireBusinessCapability('onboarding.manage')
  @businessParam
  @ApiOperation({
    summary: 'Start a private document upload; returns a signed PUT URL (owner)',
    description:
      'PUT the file to uploadUrl with the given headers before expiresAt, then call complete. PDF, JPEG or PNG, up to 10 MB. Refused with 403 DOCUMENT_UPLOADS_DISABLED where uploads are switched off (private staging).',
  })
  @ApiZodBody(createDocumentUploadRequestSchema)
  @ApiZodResponse(201, uploadTicketSchema, 'Upload ticket.')
  @ApiErrors(400, 401, 403, 404, 409, 429)
  createDocument(
    @CurrentBusiness() ctx: BusinessContext,
    @CurrentUser() user: UserPrincipal,
    @ZodBody(createDocumentUploadRequestSchema)
    body: z.infer<typeof createDocumentUploadRequestSchema>,
    @Req() req: Request,
  ) {
    return this.onboarding.createDocumentUpload(ctx, user.userId, body, requestMeta(req));
  }

  @Post('documents/:documentId/complete')
  @HttpCode(HttpStatus.OK)
  @RequireBusinessCapability('onboarding.manage')
  @businessParam
  @ApiParam({ name: 'documentId', format: 'uuid' })
  @ApiOperation({
    summary: 'Check an uploaded document: size, real file type and malware scan (owner)',
    description:
      '422 FILE_TYPE_MISMATCH, FILE_TOO_LARGE, FILE_EMPTY or FILE_INFECTED when refused; the file is then deleted.',
  })
  @ApiZodResponse(200, documentSchema, 'The document, now clean.')
  @ApiErrors(401, 403, 404, 409, 422)
  completeDocument(
    @CurrentBusiness() ctx: BusinessContext,
    @CurrentUser() user: UserPrincipal,
    @UuidParam('documentId') documentId: string,
    @Req() req: Request,
  ) {
    return this.onboarding.completeDocument(ctx, user.userId, documentId, requestMeta(req));
  }

  @Get('documents/:documentId/download')
  @RequireBusinessCapability('onboarding.manage')
  @businessParam
  @ApiParam({ name: 'documentId', format: 'uuid' })
  @ApiOperation({ summary: 'A five-minute download link for a private document (owner, audited)' })
  @ApiZodResponse(200, signedUrlSchema, 'Signed download URL.')
  @ApiErrors(401, 403, 404)
  downloadDocument(
    @CurrentBusiness() ctx: BusinessContext,
    @CurrentUser() user: UserPrincipal,
    @UuidParam('documentId') documentId: string,
    @Req() req: Request,
  ) {
    return this.onboarding.documentDownload(ctx, user.userId, documentId, requestMeta(req));
  }

  @Delete('documents/:documentId')
  @HttpCode(HttpStatus.NO_CONTENT)
  @RequireBusinessCapability('onboarding.manage')
  @businessParam
  @ApiParam({ name: 'documentId', format: 'uuid' })
  @ApiOperation({ summary: 'Remove a document while the business is a draft or rejected (owner)' })
  @ApiZodResponse(204, z.null(), 'Removed.')
  @ApiErrors(401, 403, 404, 409)
  async archiveDocument(
    @CurrentBusiness() ctx: BusinessContext,
    @CurrentUser() user: UserPrincipal,
    @UuidParam('documentId') documentId: string,
    @Req() req: Request,
  ) {
    await this.onboarding.archiveDocument(ctx, user.userId, documentId, requestMeta(req));
  }

  @Get('storefront')
  @RequireBusinessCapability('storefront.manage')
  @businessParam
  @ApiOperation({ summary: 'Storefront draft and live version (owner, manager)' })
  @ApiZodResponse(200, storefrontSchema, 'Storefront.')
  @ApiErrors(401, 403, 404)
  storefront(@CurrentBusiness() ctx: BusinessContext) {
    return this.onboarding.storefront(ctx.businessId);
  }

  @Patch('storefront')
  @RequireBusinessCapability('storefront.manage')
  @businessParam
  @ApiOperation({
    summary: 'Edit the storefront (owner, manager)',
    description:
      'Before approval this edits the draft. After approval the edit waits for admin review and the live version stays public. 409 IN_REVIEW while the business is being reviewed.',
  })
  @ApiZodBody(updateStorefrontRequestSchema)
  @ApiZodResponse(200, storefrontSchema, 'Storefront.')
  @ApiErrors(400, 401, 403, 404, 409)
  updateStorefront(
    @CurrentBusiness() ctx: BusinessContext,
    @CurrentUser() user: UserPrincipal,
    @ZodBody(updateStorefrontRequestSchema) body: UpdateStorefrontRequest,
    @Req() req: Request,
  ) {
    return this.onboarding.updateStorefront(ctx, user.userId, body, requestMeta(req));
  }

  @Post('media')
  @RequireBusinessCapability('storefront.manage')
  @businessParam
  @ApiOperation({
    summary: 'Start an image upload; returns a signed PUT URL (owner, manager)',
    description:
      'JPEG, PNG or WebP up to 5 MB. Logo: at least 200×200, roughly square. Banner: at least 1200×300, 2:1 to 5:1.',
  })
  @ApiZodBody(createMediaUploadRequestSchema)
  @ApiZodResponse(201, uploadTicketSchema, 'Upload ticket.')
  @ApiErrors(400, 401, 403, 404, 429)
  createMedia(
    @CurrentBusiness() ctx: BusinessContext,
    @CurrentUser() user: UserPrincipal,
    @ZodBody(createMediaUploadRequestSchema) body: z.infer<typeof createMediaUploadRequestSchema>,
  ) {
    return this.onboarding.createMediaUpload(ctx, user.userId, body);
  }

  @Post('media/:mediaId/complete')
  @HttpCode(HttpStatus.OK)
  @RequireBusinessCapability('storefront.manage')
  @businessParam
  @ApiParam({ name: 'mediaId', format: 'uuid' })
  @ApiOperation({
    summary: 'Check an uploaded image: type, size, dimensions, malware (owner, manager)',
  })
  @ApiZodResponse(200, mediaSchema, 'The image, now ready.')
  @ApiErrors(401, 403, 404, 409, 422)
  completeMedia(
    @CurrentBusiness() ctx: BusinessContext,
    @CurrentUser() user: UserPrincipal,
    @UuidParam('mediaId') mediaId: string,
    @Req() req: Request,
  ) {
    return this.onboarding.completeMedia(ctx, user.userId, mediaId, requestMeta(req));
  }
}
