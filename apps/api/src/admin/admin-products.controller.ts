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
  adminProductDetailSchema,
  adminProductListItemSchema,
  adminProductListQuerySchema,
  pageSchema,
  productActionRequestSchema,
  type AdminProductListQuery,
  type ProductActionRequest,
} from '@jays/contracts';
import { hasPlatformCapability } from '@jays/domain';
import type { Request } from 'express';
import { ApiError } from '../common/error.filter.js';
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
import {
  AdminAuthGuard,
  type AdminPrincipal,
  CurrentAdmin,
  RequirePlatformCapability,
} from './admin.guard.js';
import { AdminProductsService } from './admin-products.service.js';

const productParam = ApiParam({ name: 'productId', format: 'uuid' });

@ApiTags('admin-products')
@ApiBearerAuth()
@UseGuards(AdminAuthGuard)
@Controller('admin/products')
export class AdminProductsController {
  constructor(@Inject(AdminProductsService) private readonly products: AdminProductsService) {}

  @Get()
  @RequirePlatformCapability('products.view')
  @ApiOperation({
    summary: 'Listing review queue and product list',
    description:
      '`status=pending` (default) lists first submissions and pending changes, oldest first.',
  })
  @ApiZodQuery(adminProductListQuerySchema)
  @ApiZodResponse(200, pageSchema(adminProductListItemSchema), 'A page of products.')
  @ApiErrors(400, 401, 403)
  list(@ZodQuery(adminProductListQuerySchema) query: AdminProductListQuery) {
    return this.products.list(query);
  }

  @Get(':productId')
  @RequirePlatformCapability('products.view')
  @productParam
  @ApiOperation({ summary: 'A product with draft, live copy, variants and history' })
  @ApiZodResponse(200, adminProductDetailSchema, 'Product detail.')
  @ApiErrors(401, 403, 404)
  detail(@UuidParam('productId') productId: string) {
    return this.products.detail(productId);
  }

  @Post(':productId/actions')
  @HttpCode(HttpStatus.OK)
  @RequirePlatformCapability('products.view')
  @productParam
  @ApiOperation({
    summary: 'Apply a listing action with a version precondition',
    description:
      'approve, reject (products.review); suspend, reinstate (products.takedown). Reject, suspend and reinstate need a reason. 409 VERSION_CONFLICT or INVALID_TRANSITION.',
  })
  @ApiZodBody(productActionRequestSchema)
  @ApiZodResponse(200, adminProductDetailSchema, 'The product after the action.')
  @ApiErrors(400, 401, 403, 404, 409, 422)
  act(
    @CurrentAdmin() admin: AdminPrincipal,
    @UuidParam('productId') productId: string,
    @ZodBody(productActionRequestSchema) body: ProductActionRequest,
    @Req() req: Request,
  ) {
    const needed =
      body.action === 'approve' || body.action === 'reject'
        ? 'products.review'
        : 'products.takedown';
    if (!hasPlatformCapability(admin.roles, needed)) {
      throw new ApiError(
        HttpStatus.FORBIDDEN,
        'FORBIDDEN',
        'Your admin role does not allow this action.',
      );
    }
    return this.products.act(admin.adminId, productId, body, requestMeta(req));
  }
}
