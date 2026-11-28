import {
  Controller,
  Delete,
  Get,
  Headers,
  HttpCode,
  HttpStatus,
  Inject,
  Post,
  Put,
  Req,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiHeader, ApiOperation, ApiParam, ApiTags } from '@nestjs/swagger';
import {
  cartSchema,
  createOrderRequestSchema,
  createOrderResponseSchema,
  mergeCartRequestSchema,
  orderListItemSchema,
  orderListQuerySchema,
  orderSchema,
  pageSchema,
  putCartItemRequestSchema,
  quoteRequestSchema,
  quoteSchema,
} from '@jays/contracts';
import type { Request } from 'express';
import type { z } from 'zod';
import {
  CurrentUser,
  OptionalUser,
  OptionalUserAuthGuard,
  UserAuthGuard,
  type UserPrincipal,
} from '../auth/guards.js';
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
import { CartService } from './cart.service.js';
import { CheckoutService } from './checkout.service.js';
import { OrdersService } from './orders.service.js';

const cartTokenHeader = ApiHeader({
  name: 'X-Cart-Token',
  required: false,
  description: 'Guest cart token returned as cartToken. Ignored when signed in.',
});

/** Customer cart, quote and orders (docs/07-api.md). Guests may use the cart; checkout needs sign-in. */
@ApiTags('shop')
@Controller()
export class CommerceController {
  constructor(
    @Inject(CartService) private readonly cart: CartService,
    @Inject(CheckoutService) private readonly checkout: CheckoutService,
    @Inject(OrdersService) private readonly orders: OrdersService,
  ) {}

  @Get('cart')
  @UseGuards(OptionalUserAuthGuard)
  @ApiBearerAuth()
  @cartTokenHeader
  @ApiOperation({
    summary: 'The cart, grouped by seller and repriced on the server',
    description:
      'Lines carry issues (unavailable, out_of_stock, insufficient_stock, price_changed).',
  })
  @ApiZodResponse(200, cartSchema, 'The cart.')
  @ApiErrors(401)
  get(
    @OptionalUser() user: UserPrincipal | null,
    @Headers('x-cart-token') token: string | undefined,
  ) {
    return this.cart.view({ userId: user?.userId ?? null, token: token ?? null });
  }

  @Put('cart/items/:variantId')
  @UseGuards(OptionalUserAuthGuard)
  @ApiBearerAuth()
  @cartTokenHeader
  @ApiParam({ name: 'variantId', format: 'uuid' })
  @ApiOperation({
    summary: 'Set the quantity of a variant in the cart',
    description:
      'A guest without a token gets a new guest cart and its cartToken. 409 OUT_OF_STOCK or INSUFFICIENT_STOCK; 404 for variants that are not on sale.',
  })
  @ApiZodBody(putCartItemRequestSchema)
  @ApiZodResponse(200, cartSchema, 'The cart.')
  @ApiErrors(400, 401, 404, 409, 422)
  put(
    @OptionalUser() user: UserPrincipal | null,
    @Headers('x-cart-token') token: string | undefined,
    @UuidParam('variantId') variantId: string,
    @ZodBody(putCartItemRequestSchema) body: z.infer<typeof putCartItemRequestSchema>,
  ) {
    return this.cart.putItem(
      { userId: user?.userId ?? null, token: token ?? null },
      variantId,
      body.qty,
    );
  }

  @Delete('cart/items/:variantId')
  @UseGuards(OptionalUserAuthGuard)
  @ApiBearerAuth()
  @cartTokenHeader
  @ApiParam({ name: 'variantId', format: 'uuid' })
  @ApiOperation({ summary: 'Remove a variant from the cart' })
  @ApiZodResponse(200, cartSchema, 'The cart.')
  @ApiErrors(401, 404)
  remove(
    @OptionalUser() user: UserPrincipal | null,
    @Headers('x-cart-token') token: string | undefined,
    @UuidParam('variantId') variantId: string,
  ) {
    return this.cart.removeItem({ userId: user?.userId ?? null, token: token ?? null }, variantId);
  }

  @Post('cart/merge')
  @HttpCode(HttpStatus.OK)
  @UseGuards(UserAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({
    summary: 'Merge a guest cart into the signed-in cart (after sign-in)',
    description: 'Quantities add up, capped at 99. Merging the same token twice changes nothing.',
  })
  @ApiZodBody(mergeCartRequestSchema)
  @ApiZodResponse(200, cartSchema, 'The merged cart.')
  @ApiErrors(400, 401)
  merge(
    @CurrentUser() user: UserPrincipal,
    @ZodBody(mergeCartRequestSchema) body: z.infer<typeof mergeCartRequestSchema>,
  ) {
    return this.cart.merge(user.userId, body.cartToken);
  }

  @Post('checkout/quote')
  @UseGuards(UserAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({
    summary: 'Price the cart for an address: per-seller delivery, VAT and totals, valid 15 minutes',
    description:
      '409 CART_NOT_READY (fieldErrors by variant), 422 CART_EMPTY, 422 DELIVERY_UNAVAILABLE (fieldErrors.stores). Client totals are never accepted.',
  })
  @ApiZodBody(quoteRequestSchema)
  @ApiZodResponse(201, quoteSchema, 'The quote.')
  @ApiErrors(400, 401, 404, 409, 422)
  quote(
    @CurrentUser() user: UserPrincipal,
    @ZodBody(quoteRequestSchema) body: z.infer<typeof quoteRequestSchema>,
  ) {
    return this.checkout.quote(user.userId, body.addressId, body.deliveryMethods);
  }

  @Post('orders')
  @UseGuards(UserAuthGuard)
  @ApiBearerAuth()
  @ApiHeader({ name: 'Idempotency-Key', required: true, description: 'Required (docs/07-api.md).' })
  @ApiOperation({
    summary: 'Place an order from a quote: reserves stock and opens a payment',
    description:
      'Stock is reserved for 15 minutes. The order becomes paid only when the payment provider confirms it by verified webhook; poll GET /orders/{id}. The same quote always yields the same order. 409 QUOTE_EXPIRED, QUOTE_STALE, OUT_OF_STOCK; 503 PAYMENT_PROVIDER_UNAVAILABLE (retry: stock stays held).',
  })
  @ApiZodBody(createOrderRequestSchema)
  @ApiZodResponse(201, createOrderResponseSchema, 'The order, waiting for payment.')
  @ApiErrors(400, 401, 404, 409, 503)
  create(
    @CurrentUser() user: UserPrincipal,
    @ZodBody(createOrderRequestSchema) body: z.infer<typeof createOrderRequestSchema>,
    @Headers('idempotency-key') key: string | undefined,
    @Req() req: Request,
  ) {
    return this.checkout.createOrder(user.userId, body.quoteId, key, requestMeta(req));
  }

  @Get('orders')
  @UseGuards(UserAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'My orders, newest first' })
  @ApiZodQuery(orderListQuerySchema)
  @ApiZodResponse(200, pageSchema(orderListItemSchema), 'A page of orders.')
  @ApiErrors(400, 401)
  list(
    @CurrentUser() user: UserPrincipal,
    @ZodQuery(orderListQuerySchema) query: z.infer<typeof orderListQuerySchema>,
  ) {
    return this.orders.listForUser(user.userId, query);
  }

  @Get('orders/:orderId')
  @UseGuards(UserAuthGuard)
  @ApiBearerAuth()
  @ApiParam({ name: 'orderId', format: 'uuid' })
  @ApiOperation({ summary: 'One of my orders, grouped by seller (404 for anyone else)' })
  @ApiZodResponse(200, orderSchema, 'The order.')
  @ApiErrors(401, 404)
  order(@CurrentUser() user: UserPrincipal, @UuidParam('orderId') orderId: string) {
    return this.orders.getForUser(user.userId, orderId);
  }
}
