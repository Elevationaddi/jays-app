import {
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Inject,
  Patch,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiQuery, ApiTags } from '@nestjs/swagger';
import {
  consentRecordSchema,
  dataExportSchema,
  pageSchema,
  privacySchema,
  requestDeletionSchema,
  unsubscribeResultSchema,
  updatePrivacyRequestSchema,
  type UpdatePrivacyRequest,
} from '@jays/contracts';
import type { Request } from 'express';
import type { z } from 'zod';
import { CurrentUser, UserAuthGuard, type UserPrincipal } from '../auth/guards.js';
import { listQuerySchema, type ListQuery } from '../common/pagination.js';
import { requestMeta } from '../common/request-context.js';
import {
  ApiErrors,
  ApiZodBody,
  ApiZodQuery,
  ApiZodResponse,
  ZodBody,
  ZodQuery,
} from '../common/zod.js';
import { PrivacyService } from './privacy.service.js';

/** Account and privacy for the signed-in user (ADR-0019). */
@ApiTags('me')
@ApiBearerAuth()
@UseGuards(UserAuthGuard)
@Controller('me')
export class PrivacyController {
  constructor(@Inject(PrivacyService) private readonly privacy: PrivacyService) {}

  @Get('privacy')
  @ApiOperation({ summary: 'Marketing consent, notification preferences and deletion status' })
  @ApiZodResponse(200, privacySchema, 'Privacy settings.')
  @ApiErrors(401)
  get(@CurrentUser() user: UserPrincipal) {
    return this.privacy.get(user.userId);
  }

  @Patch('privacy')
  @ApiOperation({
    summary: 'Change marketing consent per channel or transactional notification preferences',
  })
  @ApiZodBody(updatePrivacyRequestSchema)
  @ApiZodResponse(200, privacySchema, 'Updated settings.')
  @ApiErrors(400, 401)
  update(
    @CurrentUser() user: UserPrincipal,
    @ZodBody(updatePrivacyRequestSchema) body: UpdatePrivacyRequest,
    @Req() req: Request,
  ) {
    return this.privacy.update(user.userId, body, requestMeta(req));
  }

  @Get('consents')
  @ApiOperation({ summary: 'My marketing consent history, newest first' })
  @ApiZodQuery(listQuerySchema)
  @ApiZodResponse(200, pageSchema(consentRecordSchema), 'A page of consent records.')
  @ApiErrors(400, 401)
  consents(@CurrentUser() user: UserPrincipal, @ZodQuery(listQuerySchema) query: ListQuery) {
    return this.privacy.consentHistory(user.userId, query);
  }

  @Get('export')
  @ApiOperation({ summary: 'Download everything the account holds about me as JSON' })
  @ApiZodResponse(200, dataExportSchema, 'The data export.')
  @ApiErrors(401)
  export(@CurrentUser() user: UserPrincipal) {
    return this.privacy.export(user.userId);
  }

  @Post('deletion')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Schedule account deletion after the grace period (needs the current password)',
  })
  @ApiZodBody(requestDeletionSchema)
  @ApiZodResponse(200, privacySchema, 'Deletion scheduled.')
  @ApiErrors(400, 401, 409, 422, 429)
  requestDeletion(
    @CurrentUser() user: UserPrincipal,
    @ZodBody(requestDeletionSchema) body: z.infer<typeof requestDeletionSchema>,
    @Req() req: Request,
  ) {
    return this.privacy.requestDeletion(user.userId, body, requestMeta(req));
  }

  @Delete('deletion')
  @ApiOperation({ summary: 'Keep my account: cancel a scheduled deletion' })
  @ApiZodResponse(200, privacySchema, 'Deletion canceled.')
  @ApiErrors(401, 404)
  cancelDeletion(@CurrentUser() user: UserPrincipal, @Req() req: Request) {
    return this.privacy.cancelDeletion(user.userId, requestMeta(req));
  }
}

/**
 * One-click unsubscribe from marketing (D15; RFC 8058). The signed token in the link identifies
 * the person and channel, so no sign-in is needed. GET only checks the link; POST withdraws.
 */
@ApiTags('me')
@Controller('unsubscribe')
export class UnsubscribeController {
  constructor(@Inject(PrivacyService) private readonly privacy: PrivacyService) {}

  @Get()
  @ApiOperation({ summary: 'Check an unsubscribe link (changes nothing)' })
  @ApiQuery({ name: 'token', required: true })
  @ApiZodResponse(200, unsubscribeResultSchema, 'The channel the link withdraws.')
  @ApiErrors(400, 429)
  preview(@Query('token') token: string, @Req() req: Request) {
    return this.privacy.unsubscribe(String(token ?? ''), true, requestMeta(req));
  }

  @Post()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Withdraw marketing consent for the channel in the link' })
  @ApiQuery({ name: 'token', required: true })
  @ApiZodResponse(200, unsubscribeResultSchema, 'Withdrawn.')
  @ApiErrors(400, 429)
  unsubscribe(@Query('token') token: string, @Req() req: Request) {
    return this.privacy.unsubscribe(String(token ?? ''), false, requestMeta(req));
  }
}
