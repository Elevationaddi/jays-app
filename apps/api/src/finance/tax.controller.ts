import { Controller, Get, Inject, Put, Req, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiParam, ApiTags } from '@nestjs/swagger';
import {
  adminTaxDocumentListQuerySchema,
  businessTaxInputSchema,
  businessTaxSchema,
  pageSchema,
  taxDocumentListQuerySchema,
  taxDocumentSchema,
  taxDocumentSummarySchema,
  vatReportQuerySchema,
  vatReportSchema,
  type AdminTaxDocumentListQuery,
  type BusinessTaxInput,
  type TaxDocumentListQuery,
  type VatReportQuery,
} from '@jays/contracts';
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
import { TaxService } from './tax.service.js';

const idParam = (name: string) => ApiParam({ name, format: 'uuid' });

/** The customer's invoices and credit notes from sellers (D3: the seller issues them). */
@ApiTags('documents')
@ApiBearerAuth()
@UseGuards(UserAuthGuard)
@Controller('me/documents')
export class CustomerDocumentsController {
  constructor(@Inject(TaxService) private readonly tax: TaxService) {}

  @Get()
  @ApiOperation({ summary: 'My invoices and credit notes, newest first' })
  @ApiZodQuery(taxDocumentListQuerySchema)
  @ApiZodResponse(200, pageSchema(taxDocumentSummarySchema), 'A page of documents.')
  @ApiErrors(400, 401)
  list(
    @CurrentUser() user: UserPrincipal,
    @ZodQuery(taxDocumentListQuerySchema) query: TaxDocumentListQuery,
  ) {
    return this.tax.list({ kind: 'customer', userId: user.userId }, query);
  }

  @Get(':documentId')
  @idParam('documentId')
  @ApiOperation({ summary: 'One invoice or credit note' })
  @ApiZodResponse(200, taxDocumentSchema, 'The document.')
  @ApiErrors(401, 404)
  get(@CurrentUser() user: UserPrincipal, @UuidParam('documentId') id: string) {
    return this.tax.get({ kind: 'customer', userId: user.userId }, id);
  }
}

/** A business's invoices to customers and JAYS's commission invoices to it. */
@ApiTags('business-finance')
@ApiBearerAuth()
@UseGuards(UserAuthGuard, BusinessAccessGuard)
@Controller('businesses/:businessId/finance/documents')
export class BusinessDocumentsController {
  constructor(@Inject(TaxService) private readonly tax: TaxService) {}

  @Get()
  @RequireBusinessCapability('finance.view')
  @idParam('businessId')
  @ApiOperation({ summary: 'Invoices, commission invoices and credit notes, newest first' })
  @ApiZodQuery(taxDocumentListQuerySchema)
  @ApiZodResponse(200, pageSchema(taxDocumentSummarySchema), 'A page of documents.')
  @ApiErrors(400, 401, 403, 404)
  list(
    @CurrentBusiness() ctx: BusinessContext,
    @ZodQuery(taxDocumentListQuerySchema) query: TaxDocumentListQuery,
  ) {
    return this.tax.list({ kind: 'business', businessId: ctx.businessId }, query);
  }

  @Get(':documentId')
  @RequireBusinessCapability('finance.view')
  @idParam('businessId')
  @idParam('documentId')
  @ApiOperation({ summary: 'One document' })
  @ApiZodResponse(200, taxDocumentSchema, 'The document.')
  @ApiErrors(401, 403, 404)
  get(@CurrentBusiness() ctx: BusinessContext, @UuidParam('documentId') id: string) {
    return this.tax.get({ kind: 'business', businessId: ctx.businessId }, id);
  }
}

/** Admin: every document, sellers' VAT registration and the VAT report (`finance.view`/`manage`). */
@ApiTags('admin-finance')
@ApiBearerAuth()
@UseGuards(AdminAuthGuard)
@Controller('admin/finance')
export class AdminTaxController {
  constructor(@Inject(TaxService) private readonly tax: TaxService) {}

  @Get('documents')
  @RequirePlatformCapability('finance.view')
  @ApiOperation({ summary: 'Tax documents, newest first' })
  @ApiZodQuery(adminTaxDocumentListQuerySchema)
  @ApiZodResponse(200, pageSchema(taxDocumentSummarySchema), 'A page of documents.')
  @ApiErrors(400, 401, 403)
  list(@ZodQuery(adminTaxDocumentListQuerySchema) query: AdminTaxDocumentListQuery) {
    return this.tax.list({ kind: 'admin', businessId: query.businessId }, query);
  }

  @Get('documents/:documentId')
  @RequirePlatformCapability('finance.view')
  @idParam('documentId')
  @ApiOperation({ summary: 'One tax document' })
  @ApiZodResponse(200, taxDocumentSchema, 'The document.')
  @ApiErrors(401, 403, 404)
  get(@UuidParam('documentId') id: string) {
    return this.tax.get({ kind: 'admin' }, id);
  }

  @Get('vat-report')
  @RequirePlatformCapability('finance.view')
  @ApiOperation({
    summary: 'VAT totals for a period: the platform on commission, each seller on sales',
    description: 'Figures are drafts until a UAE tax professional approves the tax rules.',
  })
  @ApiZodQuery(vatReportQuerySchema)
  @ApiZodResponse(200, vatReportSchema, 'The report.')
  @ApiErrors(400, 401, 403)
  vatReport(@ZodQuery(vatReportQuerySchema) query: VatReportQuery) {
    return this.tax.vatReport(query);
  }

  @Get('businesses/:businessId/tax')
  @RequirePlatformCapability('finance.view')
  @idParam('businessId')
  @ApiOperation({ summary: 'A seller’s VAT registration and TRN' })
  @ApiZodResponse(200, businessTaxSchema, 'VAT registration.')
  @ApiErrors(401, 403, 404)
  businessTax(@UuidParam('businessId') id: string) {
    return this.tax.businessTax(id);
  }

  @Put('businesses/:businessId/tax')
  @RequirePlatformCapability('finance.manage')
  @idParam('businessId')
  @ApiOperation({
    summary: 'Record a seller’s VAT registration (audited; applies to sales from now on)',
  })
  @ApiZodBody(businessTaxInputSchema)
  @ApiZodResponse(200, businessTaxSchema, 'VAT registration.')
  @ApiErrors(400, 401, 403, 404)
  setBusinessTax(
    @CurrentAdmin() admin: AdminPrincipal,
    @UuidParam('businessId') id: string,
    @ZodBody(businessTaxInputSchema) body: BusinessTaxInput,
    @Req() req: Request,
  ) {
    return this.tax.setBusinessTax(admin.adminId, id, body, requestMeta(req));
  }
}
