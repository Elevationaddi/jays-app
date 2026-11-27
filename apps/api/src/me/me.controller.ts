import {
  Controller,
  Inject,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Patch,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiParam, ApiTags } from '@nestjs/swagger';
import {
  addressInputSchema,
  addressPatchSchema,
  addressSchema,
  meSchema,
  myMembershipSchema,
  pageSchema,
  updateMeRequestSchema,
  type AddressInput,
  type UpdateMeRequest,
} from '@jays/contracts';
import type { Request } from 'express';
import { z } from 'zod';
import { CurrentUser, UserAuthGuard, type UserPrincipal } from '../auth/guards.js';
import { listQuerySchema, type ListQuery } from '../common/pagination.js';
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
import { MeService } from './me.service.js';

@ApiTags('me')
@ApiBearerAuth()
@UseGuards(UserAuthGuard)
@Controller('me')
export class MeController {
  constructor(@Inject(MeService) private readonly me: MeService) {}

  @Get()
  @ApiOperation({ summary: 'The signed-in user' })
  @ApiZodResponse(200, meSchema, 'Profile.')
  @ApiErrors(401)
  get(@CurrentUser() user: UserPrincipal) {
    return this.me.get(user.userId);
  }

  @Patch()
  @ApiOperation({
    summary: 'Update profile, language, emirate, preferred mode or marketing consent',
  })
  @ApiZodBody(updateMeRequestSchema)
  @ApiZodResponse(200, meSchema, 'Updated profile.')
  @ApiErrors(400, 401, 422)
  update(
    @CurrentUser() user: UserPrincipal,
    @ZodBody(updateMeRequestSchema) body: UpdateMeRequest,
    @Req() req: Request,
  ) {
    return this.me.update(user.userId, body, requestMeta(req));
  }

  @Get('addresses')
  @ApiOperation({ summary: 'My saved addresses' })
  @ApiZodQuery(listQuerySchema)
  @ApiZodResponse(200, pageSchema(addressSchema), 'A page of addresses.')
  @ApiErrors(400, 401)
  listAddresses(@CurrentUser() user: UserPrincipal, @ZodQuery(listQuerySchema) query: ListQuery) {
    return this.me.listAddresses(user.userId, query);
  }

  @Post('addresses')
  @ApiOperation({ summary: 'Add an address (the first one becomes the default)' })
  @ApiZodBody(addressInputSchema)
  @ApiZodResponse(201, addressSchema, 'Created.')
  @ApiErrors(400, 401, 422)
  createAddress(
    @CurrentUser() user: UserPrincipal,
    @ZodBody(addressInputSchema) body: AddressInput,
  ) {
    return this.me.createAddress(user.userId, body);
  }

  @Get('addresses/:addressId')
  @ApiParam({ name: 'addressId', format: 'uuid' })
  @ApiZodResponse(200, addressSchema, 'The address.')
  @ApiErrors(401, 404)
  getAddress(@CurrentUser() user: UserPrincipal, @UuidParam('addressId') addressId: string) {
    return this.me.getAddress(user.userId, addressId);
  }

  @Patch('addresses/:addressId')
  @ApiParam({ name: 'addressId', format: 'uuid' })
  @ApiZodBody(addressPatchSchema)
  @ApiZodResponse(200, addressSchema, 'Updated.')
  @ApiErrors(400, 401, 404, 422)
  updateAddress(
    @CurrentUser() user: UserPrincipal,
    @UuidParam('addressId') addressId: string,
    @ZodBody(addressPatchSchema) body: Partial<AddressInput>,
  ) {
    return this.me.updateAddress(user.userId, addressId, body);
  }

  @Delete('addresses/:addressId')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Archive an address' })
  @ApiParam({ name: 'addressId', format: 'uuid' })
  @ApiZodResponse(204, z.null(), 'Archived.')
  @ApiErrors(401, 404)
  async archiveAddress(
    @CurrentUser() user: UserPrincipal,
    @UuidParam('addressId') addressId: string,
  ) {
    await this.me.archiveAddress(user.userId, addressId);
  }

  @Get('memberships')
  @ApiOperation({
    summary: 'Businesses I belong to or am invited to (business gateway and switcher)',
  })
  @ApiZodQuery(listQuerySchema)
  @ApiZodResponse(200, pageSchema(myMembershipSchema), 'A page of memberships.')
  @ApiErrors(400, 401)
  listMemberships(@CurrentUser() user: UserPrincipal, @ZodQuery(listQuerySchema) query: ListQuery) {
    return this.me.listMemberships(user.userId, query);
  }

  @Post('memberships/:membershipId/accept')
  @HttpCode(HttpStatus.OK)
  @ApiParam({ name: 'membershipId', format: 'uuid' })
  @ApiZodResponse(200, myMembershipSchema, 'Joined the business.')
  @ApiErrors(401, 404)
  accept(
    @CurrentUser() user: UserPrincipal,
    @UuidParam('membershipId') id: string,
    @Req() req: Request,
  ) {
    return this.me.respondToInvitation(user.userId, id, true, requestMeta(req));
  }

  @Post('memberships/:membershipId/decline')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiParam({ name: 'membershipId', format: 'uuid' })
  @ApiZodResponse(204, z.null(), 'Declined.')
  @ApiErrors(401, 404)
  async decline(
    @CurrentUser() user: UserPrincipal,
    @UuidParam('membershipId') id: string,
    @Req() req: Request,
  ) {
    await this.me.respondToInvitation(user.userId, id, false, requestMeta(req));
  }
}
