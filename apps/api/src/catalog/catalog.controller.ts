import { Controller, Get, HttpStatus, Inject, Res } from '@nestjs/common';
import { ApiOperation, ApiParam, ApiResponse, ApiTags } from '@nestjs/swagger';
import {
  brandListSchema,
  categoryListSchema,
  categoryQuerySchema,
  pageSchema,
  publicStoreSchema,
  storeListQuerySchema,
  type StoreListQuery,
} from '@jays/contracts';
import type { Response } from 'express';
import type { z } from 'zod';
import { UuidParam } from '../common/params.js';
import { ApiErrors, ApiZodQuery, ApiZodResponse, ZodQuery } from '../common/zod.js';
import { StoresService } from './stores.service.js';
import { TaxonomyService } from './taxonomy.service.js';

/** Public, anonymous reads. Only approved, active records (docs/07-api.md). */
@ApiTags('catalog')
@Controller()
export class CatalogController {
  constructor(
    @Inject(TaxonomyService) private readonly taxonomy: TaxonomyService,
    @Inject(StoresService) private readonly stores: StoresService,
  ) {}

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
  @ApiOperation({ summary: 'A public storefront image (redirects to a short-lived signed URL)' })
  @ApiResponse({ status: 302, description: 'Redirect to the image.' })
  @ApiErrors(404)
  async media(@UuidParam('mediaId') mediaId: string, @Res() res: Response) {
    const url = await this.stores.mediaRedirect(mediaId);
    res.setHeader('Cache-Control', 'public, max-age=60');
    // Customer apps load these from another origin; a same-origin policy on the redirect blocks the image.
    res.setHeader('Cross-Origin-Resource-Policy', 'cross-origin');
    res.redirect(HttpStatus.FOUND, url);
  }
}
