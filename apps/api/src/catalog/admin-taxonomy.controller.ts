import { Controller, Get, Inject, Patch, Post, Req, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiParam, ApiTags } from '@nestjs/swagger';
import {
  brandListSchema,
  brandSchema,
  categoryListSchema,
  categoryQuerySchema,
  categorySchema,
  createBrandRequestSchema,
  createCategoryRequestSchema,
  updateBrandRequestSchema,
  updateCategoryRequestSchema,
} from '@jays/contracts';
import type { Request } from 'express';
import type { z } from 'zod';
import {
  AdminAuthGuard,
  type AdminPrincipal,
  CurrentAdmin,
  RequirePlatformCapability,
} from '../admin/admin.guard.js';
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
import { TaxonomyService } from './taxonomy.service.js';

/** Category taxonomy and brands (docs/04-admin.md: /admin/content, /admin/products). */
@ApiTags('admin-taxonomy')
@ApiBearerAuth()
@UseGuards(AdminAuthGuard)
@Controller('admin')
export class AdminTaxonomyController {
  constructor(@Inject(TaxonomyService) private readonly taxonomy: TaxonomyService) {}

  @Get('categories')
  @RequirePlatformCapability('taxonomy.manage')
  @ApiOperation({ summary: 'All categories including archived (catalog, superadmin)' })
  @ApiZodQuery(categoryQuerySchema)
  @ApiZodResponse(200, categoryListSchema, 'Categories.')
  @ApiErrors(400, 401, 403)
  categories(@ZodQuery(categoryQuerySchema) query: z.infer<typeof categoryQuerySchema>) {
    return this.taxonomy.categories({
      ...(query.mode ? { mode: query.mode } : {}),
      includeArchived: true,
    });
  }

  @Post('categories')
  @RequirePlatformCapability('taxonomy.manage')
  @ApiOperation({
    summary: 'Add a category or subcategory (at most three levels, same mode as parent)',
  })
  @ApiZodBody(createCategoryRequestSchema)
  @ApiZodResponse(201, categorySchema, 'Created.')
  @ApiErrors(400, 401, 403, 409, 422)
  createCategory(
    @CurrentAdmin() admin: AdminPrincipal,
    @ZodBody(createCategoryRequestSchema) body: z.infer<typeof createCategoryRequestSchema>,
    @Req() req: Request,
  ) {
    return this.taxonomy.createCategory(admin.adminId, body, requestMeta(req));
  }

  @Patch('categories/:categoryId')
  @RequirePlatformCapability('taxonomy.manage')
  @ApiParam({ name: 'categoryId', format: 'uuid' })
  @ApiOperation({ summary: 'Rename, reorder, archive or restore a category' })
  @ApiZodBody(updateCategoryRequestSchema)
  @ApiZodResponse(200, categorySchema, 'Updated.')
  @ApiErrors(400, 401, 403, 404, 409)
  updateCategory(
    @CurrentAdmin() admin: AdminPrincipal,
    @UuidParam('categoryId') id: string,
    @ZodBody(updateCategoryRequestSchema) body: z.infer<typeof updateCategoryRequestSchema>,
    @Req() req: Request,
  ) {
    return this.taxonomy.updateCategory(admin.adminId, id, body, requestMeta(req));
  }

  @Get('brands')
  @RequirePlatformCapability('taxonomy.manage')
  @ApiOperation({ summary: 'All brands including archived (catalog, superadmin)' })
  @ApiZodResponse(200, brandListSchema, 'Brands.')
  @ApiErrors(401, 403)
  brands() {
    return this.taxonomy.brands(true);
  }

  @Post('brands')
  @RequirePlatformCapability('taxonomy.manage')
  @ApiOperation({ summary: 'Add a brand' })
  @ApiZodBody(createBrandRequestSchema)
  @ApiZodResponse(201, brandSchema, 'Created.')
  @ApiErrors(400, 401, 403, 409)
  createBrand(
    @CurrentAdmin() admin: AdminPrincipal,
    @ZodBody(createBrandRequestSchema) body: z.infer<typeof createBrandRequestSchema>,
    @Req() req: Request,
  ) {
    return this.taxonomy.createBrand(admin.adminId, body, requestMeta(req));
  }

  @Patch('brands/:brandId')
  @RequirePlatformCapability('taxonomy.manage')
  @ApiParam({ name: 'brandId', format: 'uuid' })
  @ApiOperation({ summary: 'Rename, archive or restore a brand' })
  @ApiZodBody(updateBrandRequestSchema)
  @ApiZodResponse(200, brandSchema, 'Updated.')
  @ApiErrors(400, 401, 403, 404)
  updateBrand(
    @CurrentAdmin() admin: AdminPrincipal,
    @UuidParam('brandId') id: string,
    @ZodBody(updateBrandRequestSchema) body: z.infer<typeof updateBrandRequestSchema>,
    @Req() req: Request,
  ) {
    return this.taxonomy.updateBrand(admin.adminId, id, body, requestMeta(req));
  }
}
