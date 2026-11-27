import {
  Controller,
  Inject,
  Get,
  HttpCode,
  HttpStatus,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import {
  acceptInviteRequestSchema,
  adminInviteSchema,
  adminListItemSchema,
  adminLoginRequestSchema,
  adminSchema,
  adminSessionSchema,
  auditLogItemSchema,
  confirmMfaRequestSchema,
  createAdminInviteRequestSchema,
  logoutRequestSchema,
  mfaEnrollmentSchema,
  pageSchema,
  refreshRequestSchema,
  tokenPairSchema,
} from '@jays/contracts';
import type { Request } from 'express';
import { z } from 'zod';
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
import {
  AdminAuthGuard,
  type AdminPrincipal,
  CurrentAdmin,
  RequirePlatformCapability,
} from './admin.guard.js';
import { AdminService } from './admin.service.js';

@ApiTags('admin-auth')
@Controller('admin')
export class AdminAuthController {
  constructor(@Inject(AdminService) private readonly admins: AdminService) {}

  @Post('auth/login')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Admin sign-in: password and authenticator code are both required' })
  @ApiZodBody(adminLoginRequestSchema)
  @ApiZodResponse(200, adminSessionSchema, 'Signed in.')
  @ApiErrors(400, 401, 429)
  login(
    @ZodBody(adminLoginRequestSchema) body: z.infer<typeof adminLoginRequestSchema>,
    @Req() req: Request,
  ) {
    return this.admins.login(body.email, body.password, body.totpCode, requestMeta(req));
  }

  @Post('auth/refresh')
  @HttpCode(HttpStatus.OK)
  @ApiZodBody(refreshRequestSchema)
  @ApiZodResponse(200, tokenPairSchema, 'Rotated tokens.')
  @ApiErrors(400, 401, 429)
  refresh(
    @ZodBody(refreshRequestSchema) body: z.infer<typeof refreshRequestSchema>,
    @Req() req: Request,
  ) {
    return this.admins.refresh(body.refreshToken, requestMeta(req));
  }

  @Post('auth/logout')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiZodBody(logoutRequestSchema)
  @ApiZodResponse(204, z.null(), 'Signed out.')
  @ApiErrors(400)
  async logout(@ZodBody(logoutRequestSchema) body: z.infer<typeof logoutRequestSchema>) {
    await this.admins.logout(body.refreshToken);
  }

  @Post('invites/accept')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Accept an admin invitation: set a password and get an authenticator secret',
  })
  @ApiZodBody(acceptInviteRequestSchema)
  @ApiZodResponse(
    200,
    mfaEnrollmentSchema,
    'Scan or type the secret into an authenticator app, then confirm.',
  )
  @ApiErrors(400, 429)
  accept(
    @ZodBody(acceptInviteRequestSchema) body: z.infer<typeof acceptInviteRequestSchema>,
    @Req() req: Request,
  ) {
    return this.admins.acceptInvite(body.token, body.password, requestMeta(req));
  }

  @Post('invites/confirm-mfa')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Confirm the authenticator code; activates the admin account' })
  @ApiZodBody(confirmMfaRequestSchema)
  @ApiZodResponse(200, adminSessionSchema, 'Active and signed in.')
  @ApiErrors(400, 429)
  confirm(
    @ZodBody(confirmMfaRequestSchema) body: z.infer<typeof confirmMfaRequestSchema>,
    @Req() req: Request,
  ) {
    return this.admins.confirmMfa(body.token, body.totpCode, requestMeta(req));
  }
}

@ApiTags('admin')
@ApiBearerAuth()
@UseGuards(AdminAuthGuard)
@Controller('admin')
export class AdminController {
  constructor(@Inject(AdminService) private readonly admins: AdminService) {}

  @Get('me')
  @ApiOperation({ summary: 'The signed-in admin, roles and capabilities' })
  @ApiZodResponse(200, adminSchema, 'Admin.')
  @ApiErrors(401)
  me(@CurrentAdmin() admin: AdminPrincipal) {
    return this.admins.view(admin.adminId);
  }

  @Get('admins')
  @RequirePlatformCapability('admins.manage')
  @ApiOperation({ summary: 'Admin accounts (superadmin)' })
  @ApiZodQuery(listQuerySchema)
  @ApiZodResponse(200, pageSchema(adminListItemSchema), 'A page of admins.')
  @ApiErrors(400, 401, 403)
  list(@ZodQuery(listQuerySchema) query: ListQuery) {
    return this.admins.listAdmins(query);
  }

  @Post('admins/invites')
  @RequirePlatformCapability('admins.manage')
  @ApiOperation({
    summary: 'Invite an admin with roles; a reason is required and audited (superadmin)',
  })
  @ApiZodBody(createAdminInviteRequestSchema)
  @ApiZodResponse(201, adminInviteSchema, 'Invitation emailed to the invitee.')
  @ApiErrors(400, 401, 403, 409, 503)
  invite(
    @CurrentAdmin() admin: AdminPrincipal,
    @ZodBody(createAdminInviteRequestSchema) body: z.infer<typeof createAdminInviteRequestSchema>,
    @Req() req: Request,
  ) {
    return this.admins.invite(admin.adminId, body, requestMeta(req));
  }

  @Get('audit-logs')
  @RequirePlatformCapability('audit.view')
  @ApiOperation({ summary: 'Audit log, newest first (superadmin, compliance)' })
  @ApiZodQuery(listQuerySchema)
  @ApiZodResponse(200, pageSchema(auditLogItemSchema), 'A page of audit entries.')
  @ApiErrors(400, 401, 403)
  audit(@ZodQuery(listQuerySchema) query: ListQuery) {
    return this.admins.listAuditLogs(query);
  }
}
