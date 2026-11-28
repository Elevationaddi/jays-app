import { Controller, Inject, HttpCode, HttpStatus, Post, Req } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import {
  challengeSchema,
  loginRequestSchema,
  logoutRequestSchema,
  passwordResetConfirmSchema,
  passwordResetRequestSchema,
  refreshRequestSchema,
  registerRequestSchema,
  resendRequestSchema,
  sessionSchema,
  tokenPairSchema,
  verifyRequestSchema,
  type RegisterRequest,
} from '@jays/contracts';
import { z } from 'zod';
import type { Request } from 'express';
import { requestMeta } from '../common/request-context.js';
import { ApiErrors, ApiZodBody, ApiZodResponse, ZodBody } from '../common/zod.js';
import { AuthService } from './auth.service.js';

export const loginResultSchema = z.discriminatedUnion('status', [
  sessionSchema.extend({ status: z.literal('authenticated') }),
  z.object({ status: z.literal('verification_required'), challenge: challengeSchema }),
]);

@ApiTags('auth')
@Controller('auth')
export class AuthController {
  constructor(@Inject(AuthService) private readonly auth: AuthService) {}

  @Post('register')
  @HttpCode(HttpStatus.ACCEPTED)
  @ApiOperation({
    summary: 'Create an account and send a verification code',
    description:
      'Provide exactly one of email or phone. The answer is the same whether or not the contact is already registered. Unknown fields (for example a role) are rejected. In private staging, only invited (allowlisted) emails may register: others get 403 SIGNUP_RESTRICTED.',
  })
  @ApiZodBody(registerRequestSchema)
  @ApiZodResponse(
    202,
    challengeSchema,
    'A code was sent (or the owner was told the account exists).',
  )
  @ApiErrors(400, 403, 429, 503)
  register(@ZodBody(registerRequestSchema) body: RegisterRequest, @Req() req: Request) {
    return this.auth.register(body, requestMeta(req));
  }

  @Post('verify')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Verify a contact with its code; signs the user in' })
  @ApiZodBody(verifyRequestSchema)
  @ApiZodResponse(200, sessionSchema, 'Verified and signed in.')
  @ApiErrors(400, 403, 429)
  verify(
    @ZodBody(verifyRequestSchema) body: z.infer<typeof verifyRequestSchema>,
    @Req() req: Request,
  ) {
    return this.auth.verify(body.challengeId, body.code, requestMeta(req));
  }

  @Post('verify/resend')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Send a new code for an open challenge (cooldown and maximum apply)' })
  @ApiZodBody(resendRequestSchema)
  @ApiZodResponse(200, challengeSchema, 'A new code was sent.')
  @ApiErrors(400, 404, 429)
  resend(
    @ZodBody(resendRequestSchema) body: z.infer<typeof resendRequestSchema>,
    @Req() req: Request,
  ) {
    return this.auth.resend(body.challengeId, requestMeta(req));
  }

  @Post('login')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Sign in with email or phone and password',
    description:
      'An unverified account gets `verification_required` and a fresh code instead of tokens.',
  })
  @ApiZodBody(loginRequestSchema)
  @ApiZodResponse(200, loginResultSchema, 'Signed in, or verification is required first.')
  @ApiErrors(400, 401, 429)
  login(
    @ZodBody(loginRequestSchema) body: z.infer<typeof loginRequestSchema>,
    @Req() req: Request,
  ) {
    return this.auth.login(body.identifier, body.password, requestMeta(req));
  }

  @Post('refresh')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Rotate the refresh token',
    description: 'Each refresh token works once. Presenting a used one ends the whole session.',
  })
  @ApiZodBody(refreshRequestSchema)
  @ApiZodResponse(200, tokenPairSchema, 'New access and refresh tokens.')
  @ApiErrors(400, 401, 429)
  refresh(
    @ZodBody(refreshRequestSchema) body: z.infer<typeof refreshRequestSchema>,
    @Req() req: Request,
  ) {
    return this.auth.refresh(body.refreshToken, requestMeta(req));
  }

  @Post('logout')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'End the session that owns this refresh token (idempotent)' })
  @ApiZodBody(logoutRequestSchema)
  @ApiZodResponse(204, z.null(), 'Signed out.')
  @ApiErrors(400)
  async logout(@ZodBody(logoutRequestSchema) body: z.infer<typeof logoutRequestSchema>) {
    await this.auth.logout(body.refreshToken);
  }

  @Post('password/reset-request')
  @HttpCode(HttpStatus.ACCEPTED)
  @ApiOperation({
    summary: 'Send a password reset code (same answer whether or not the account exists)',
  })
  @ApiZodBody(passwordResetRequestSchema)
  @ApiZodResponse(202, challengeSchema, 'If the account exists, a code was sent.')
  @ApiErrors(400, 429)
  requestReset(
    @ZodBody(passwordResetRequestSchema) body: z.infer<typeof passwordResetRequestSchema>,
    @Req() req: Request,
  ) {
    return this.auth.requestPasswordReset(body.identifier, requestMeta(req));
  }

  @Post('password/reset')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Set a new password with the code; ends all other sessions' })
  @ApiZodBody(passwordResetConfirmSchema)
  @ApiZodResponse(200, sessionSchema, 'Password changed and signed in.')
  @ApiErrors(400, 429)
  confirmReset(
    @ZodBody(passwordResetConfirmSchema) body: z.infer<typeof passwordResetConfirmSchema>,
    @Req() req: Request,
  ) {
    return this.auth.confirmPasswordReset(
      body.challengeId,
      body.code,
      body.newPassword,
      requestMeta(req),
    );
  }
}
