import { Controller, Get, Inject, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiParam, ApiTags } from '@nestjs/swagger';
import {
  earningListQuerySchema,
  earningSchema,
  financeSummarySchema,
  ledgerLineSchema,
  ledgerListQuerySchema,
  pageSchema,
  payoutListQuerySchema,
  payoutSchema,
  type EarningListQuery,
  type LedgerListQuery,
  type PayoutListQuery,
} from '@jays/contracts';
import { UserAuthGuard } from '../auth/guards.js';
import {
  BusinessAccessGuard,
  type BusinessContext,
  CurrentBusiness,
  RequireBusinessCapability,
} from '../businesses/business-access.guard.js';
import { ApiErrors, ApiZodQuery, ApiZodResponse, ZodQuery } from '../common/zod.js';
import { FinanceService } from './finance.service.js';
import { PayoutsService } from './payouts.service.js';

const businessParam = ApiParam({ name: 'businessId', format: 'uuid' });

/**
 * Read-only finance for a business (docs/03-business.md, /business/finance; ADR-0015): owner and
 * finance members. No business member can create, change or redirect payouts (T03).
 */
@ApiTags('business-finance')
@ApiBearerAuth()
@UseGuards(UserAuthGuard, BusinessAccessGuard)
@Controller('businesses/:businessId/finance')
export class BusinessFinanceController {
  constructor(
    @Inject(FinanceService) private readonly finance: FinanceService,
    @Inject(PayoutsService) private readonly payouts: PayoutsService,
  ) {}

  @Get('summary')
  @RequireBusinessCapability('finance.view')
  @businessParam
  @ApiOperation({ summary: 'Balances from the ledger: owed, in transit, pending, eligible, paid' })
  @ApiZodResponse(200, financeSummarySchema, 'Finance summary.')
  @ApiErrors(401, 403, 404)
  summary(@CurrentBusiness() ctx: BusinessContext) {
    return this.finance.summary(ctx.businessId);
  }

  @Get('earnings')
  @RequireBusinessCapability('finance.view')
  @businessParam
  @ApiOperation({ summary: 'What each paid suborder or booking earned, newest first' })
  @ApiZodQuery(earningListQuerySchema)
  @ApiZodResponse(200, pageSchema(earningSchema), 'A page of earnings.')
  @ApiErrors(400, 401, 403, 404)
  earnings(
    @CurrentBusiness() ctx: BusinessContext,
    @ZodQuery(earningListQuerySchema) query: EarningListQuery,
  ) {
    return this.finance.earnings(ctx.businessId, query);
  }

  @Get('ledger')
  @RequireBusinessCapability('finance.view')
  @businessParam
  @ApiOperation({ summary: 'Ledger lines on this business’s accounts, newest first' })
  @ApiZodQuery(ledgerListQuerySchema)
  @ApiZodResponse(200, pageSchema(ledgerLineSchema), 'A page of ledger lines.')
  @ApiErrors(400, 401, 403, 404)
  ledger(
    @CurrentBusiness() ctx: BusinessContext,
    @ZodQuery(ledgerListQuerySchema) query: LedgerListQuery,
  ) {
    return this.finance.ledger(ctx.businessId, query);
  }

  @Get('payouts')
  @RequireBusinessCapability('finance.view')
  @businessParam
  @ApiOperation({ summary: 'Payouts to this business, newest first' })
  @ApiZodQuery(payoutListQuerySchema)
  @ApiZodResponse(200, pageSchema(payoutSchema), 'A page of payouts.')
  @ApiErrors(400, 401, 403, 404)
  list(
    @CurrentBusiness() ctx: BusinessContext,
    @ZodQuery(payoutListQuerySchema) query: PayoutListQuery,
  ) {
    return this.payouts.list({ ...query, businessId: undefined }, ctx.businessId);
  }
}
