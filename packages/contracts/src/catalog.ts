import { z } from 'zod';
import { emirateCodeSchema, isoDateTime, modeSchema } from './identity.js';
import { localizedInputSchema } from './onboarding.js';

/** Category taxonomy, brands and public storefronts (docs/02-customer.md, docs/04-admin.md). */

const localized = z.object({ en: z.string(), ar: z.string() });
const slugSchema = z
  .string()
  .trim()
  .toLowerCase()
  .regex(/^[a-z0-9]+(-[a-z0-9]+)*$/, 'lowercase letters, digits and single hyphens')
  .max(60);
const catalogStatus = z.enum(['active', 'archived']);

export const categorySchema = z.object({
  id: z.uuid(),
  parentId: z.uuid().nullable(),
  mode: modeSchema,
  slug: z.string(),
  name: localized,
  depth: z.number().int(),
  sortOrder: z.number().int(),
  status: catalogStatus,
  /** Switched off by an admin: hidden from customers with everything in it, but not archived. */
  enabled: z.boolean(),
});
export type CategoryView = z.infer<typeof categorySchema>;
export const categoryListSchema = z.object({ items: z.array(categorySchema) });

export const categoryQuerySchema = z.strictObject({ mode: modeSchema.optional() });

export const createCategoryRequestSchema = z.strictObject({
  mode: modeSchema,
  parentId: z.uuid().nullable().optional(),
  slug: slugSchema,
  name: localizedInputSchema(1, 80),
  sortOrder: z.number().int().min(0).max(10000).optional(),
});
export const updateCategoryRequestSchema = z
  .strictObject({
    name: localizedInputSchema(1, 80).optional(),
    sortOrder: z.number().int().min(0).max(10000).optional(),
    status: catalogStatus.optional(),
    enabled: z.boolean().optional(),
  })
  .refine((b) => Object.keys(b).length > 0, 'nothing to change');

export const brandSchema = z.object({
  id: z.uuid(),
  slug: z.string(),
  name: localized,
  status: catalogStatus,
});
export type BrandView = z.infer<typeof brandSchema>;
export const brandListSchema = z.object({ items: z.array(brandSchema) });

export const createBrandRequestSchema = z.strictObject({
  slug: slugSchema,
  name: localizedInputSchema(1, 80),
});
export const updateBrandRequestSchema = z
  .strictObject({
    name: localizedInputSchema(1, 80).optional(),
    status: catalogStatus.optional(),
  })
  .refine((b) => Object.keys(b).length > 0, 'nothing to change');

/** A storefront as customers see it: approved, live content only. */
export const publicStoreSchema = z.object({
  id: z.uuid(),
  name: localized,
  description: localized,
  logoUrl: z.url().nullable(),
  bannerUrl: z.url().nullable(),
  /** Modes this business is approved and active for. */
  modes: z.array(modeSchema),
  emirate: emirateCodeSchema.nullable(),
  publishedAt: isoDateTime,
});
export type PublicStore = z.infer<typeof publicStoreSchema>;

export const storeListQuerySchema = z.strictObject({
  mode: modeSchema.optional(),
  emirate: emirateCodeSchema.optional(),
  cursor: z.string().min(1).max(200).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(20),
});
export type StoreListQuery = z.infer<typeof storeListQuerySchema>;
