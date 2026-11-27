import {
  Controller,
  Get,
  Headers,
  HttpCode,
  HttpStatus,
  Inject,
  Patch,
  Post,
  Put,
  Req,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiHeader, ApiOperation, ApiParam, ApiTags } from '@nestjs/swagger';
import {
  createProductRequestSchema,
  deliveryZoneListSchema,
  inventoryItemSchema,
  inventoryListQuerySchema,
  mediaSchema,
  merchantOrderListItemSchema,
  merchantOrderListQuerySchema,
  merchantOrderSchema,
  merchantProductListItemSchema,
  merchantProductListQuerySchema,
  merchantProductSchema,
  merchantVariantSchema,
  pageSchema,
  productImageUploadRequestSchema,
  putDeliveryZonesRequestSchema,
  stockAdjustRequestSchema,
  stockMovementSchema,
  updateProductRequestSchema,
  updateVariantRequestSchema,
  uploadTicketSchema,
  variantInputSchema,
  type CreateProductRequest,
  type InventoryListQuery,
  type MerchantOrderListQuery,
  type MerchantProductListQuery,
  type PutDeliveryZonesRequest,
  type StockAdjustRequest,
  type UpdateProductRequest,
  type UpdateVariantRequest,
  type VariantInput,
} from '@jays/contracts';
import type { Request } from 'express';
import type { z } from 'zod';
import { CurrentUser, UserAuthGuard, type UserPrincipal } from '../auth/guards.js';
import {
  BusinessAccessGuard,
  type BusinessContext,
  CurrentBusiness,
  RequireBusinessCapability,
} from '../businesses/business-access.guard.js';
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
import { OrdersService } from '../commerce/orders.service.js';
import { OnboardingService } from '../onboarding/onboarding.service.js';
import { InventoryService } from './inventory.service.js';
import { ProductsService } from './products.service.js';

const businessParam = ApiParam({ name: 'businessId', format: 'uuid' });
const idempotencyHeader = ApiHeader({
  name: 'Idempotency-Key',
  required: true,
  description:
    '8–128 letters, digits, dashes or underscores. Retries with the same key and body return the first response.',
});

/**
 * Merchant product catalog, inventory, delivery zones and suborders (docs/03-business.md, shop
 * sidebar). Tenant isolation comes from BusinessAccessGuard: business context is the caller's
 * verified membership, and every query is scoped to it.
 */
@ApiTags('business-catalog')
@ApiBearerAuth()
@UseGuards(UserAuthGuard, BusinessAccessGuard)
@Controller('businesses/:businessId')
export class BusinessCatalogController {
  constructor(
    @Inject(ProductsService) private readonly products: ProductsService,
    @Inject(InventoryService) private readonly inventory: InventoryService,
    @Inject(OrdersService) private readonly orders: OrdersService,
    @Inject(OnboardingService) private readonly onboarding: OnboardingService,
  ) {}

  @Get('products')
  @RequireBusinessCapability('catalog.manage')
  @businessParam
  @ApiOperation({ summary: 'Products of this business, newest first (owner, manager)' })
  @ApiZodQuery(merchantProductListQuerySchema)
  @ApiZodResponse(200, pageSchema(merchantProductListItemSchema), 'A page of products.')
  @ApiErrors(400, 401, 403, 404)
  list(
    @CurrentBusiness() ctx: BusinessContext,
    @ZodQuery(merchantProductListQuerySchema) query: MerchantProductListQuery,
  ) {
    return this.products.list(ctx.businessId, query);
  }

  @Post('products')
  @RequireBusinessCapability('catalog.manage')
  @businessParam
  @ApiOperation({
    summary: 'Create a draft product with its variants (owner, manager)',
    description:
      'Starts as a draft; submit it for admin review to list it. SKUs are unique per business (409 SKU_TAKEN). Stock starts at zero: use inventory adjustments.',
  })
  @ApiZodBody(createProductRequestSchema)
  @ApiZodResponse(201, merchantProductSchema, 'The draft product.')
  @ApiErrors(400, 401, 403, 404, 409, 422)
  create(
    @CurrentBusiness() ctx: BusinessContext,
    @CurrentUser() user: UserPrincipal,
    @ZodBody(createProductRequestSchema) body: CreateProductRequest,
    @Req() req: Request,
  ) {
    return this.products.create(ctx, user.userId, body, requestMeta(req));
  }

  @Get('products/:productId')
  @RequireBusinessCapability('catalog.manage')
  @businessParam
  @ApiParam({ name: 'productId', format: 'uuid' })
  @ApiOperation({ summary: 'A product with draft, live copy and variants (owner, manager)' })
  @ApiZodResponse(200, merchantProductSchema, 'The product.')
  @ApiErrors(401, 403, 404)
  get(@CurrentBusiness() ctx: BusinessContext, @UuidParam('productId') productId: string) {
    return this.products.view(ctx.businessId, productId);
  }

  @Patch('products/:productId')
  @RequireBusinessCapability('catalog.manage')
  @businessParam
  @ApiParam({ name: 'productId', format: 'uuid' })
  @ApiOperation({
    summary: 'Edit product content (owner, manager)',
    description:
      'On a published listing the edits wait for admin review while the live copy stays public. 409 PRODUCT_IN_REVIEW during a first review.',
  })
  @ApiZodBody(updateProductRequestSchema)
  @ApiZodResponse(200, merchantProductSchema, 'The product.')
  @ApiErrors(400, 401, 403, 404, 409, 422)
  update(
    @CurrentBusiness() ctx: BusinessContext,
    @CurrentUser() user: UserPrincipal,
    @UuidParam('productId') productId: string,
    @ZodBody(updateProductRequestSchema) body: UpdateProductRequest,
    @Req() req: Request,
  ) {
    return this.products.update(ctx, user.userId, productId, body, requestMeta(req));
  }

  @Post('products/:productId/submit')
  @HttpCode(HttpStatus.OK)
  @RequireBusinessCapability('catalog.manage')
  @businessParam
  @ApiParam({ name: 'productId', format: 'uuid' })
  @ApiOperation({
    summary: 'Submit a draft or rejected product for listing review (owner, manager)',
    description: '422 PRODUCT_INCOMPLETE lists what is missing in fieldErrors.checklist.',
  })
  @ApiZodResponse(200, merchantProductSchema, 'The product, now submitted.')
  @ApiErrors(401, 403, 404, 409, 422)
  submit(
    @CurrentBusiness() ctx: BusinessContext,
    @CurrentUser() user: UserPrincipal,
    @UuidParam('productId') productId: string,
    @Req() req: Request,
  ) {
    return this.products.submit(ctx, user.userId, productId, requestMeta(req));
  }

  @Post('products/:productId/archive')
  @HttpCode(HttpStatus.OK)
  @RequireBusinessCapability('catalog.manage')
  @businessParam
  @ApiParam({ name: 'productId', format: 'uuid' })
  @ApiOperation({ summary: 'Archive a product; history and past orders are kept (owner, manager)' })
  @ApiZodResponse(200, merchantProductSchema, 'The archived product.')
  @ApiErrors(401, 403, 404)
  archive(
    @CurrentBusiness() ctx: BusinessContext,
    @CurrentUser() user: UserPrincipal,
    @UuidParam('productId') productId: string,
    @Req() req: Request,
  ) {
    return this.products.archive(ctx, user.userId, productId, requestMeta(req));
  }

  @Post('products/:productId/variants')
  @RequireBusinessCapability('catalog.manage')
  @businessParam
  @ApiParam({ name: 'productId', format: 'uuid' })
  @ApiOperation({ summary: 'Add a variant (owner, manager)' })
  @ApiZodBody(variantInputSchema)
  @ApiZodResponse(201, merchantVariantSchema, 'The variant.')
  @ApiErrors(400, 401, 403, 404, 409, 422)
  addVariant(
    @CurrentBusiness() ctx: BusinessContext,
    @CurrentUser() user: UserPrincipal,
    @UuidParam('productId') productId: string,
    @ZodBody(variantInputSchema) body: VariantInput,
    @Req() req: Request,
  ) {
    return this.products.addVariant(ctx, user.userId, productId, body, requestMeta(req));
  }

  @Patch('variants/:variantId')
  @RequireBusinessCapability('catalog.manage')
  @businessParam
  @ApiParam({ name: 'variantId', format: 'uuid' })
  @ApiOperation({
    summary: 'Change a variant: price, tax class, details, archive (owner, manager)',
    description: 'Applies at once. Existing orders keep the price they were placed at.',
  })
  @ApiZodBody(updateVariantRequestSchema)
  @ApiZodResponse(200, merchantVariantSchema, 'The variant.')
  @ApiErrors(400, 401, 403, 404, 409, 422)
  updateVariant(
    @CurrentBusiness() ctx: BusinessContext,
    @CurrentUser() user: UserPrincipal,
    @UuidParam('variantId') variantId: string,
    @ZodBody(updateVariantRequestSchema) body: UpdateVariantRequest,
    @Req() req: Request,
  ) {
    return this.products.updateVariant(ctx, user.userId, variantId, body, requestMeta(req));
  }

  @Post('product-images')
  @RequireBusinessCapability('catalog.manage')
  @businessParam
  @ApiOperation({
    summary: 'Start a product image upload; returns a signed PUT URL (owner, manager)',
    description: 'JPEG, PNG or WebP up to 5 MB, at least 600×600, aspect ratio 1:2 to 2:1.',
  })
  @ApiZodBody(productImageUploadRequestSchema)
  @ApiZodResponse(201, uploadTicketSchema, 'Upload ticket.')
  @ApiErrors(400, 401, 403, 404, 429)
  createImage(
    @CurrentBusiness() ctx: BusinessContext,
    @CurrentUser() user: UserPrincipal,
    @ZodBody(productImageUploadRequestSchema) body: z.infer<typeof productImageUploadRequestSchema>,
  ) {
    return this.onboarding.createMediaUpload(ctx, user.userId, {
      ...body,
      purpose: 'product_image',
    });
  }

  @Post('product-images/:mediaId/complete')
  @HttpCode(HttpStatus.OK)
  @RequireBusinessCapability('catalog.manage')
  @businessParam
  @ApiParam({ name: 'mediaId', format: 'uuid' })
  @ApiOperation({ summary: 'Check an uploaded product image: type, size, dimensions, malware' })
  @ApiZodResponse(200, mediaSchema, 'The image, now ready.')
  @ApiErrors(401, 403, 404, 409, 422)
  completeImage(
    @CurrentBusiness() ctx: BusinessContext,
    @CurrentUser() user: UserPrincipal,
    @UuidParam('mediaId') mediaId: string,
    @Req() req: Request,
  ) {
    return this.onboarding.completeMedia(ctx, user.userId, mediaId, requestMeta(req));
  }

  @Get('inventory')
  @RequireBusinessCapability('inventory.adjust')
  @businessParam
  @ApiOperation({
    summary: 'Stock on hand, reserved and available per variant (owner, manager, fulfillment)',
  })
  @ApiZodQuery(inventoryListQuerySchema)
  @ApiZodResponse(200, pageSchema(inventoryItemSchema), 'A page of inventory.')
  @ApiErrors(400, 401, 403, 404)
  inventoryList(
    @CurrentBusiness() ctx: BusinessContext,
    @ZodQuery(inventoryListQuerySchema) query: InventoryListQuery,
  ) {
    return this.inventory.list(ctx.businessId, query);
  }

  @Post('inventory/adjust')
  @HttpCode(HttpStatus.OK)
  @RequireBusinessCapability('inventory.adjust')
  @businessParam
  @idempotencyHeader
  @ApiOperation({
    summary: 'Adjust stock on hand with a reason (owner, manager, fulfillment)',
    description:
      'Transactional and idempotent. Stock on hand can never fall below reserved stock: 409 INSUFFICIENT_STOCK.',
  })
  @ApiZodBody(stockAdjustRequestSchema)
  @ApiZodResponse(200, inventoryItemSchema, 'The variant after the change.')
  @ApiErrors(400, 401, 403, 404, 409, 422)
  adjust(
    @CurrentBusiness() ctx: BusinessContext,
    @CurrentUser() user: UserPrincipal,
    @ZodBody(stockAdjustRequestSchema) body: StockAdjustRequest,
    @Headers('idempotency-key') key: string | undefined,
    @Req() req: Request,
  ) {
    return this.inventory.adjust(ctx, user.userId, body, key, requestMeta(req));
  }

  @Get('inventory/:variantId/movements')
  @RequireBusinessCapability('inventory.adjust')
  @businessParam
  @ApiParam({ name: 'variantId', format: 'uuid' })
  @ApiOperation({ summary: 'Stock movement history of a variant, newest first' })
  @ApiZodQuery(listQuerySchema)
  @ApiZodResponse(200, pageSchema(stockMovementSchema), 'A page of movements.')
  @ApiErrors(400, 401, 403, 404)
  movements(
    @CurrentBusiness() ctx: BusinessContext,
    @UuidParam('variantId') variantId: string,
    @ZodQuery(listQuerySchema) query: ListQuery,
  ) {
    return this.inventory.movements(ctx.businessId, variantId, query);
  }

  @Get('delivery-zones')
  @RequireBusinessCapability('storefront.manage')
  @businessParam
  @ApiOperation({ summary: 'Delivery zones and fees per emirate (owner, manager)' })
  @ApiZodResponse(200, deliveryZoneListSchema, 'Zones.')
  @ApiErrors(401, 403, 404)
  zones(@CurrentBusiness() ctx: BusinessContext) {
    return this.inventory.zones(ctx.businessId);
  }

  @Put('delivery-zones')
  @RequireBusinessCapability('storefront.manage')
  @businessParam
  @ApiOperation({
    summary: 'Replace the delivery zones (owner, manager)',
    description: 'One zone per emirate. Checkout refuses addresses in emirates without a zone.',
  })
  @ApiZodBody(putDeliveryZonesRequestSchema)
  @ApiZodResponse(200, deliveryZoneListSchema, 'Zones.')
  @ApiErrors(400, 401, 403, 404)
  putZones(
    @CurrentBusiness() ctx: BusinessContext,
    @CurrentUser() user: UserPrincipal,
    @ZodBody(putDeliveryZonesRequestSchema) body: PutDeliveryZonesRequest,
    @Req() req: Request,
  ) {
    return this.inventory.putZones(ctx, user.userId, body, requestMeta(req));
  }

  @Get('orders')
  @RequireBusinessCapability('orders.fulfill')
  @businessParam
  @ApiOperation({
    summary: "This business's suborders, newest first (owner, manager, fulfillment)",
  })
  @ApiZodQuery(merchantOrderListQuerySchema)
  @ApiZodResponse(200, pageSchema(merchantOrderListItemSchema), 'A page of suborders.')
  @ApiErrors(400, 401, 403, 404)
  orderList(
    @CurrentBusiness() ctx: BusinessContext,
    @ZodQuery(merchantOrderListQuerySchema) query: MerchantOrderListQuery,
  ) {
    return this.orders.listForBusiness(ctx.businessId, query);
  }

  @Get('orders/:merchantOrderId')
  @RequireBusinessCapability('orders.fulfill')
  @businessParam
  @ApiParam({ name: 'merchantOrderId', format: 'uuid' })
  @ApiOperation({ summary: 'One suborder with its items and delivery address' })
  @ApiZodResponse(200, merchantOrderSchema, 'The suborder.')
  @ApiErrors(401, 403, 404)
  order(@CurrentBusiness() ctx: BusinessContext, @UuidParam('merchantOrderId') id: string) {
    return this.orders.getForBusiness(ctx.businessId, id);
  }
}
