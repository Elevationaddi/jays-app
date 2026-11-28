import {
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Inject,
  Post,
  Put,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiParam, ApiTags } from '@nestjs/swagger';
import { stockAlertListSchema, wishlistSchema } from '@jays/contracts';
import { CurrentUser, UserAuthGuard, type UserPrincipal } from '../auth/guards.js';
import { UuidParam } from '../common/params.js';
import { ApiErrors, ApiZodResponse } from '../common/zod.js';
import { DiscoveryService } from './discovery.service.js';

/** The signed-in customer's wishlist and back-in-stock alerts (phase 8.6). */
@ApiTags('me')
@ApiBearerAuth()
@UseGuards(UserAuthGuard)
@Controller('me')
export class DiscoveryController {
  constructor(@Inject(DiscoveryService) private readonly discovery: DiscoveryService) {}

  @Get('wishlist')
  @ApiOperation({
    summary: 'My wishlist, newest first',
    description: 'A product that is no longer on sale stays listed with product: null.',
  })
  @ApiZodResponse(200, wishlistSchema, 'The wishlist.')
  @ApiErrors(401)
  wishlist(@CurrentUser() user: UserPrincipal) {
    return this.discovery.wishlist(user.userId);
  }

  @Put('wishlist/:productId')
  @ApiParam({ name: 'productId', format: 'uuid' })
  @ApiOperation({ summary: 'Save a product (idempotent; 404 when not on sale)' })
  @ApiZodResponse(200, wishlistSchema, 'The wishlist.')
  @ApiErrors(401, 404, 422)
  add(@CurrentUser() user: UserPrincipal, @UuidParam('productId') productId: string) {
    return this.discovery.addToWishlist(user.userId, productId);
  }

  @Delete('wishlist/:productId')
  @ApiParam({ name: 'productId', format: 'uuid' })
  @ApiOperation({ summary: 'Remove a product from the wishlist (idempotent)' })
  @ApiZodResponse(200, wishlistSchema, 'The wishlist.')
  @ApiErrors(401)
  remove(@CurrentUser() user: UserPrincipal, @UuidParam('productId') productId: string) {
    return this.discovery.removeFromWishlist(user.userId, productId);
  }

  @Get('stock-alerts')
  @ApiOperation({ summary: 'My open back-in-stock alerts' })
  @ApiZodResponse(200, stockAlertListSchema, 'Open alerts.')
  @ApiErrors(401)
  alerts(@CurrentUser() user: UserPrincipal) {
    return this.discovery.alerts(user.userId);
  }

  @Post('stock-alerts/:variantId')
  @HttpCode(HttpStatus.OK)
  @ApiParam({ name: 'variantId', format: 'uuid' })
  @ApiOperation({
    summary: 'Tell me when a sold-out option is back (idempotent)',
    description:
      'One notification, in the app and by email when allowed, when the option can be bought again. Stock is not held for you. 409 IN_STOCK when it is available now.',
  })
  @ApiZodResponse(200, stockAlertListSchema, 'Open alerts.')
  @ApiErrors(401, 404, 409, 422)
  addAlert(@CurrentUser() user: UserPrincipal, @UuidParam('variantId') variantId: string) {
    return this.discovery.addAlert(user.userId, variantId);
  }

  @Delete('stock-alerts/:variantId')
  @ApiParam({ name: 'variantId', format: 'uuid' })
  @ApiOperation({ summary: 'Cancel a back-in-stock alert (idempotent)' })
  @ApiZodResponse(200, stockAlertListSchema, 'Open alerts.')
  @ApiErrors(401)
  removeAlert(@CurrentUser() user: UserPrincipal, @UuidParam('variantId') variantId: string) {
    return this.discovery.removeAlert(user.userId, variantId);
  }
}
