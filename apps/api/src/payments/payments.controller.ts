import {
  Controller,
  Headers,
  HttpCode,
  HttpStatus,
  Inject,
  Post,
  type RawBodyRequest,
  Req,
} from '@nestjs/common';
import { ApiHeader, ApiOperation, ApiParam, ApiTags } from '@nestjs/swagger';
import {
  mockConfirmRequestSchema,
  mockConfirmResponseSchema,
  webhookAckSchema,
} from '@jays/contracts';
import type { Request } from 'express';
import type { z } from 'zod';
import { API_ENV, type ApiEnv } from '../config.js';
import { ApiError } from '../common/error.filter.js';
import { ApiErrors, ApiZodBody, ApiZodResponse, ZodBody } from '../common/zod.js';
import { MockIntentError, type MockPaymentProvider } from './mock-provider.js';
import { PaymentsService } from './payments.service.js';
import { PAYMENT_PROVIDER, WEBHOOK_SIGNATURE_HEADER } from './provider.js';

/** Provider webhooks: verified over the raw body, recorded once per event id. */
@ApiTags('payments')
@Controller('webhooks')
export class WebhooksController {
  constructor(@Inject(PaymentsService) private readonly payments: PaymentsService) {}

  @Post('payments')
  @HttpCode(HttpStatus.OK)
  @ApiHeader({
    name: WEBHOOK_SIGNATURE_HEADER,
    required: true,
    description: 't=<unix>,v1=<hex HMAC-SHA256 of "t.body">',
  })
  @ApiOperation({
    summary: 'Payment provider webhook (signature over the raw body; replays are no-ops)',
    description:
      '401 INVALID_SIGNATURE when the signature is missing, wrong or older than 5 minutes.',
  })
  @ApiZodResponse(200, webhookAckSchema, 'Accepted (or already processed).')
  @ApiErrors(401)
  receive(
    @Req() req: RawBodyRequest<Request>,
    @Headers(WEBHOOK_SIGNATURE_HEADER) signature: string | undefined,
  ) {
    return this.payments.handleWebhook(req.rawBody, signature);
  }
}

/**
 * The mock provider's hosted payment step (local development and tests only). Registered only
 * when PSP_PROVIDER=mock, which production refuses (ADR-0006). It does not change any order: the
 * outcome reaches the API later as a signed webhook, exactly like a real provider.
 */
@ApiTags('mock-psp')
@Controller('mock-psp')
export class MockPspController {
  constructor(
    @Inject(PAYMENT_PROVIDER) private readonly provider: MockPaymentProvider,
    @Inject(API_ENV) private readonly env: ApiEnv,
  ) {}

  @Post('intents/:intentId/confirm')
  @HttpCode(HttpStatus.OK)
  @ApiParam({ name: 'intentId' })
  @ApiOperation({
    summary: 'Mock hosted payment page: pay an intent with a chosen outcome (not in production)',
    description:
      'Outcomes other than success need MOCK_PAYMENT_OUTCOMES=true. timeout sends no webhook; duplicate sends the same event twice.',
  })
  @ApiZodBody(mockConfirmRequestSchema)
  @ApiZodResponse(200, mockConfirmResponseSchema, 'Webhooks queued.')
  @ApiErrors(400, 404, 409, 422)
  confirm(
    @Req() req: Request,
    @ZodBody(mockConfirmRequestSchema) body: z.infer<typeof mockConfirmRequestSchema>,
  ) {
    const intentId = String(req.params['intentId'] ?? '');
    if (body.outcome !== 'success' && !this.env.MOCK_PAYMENT_OUTCOMES) {
      throw new ApiError(
        HttpStatus.UNPROCESSABLE_ENTITY,
        'MOCK_OUTCOMES_DISABLED',
        'Only successful mock payments are allowed unless MOCK_PAYMENT_OUTCOMES=true.',
      );
    }
    try {
      const queued = this.provider.confirm(intentId, body.clientSecret, body.outcome);
      return { intentId, outcome: body.outcome, webhooksQueued: queued };
    } catch (error) {
      if (error instanceof MockIntentError) {
        throw error.code === 'NOT_FOUND'
          ? new ApiError(HttpStatus.NOT_FOUND, 'NOT_FOUND', 'Not found.')
          : new ApiError(
              HttpStatus.CONFLICT,
              'ALREADY_CONFIRMED',
              'This payment was already completed.',
            );
      }
      throw error;
    }
  }
}
