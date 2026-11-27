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
  adminEarningListQuerySchema,
  adminEarningSchema,
  adminPaymentListQuerySchema,
  adminPaymentSchema,
  disputeInputSchema,
  disputeListQuerySchema,
  disputeResolutionSchema,
  disputeSchema,
  feeRuleInputSchema,
  feeRuleSchema,
  financeOverviewSchema,
  financeSettingInputSchema,
  financeSettingSchema,
  pageSchema,
  payoutHoldInputSchema,
  payoutHoldSchema,
  payoutListQuerySchema,
  payoutRunResultSchema,
  payoutSchema,
  reconciliationListQuerySchema,
  reconciliationResolveSchema,
  reconciliationRunRequestSchema,
  reconciliationRunSchema,
  refundDecisionSchema,
  refundRequestInputSchema,
  refundRequestListQuerySchema,
  refundRequestSchema,
  type AdminEarningListQuery,
  type AdminPaymentListQuery,
  type DisputeInput,
  type DisputeListQuery,
  type DisputeResolution,
  type FeeRuleInput,
  type FinanceSettingInput,
  type PayoutHoldInput,
  type PayoutListQuery,
  type ReconciliationListQuery,
  type ReconciliationResolve,
  type ReconciliationRunRequest,
  type RefundDecision,
  type RefundRequestInput,
  type RefundRequestListQuery,
} from '@jays/contracts';
import type { Request } from 'express';
import { z } from 'zod';
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
import { AdminFinanceService } from './admin-finance.service.js';
import { PayoutsService } from './payouts.service.js';
import { ReconciliationService } from './reconciliation.service.js';

const idParam = (name: string) => ApiParam({ name, format: 'uuid' });

/**
 * Platform finance (docs/04-admin.md, /admin/finance; ADR-0015). Viewing needs `finance.view`;
 * refunds need `finance.refund` (support and finance), with a second admin above the threshold;
 * rules, settings, holds, disputes, payout runs and reconciliation need `finance.manage`.
 */
@ApiTags('admin-finance')
@ApiBearerAuth()
@UseGuards(AdminAuthGuard)
@Controller('admin/finance')
export class AdminFinanceController {
  constructor(
    @Inject(AdminFinanceService) private readonly finance: AdminFinanceService,
    @Inject(PayoutsService) private readonly payouts: PayoutsService,
    @Inject(ReconciliationService) private readonly recon: ReconciliationService,
  ) {}

  @Get('overview')
  @RequirePlatformCapability('finance.view')
  @ApiOperation({ summary: 'Ledger balances, open work and the rules and settings in force' })
  @ApiZodResponse(200, financeOverviewSchema, 'Overview.')
  @ApiErrors(401, 403)
  overview() {
    return this.finance.overview();
  }

  @Post('fee-rules')
  @RequirePlatformCapability('finance.manage')
  @ApiOperation({
    summary: 'Add a commission rule (new version; history is never edited)',
    description: '422 EFFECTIVE_IN_PAST; 409 RULE_EXISTS for the same mode, business and time.',
  })
  @ApiZodBody(feeRuleInputSchema)
  @ApiZodResponse(201, z.array(feeRuleSchema), 'All rules, newest first.')
  @ApiErrors(400, 401, 403, 404, 409, 422)
  createFeeRule(
    @CurrentAdmin() admin: AdminPrincipal,
    @ZodBody(feeRuleInputSchema) body: FeeRuleInput,
    @Req() req: Request,
  ) {
    return this.finance.createFeeRule(admin.adminId, body, requestMeta(req));
  }

  @Post('settings')
  @RequirePlatformCapability('finance.manage')
  @ApiOperation({ summary: 'Change a finance setting from a time onwards (versioned)' })
  @ApiZodBody(financeSettingInputSchema)
  @ApiZodResponse(201, z.array(financeSettingSchema), 'Settings in force.')
  @ApiErrors(400, 401, 403, 409, 422)
  createSetting(
    @CurrentAdmin() admin: AdminPrincipal,
    @ZodBody(financeSettingInputSchema) body: FinanceSettingInput,
    @Req() req: Request,
  ) {
    return this.finance.createSetting(admin.adminId, body, requestMeta(req));
  }

  @Get('payments')
  @RequirePlatformCapability('finance.view')
  @ApiOperation({ summary: 'Payments with refunds per seller, newest first' })
  @ApiZodQuery(adminPaymentListQuerySchema)
  @ApiZodResponse(200, pageSchema(adminPaymentSchema), 'A page of payments.')
  @ApiErrors(400, 401, 403)
  payments(@ZodQuery(adminPaymentListQuerySchema) query: AdminPaymentListQuery) {
    return this.finance.listPayments(query);
  }

  @Get('payments/:paymentId')
  @RequirePlatformCapability('finance.view')
  @idParam('paymentId')
  @ApiOperation({ summary: 'One payment with what can still be refunded per seller' })
  @ApiZodResponse(200, adminPaymentSchema, 'The payment.')
  @ApiErrors(401, 403, 404)
  payment(@UuidParam('paymentId') id: string) {
    return this.finance.payment(id);
  }

  @Get('refund-requests')
  @RequirePlatformCapability('finance.view')
  @ApiOperation({ summary: 'Refund requests, newest first' })
  @ApiZodQuery(refundRequestListQuerySchema)
  @ApiZodResponse(200, pageSchema(refundRequestSchema), 'A page of refund requests.')
  @ApiErrors(400, 401, 403)
  refundRequests(@ZodQuery(refundRequestListQuerySchema) query: RefundRequestListQuery) {
    return this.finance.listRefundRequests(query);
  }

  @Post('refund-requests')
  @RequirePlatformCapability('finance.refund')
  @ApiOperation({
    summary: 'Refund part or all of a payment (support, finance)',
    description:
      'At or below the threshold the refund is issued at once; above it, it waits for a different admin (T16). 422 REFUND_EXCEEDS_CAPTURE; 409 NOT_REFUNDABLE.',
  })
  @ApiZodBody(refundRequestInputSchema)
  @ApiZodResponse(201, refundRequestSchema, 'The request.')
  @ApiErrors(400, 401, 403, 404, 409, 422)
  requestRefund(
    @CurrentAdmin() admin: AdminPrincipal,
    @ZodBody(refundRequestInputSchema) body: RefundRequestInput,
    @Req() req: Request,
  ) {
    return this.finance.createRefundRequest(admin.adminId, body, requestMeta(req));
  }

  @Post('refund-requests/:requestId/decision')
  @HttpCode(HttpStatus.OK)
  @RequirePlatformCapability('finance.refund')
  @idParam('requestId')
  @ApiOperation({
    summary: 'Approve or reject a refund request',
    description: '403 SAME_APPROVER when the requester approves their own; 409 ALREADY_DECIDED.',
  })
  @ApiZodBody(refundDecisionSchema)
  @ApiZodResponse(200, refundRequestSchema, 'The request after the decision.')
  @ApiErrors(400, 401, 403, 404, 409, 422)
  decide(
    @CurrentAdmin() admin: AdminPrincipal,
    @UuidParam('requestId') id: string,
    @ZodBody(refundDecisionSchema) body: RefundDecision,
    @Req() req: Request,
  ) {
    return this.finance.decideRefundRequest(admin.adminId, id, body, requestMeta(req));
  }

  @Get('earnings')
  @RequirePlatformCapability('finance.view')
  @ApiOperation({ summary: 'Merchant earnings across businesses, newest first' })
  @ApiZodQuery(adminEarningListQuerySchema)
  @ApiZodResponse(200, pageSchema(adminEarningSchema), 'A page of earnings.')
  @ApiErrors(400, 401, 403)
  earnings(@ZodQuery(adminEarningListQuerySchema) query: AdminEarningListQuery) {
    return this.finance.listEarnings(query);
  }

  @Get('disputes')
  @RequirePlatformCapability('finance.view')
  @ApiOperation({ summary: 'Disputes, newest first' })
  @ApiZodQuery(disputeListQuerySchema)
  @ApiZodResponse(200, pageSchema(disputeSchema), 'A page of disputes.')
  @ApiErrors(400, 401, 403)
  disputes(@ZodQuery(disputeListQuerySchema) query: DisputeListQuery) {
    return this.finance.listDisputes(query);
  }

  @Post('disputes')
  @RequirePlatformCapability('finance.manage')
  @ApiOperation({ summary: 'Open a dispute on an earning; it is not paid out while open (T09)' })
  @ApiZodBody(disputeInputSchema)
  @ApiZodResponse(201, disputeSchema, 'The dispute.')
  @ApiErrors(400, 401, 403, 404, 409, 422)
  openDispute(
    @CurrentAdmin() admin: AdminPrincipal,
    @ZodBody(disputeInputSchema) body: DisputeInput,
    @Req() req: Request,
  ) {
    return this.finance.openDispute(admin.adminId, body, requestMeta(req));
  }

  @Post('disputes/:disputeId/resolution')
  @HttpCode(HttpStatus.OK)
  @RequirePlatformCapability('finance.manage')
  @idParam('disputeId')
  @ApiOperation({ summary: 'Resolve a dispute; a lost one is taken back from the merchant' })
  @ApiZodBody(disputeResolutionSchema)
  @ApiZodResponse(200, disputeSchema, 'The dispute.')
  @ApiErrors(400, 401, 403, 404, 409)
  resolveDispute(
    @CurrentAdmin() admin: AdminPrincipal,
    @UuidParam('disputeId') id: string,
    @ZodBody(disputeResolutionSchema) body: DisputeResolution,
    @Req() req: Request,
  ) {
    return this.finance.resolveDispute(admin.adminId, id, body, requestMeta(req));
  }

  @Get('holds')
  @RequirePlatformCapability('finance.view')
  @ApiOperation({ summary: 'Payout holds, newest first' })
  @ApiZodResponse(200, z.array(payoutHoldSchema), 'Holds.')
  @ApiErrors(401, 403)
  holds() {
    return this.finance.listHolds();
  }

  @Post('holds')
  @RequirePlatformCapability('finance.manage')
  @ApiOperation({ summary: 'Hold payouts to a business (409 HOLD_EXISTS)' })
  @ApiZodBody(payoutHoldInputSchema)
  @ApiZodResponse(201, z.array(payoutHoldSchema), 'Holds.')
  @ApiErrors(400, 401, 403, 404, 409)
  placeHold(
    @CurrentAdmin() admin: AdminPrincipal,
    @ZodBody(payoutHoldInputSchema) body: PayoutHoldInput,
    @Req() req: Request,
  ) {
    return this.finance.placeHold(admin.adminId, body, requestMeta(req));
  }

  @Post('holds/:holdId/release')
  @HttpCode(HttpStatus.OK)
  @RequirePlatformCapability('finance.manage')
  @idParam('holdId')
  @ApiOperation({ summary: 'Release a payout hold' })
  @ApiZodResponse(200, z.array(payoutHoldSchema), 'Holds.')
  @ApiErrors(401, 403, 404)
  releaseHold(
    @CurrentAdmin() admin: AdminPrincipal,
    @UuidParam('holdId') id: string,
    @Req() req: Request,
  ) {
    return this.finance.releaseHold(admin.adminId, id, requestMeta(req));
  }

  @Get('payouts')
  @RequirePlatformCapability('finance.view')
  @ApiOperation({ summary: 'Payouts across businesses, newest first' })
  @ApiZodQuery(payoutListQuerySchema)
  @ApiZodResponse(200, pageSchema(payoutSchema), 'A page of payouts.')
  @ApiErrors(400, 401, 403)
  listPayouts(@ZodQuery(payoutListQuerySchema) query: PayoutListQuery) {
    return this.payouts.list(query);
  }

  @Post('payout-runs')
  @HttpCode(HttpStatus.OK)
  @RequirePlatformCapability('finance.manage')
  @ApiOperation({
    summary: 'Pay every business its eligible earnings now',
    description:
      'Skips businesses on hold or suspended, earnings with an open dispute or a pending refund, and amounts below the minimum.',
  })
  @ApiZodResponse(200, payoutRunResultSchema, 'What was paid and what was skipped.')
  @ApiErrors(401, 403)
  runPayouts(@CurrentAdmin() admin: AdminPrincipal, @Req() req: Request) {
    return this.payouts.run(admin.adminId, requestMeta(req));
  }

  @Get('reconciliation-runs')
  @RequirePlatformCapability('finance.view')
  @ApiOperation({ summary: 'Reconciliation runs with their findings, newest first' })
  @ApiZodQuery(reconciliationListQuerySchema)
  @ApiZodResponse(200, pageSchema(reconciliationRunSchema), 'A page of runs.')
  @ApiErrors(400, 401, 403)
  reconciliationRuns(@ZodQuery(reconciliationListQuerySchema) query: ReconciliationListQuery) {
    return this.recon.list(query);
  }

  @Post('reconciliation-runs')
  @RequirePlatformCapability('finance.manage')
  @ApiOperation({
    summary: 'Reconcile one UTC day against the provider (T15)',
    description:
      'Replays settled events the provider recorded but never delivered, and flags mismatches. 409 ALREADY_RECONCILED; 422 PERIOD_NOT_OVER.',
  })
  @ApiZodBody(reconciliationRunRequestSchema)
  @ApiZodResponse(201, reconciliationRunSchema, 'The run.')
  @ApiErrors(400, 401, 403, 409, 422)
  reconcile(
    @CurrentAdmin() admin: AdminPrincipal,
    @ZodBody(reconciliationRunRequestSchema) body: ReconciliationRunRequest,
    @Req() req: Request,
  ) {
    return this.recon.run(admin.adminId, body.date, requestMeta(req));
  }

  @Post('reconciliation-items/:itemId/resolve')
  @HttpCode(HttpStatus.OK)
  @RequirePlatformCapability('finance.manage')
  @idParam('itemId')
  @ApiOperation({ summary: 'Mark a reconciliation finding as handled, with a note' })
  @ApiZodBody(reconciliationResolveSchema)
  @ApiZodResponse(200, reconciliationRunSchema, 'The run.')
  @ApiErrors(400, 401, 403, 404)
  resolveItem(
    @CurrentAdmin() admin: AdminPrincipal,
    @UuidParam('itemId') id: string,
    @ZodBody(reconciliationResolveSchema) body: ReconciliationResolve,
    @Req() req: Request,
  ) {
    return this.recon.resolveItem(admin.adminId, id, body.note, requestMeta(req));
  }
}
