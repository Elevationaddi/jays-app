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
  earningListQuerySchema,
  earningSchema,
  financeSummarySchema,
  ledgerLineSchema,
  ledgerListQuerySchema,
  pageSchema,
  payoutAccountSchema,
  payoutOnboardingLinkSchema,
  payoutListQuerySchema,
  payoutSchema,
  type EarningListQuery,
  type LedgerListQuery,
  type PayoutListQuery,
} from '@jays/contracts';
import type { Request } from 'express';
import { CurrentUser, UserAuthGuard, type UserPrincipal } from '../auth/guards.js';
import {
  BusinessAccessGuard,
  type BusinessContext,
  CurrentBusiness,
  RequireBusinessCapability,
} from '../businesses/business-access.guard.js';
import { requestMeta } from '../common/request-context.js';
import { ApiErrors, ApiZodQuery, ApiZodResponse, ZodQuery } from '../common/zod.js';
import { FinanceService } from './finance.service.js';
import { PayoutAccountsService } from './payout-accounts.js';
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
    @Inject(PayoutAccountsService) private readonly accounts: PayoutAccountsService,
  ) {}

  @Get('payout-account')
  @RequireBusinessCapability('finance.view')
  @businessParam
  @ApiOperation({ summary: 'The connected payout account at the payment provider (ADR-0030)' })
  @ApiZodResponse(200, payoutAccountSchema, 'Payout account status.')
  @ApiErrors(401, 403, 404)
  payoutAccount(@CurrentBusiness() ctx: BusinessContext) {
    return this.accounts.status(ctx.businessId);
  }

  @Post('payout-account/onboarding-link')
  @HttpCode(HttpStatus.OK)
  @RequireBusinessCapability('onboarding.manage')
  @businessParam
  @ApiOperation({
    summary: 'Owner: open the provider’s hosted onboarding for payouts',
    description:
      'Creates the connected account on first use. The provider collects identity and bank details; JAYS never sees them. 409 BUSINESS_NOT_APPROVED, 503 PAYMENT_PROVIDER_UNAVAILABLE.',
  })
  @ApiZodResponse(200, payoutOnboardingLinkSchema, 'A short-lived onboarding link.')
  @ApiErrors(401, 403, 404, 409, 503)
  onboardingLink(
    @CurrentBusiness() ctx: BusinessContext,
    @CurrentUser() user: UserPrincipal,
    @Req() req: Request,
  ) {
    return this.accounts.onboardingLink(user.userId, ctx.businessId, requestMeta(req));
  }

  @Post('payout-account/refresh')
  @HttpCode(HttpStatus.OK)
  @RequireBusinessCapability('finance.view')
  @businessParam
  @ApiOperation({
    summary: 'Read the payout account’s status from the provider again',
    description: '503 PAYMENT_PROVIDER_UNAVAILABLE.',
  })
  @ApiZodResponse(200, payoutAccountSchema, 'Payout account status.')
  @ApiErrors(401, 403, 404, 503)
  refreshPayoutAccount(@CurrentBusiness() ctx: BusinessContext) {
    return this.accounts.refresh(ctx.businessId);
  }

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
