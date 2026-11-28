import { Controller, Get, HttpStatus, Inject, Res } from '@nestjs/common';
import { ApiOperation, ApiParam, ApiResponse, ApiTags } from '@nestjs/swagger';
import {
  brandListSchema,
  categoryListSchema,
  categoryQuerySchema,
  pageSchema,
  productFacetsQuerySchema,
  productFacetsSchema,
  productListQuerySchema,
  type ProductFacetsQuery,
  publicProductListItemSchema,
  publicProductSchema,
  publicStoreSchema,
  type ProductListQuery,
  storeListQuerySchema,
  type StoreListQuery,
} from '@jays/contracts';
import type { Response } from 'express';
import { z } from 'zod';
import { UuidParam } from '../common/params.js';
import { ApiErrors, ApiZodQuery, ApiZodResponse, ZodQuery } from '../common/zod.js';
import { PublicProductsService } from './public-products.service.js';
import { StoresService } from './stores.service.js';
import { TaxonomyService } from './taxonomy.service.js';

/** Public, anonymous reads. Only approved, active records (docs/07-api.md). */
@ApiTags('catalog')
@Controller()
export class CatalogController {
  constructor(
    @Inject(TaxonomyService) private readonly taxonomy: TaxonomyService,
    @Inject(StoresService) private readonly stores: StoresService,
    @Inject(PublicProductsService) private readonly products: PublicProductsService,
  ) {}

  @Get('products')
  @ApiOperation({
    summary: 'Approved products on sale',
    description:
      'Only approved listings of approved sellers with an active shop mode. Sold-out products are included unless availability=in_stock. Filters: q (title or brand), category (with subcategories), brand, store, price, onSale, minRating. Sorts: newest, price_asc, price_desc, rating (published reviews), popular (units in orders paid in the last 90 days), discount (largest saving).',
  })
  @ApiZodQuery(productListQuerySchema)
  @ApiZodResponse(200, pageSchema(publicProductListItemSchema), 'A page of products.')
  @ApiErrors(400)
  productList(@ZodQuery(productListQuerySchema) query: ProductListQuery) {
    return this.products.list(query);
  }

  @Get('products/facets')
  @ApiOperation({
    summary: 'Filter panel counts for the current filters',
    description: 'Brand counts ignore the brand filter so another brand can still be picked.',
  })
  @ApiZodQuery(productFacetsQuerySchema)
  @ApiZodResponse(200, productFacetsSchema, 'Counts and price range.')
  @ApiErrors(400)
  productFacets(@ZodQuery(productFacetsQuerySchema) query: ProductFacetsQuery) {
    return this.products.facets(query);
  }

  @Get('products/:productId/related')
  @ApiParam({ name: 'productId', format: 'uuid' })
  @ApiOperation({ summary: 'Other products in the same category, in stock and best sellers first' })
  @ApiZodResponse(
    200,
    z.object({ items: z.array(publicProductListItemSchema) }),
    'Up to 8 products.',
  )
  @ApiErrors(404)
  related(@UuidParam('productId') productId: string) {
    return this.products.related(productId);
  }

  @Get('products/:productId')
  @ApiParam({ name: 'productId', format: 'uuid' })
  @ApiOperation({
    summary: 'One approved product with its variants and delivery zones (404 when not public)',
  })
  @ApiZodResponse(200, publicProductSchema, 'The product.')
  @ApiErrors(404)
  product(@UuidParam('productId') productId: string) {
    return this.products.get(productId);
  }

  @Get('categories')
  @ApiOperation({ summary: 'Active category tree for one or both modes' })
  @ApiZodQuery(categoryQuerySchema)
  @ApiZodResponse(200, categoryListSchema, 'Categories, parents before children.')
  @ApiErrors(400)
  categories(@ZodQuery(categoryQuerySchema) query: z.infer<typeof categoryQuerySchema>) {
    return this.taxonomy.categories(query.mode ? { mode: query.mode } : {});
  }

  @Get('brands')
  @ApiOperation({ summary: 'Active brands' })
  @ApiZodResponse(200, brandListSchema, 'Brands by slug.')
  brands() {
    return this.taxonomy.brands(false);
  }

  @Get('stores')
  @ApiOperation({
    summary: 'Approved storefronts',
    description:
      'Only businesses that are approved, published and active in the requested mode. Suspended businesses disappear at once.',
  })
  @ApiZodQuery(storeListQuerySchema)
  @ApiZodResponse(200, pageSchema(publicStoreSchema), 'A page of stores.')
  @ApiErrors(400)
  list(@ZodQuery(storeListQuerySchema) query: StoreListQuery) {
    return this.stores.list(query);
  }

  @Get('stores/:storeId')
  @ApiParam({ name: 'storeId', format: 'uuid' })
  @ApiOperation({ summary: 'One approved storefront (404 when not public)' })
  @ApiZodResponse(200, publicStoreSchema, 'The store.')
  @ApiErrors(404)
  get(@UuidParam('storeId') storeId: string) {
    return this.stores.get(storeId);
  }

  @Get('media/:mediaId')
  @ApiParam({ name: 'mediaId', format: 'uuid' })
  @ApiOperation({
    summary: 'A public storefront or product image (redirects to a short-lived signed URL)',
  })
  @ApiResponse({ status: 302, description: 'Redirect to the image.' })
  @ApiErrors(404)
  async media(@UuidParam('mediaId') mediaId: string, @Res() res: Response) {
    const url =
      (await this.products.mediaRedirect(mediaId)) ?? (await this.stores.mediaRedirect(mediaId));
    res.setHeader('Cache-Control', 'public, max-age=60');
    // Customer apps load these from another origin; a same-origin policy on the redirect blocks the image.
    res.setHeader('Cross-Origin-Resource-Policy', 'cross-origin');
    res.redirect(HttpStatus.FOUND, url);
  }
}
