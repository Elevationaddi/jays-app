import { HttpStatus, Inject, Injectable } from '@nestjs/common';
import type { BrandView, CategoryView } from '@jays/contracts';
import type { Db } from '@jays/db';
import type { Mode } from '@jays/domain';
import { writeAudit } from '../common/audit.js';
import { ApiError } from '../common/error.filter.js';
import type { RequestMeta } from '../common/request-context.js';
import { DB } from '../common/tokens.js';

const notFound = () => new ApiError(HttpStatus.NOT_FOUND, 'NOT_FOUND', 'Not found.');

interface CategoryRow {
  id: string;
  parent_id: string | null;
  mode: Mode;
  slug: string;
  name: { en: string; ar: string };
  depth: number;
  sort_order: number;
  status: 'active' | 'archived';
}

const toCategory = (r: CategoryRow): CategoryView => ({
  id: r.id,
  parentId: r.parent_id,
  mode: r.mode,
  slug: r.slug,
  name: r.name,
  depth: r.depth,
  sortOrder: r.sort_order,
  status: r.status,
});

const CATEGORY_COLUMNS = [
  'id',
  'parent_id',
  'mode',
  'slug',
  'name',
  'depth',
  'sort_order',
  'status',
] as const;

function isPgError(error: unknown, code: string): boolean {
  return typeof error === 'object' && error !== null && (error as { code?: string }).code === code;
}

/** Category taxonomy (both modes) and brands. Public reads see active entries only. */
@Injectable()
export class TaxonomyService {
  constructor(@Inject(DB) private readonly db: Db) {}

  async categories(options: { mode?: Mode; includeArchived?: boolean }) {
    let q = this.db.selectFrom('categories').select(CATEGORY_COLUMNS);
    if (options.mode) q = q.where('mode', '=', options.mode);
    if (!options.includeArchived) q = q.where('status', '=', 'active');
    const rows = await q
      .orderBy('mode')
      .orderBy('depth')
      .orderBy('sort_order')
      .orderBy('slug')
      .execute();
    // A public tree never shows a child whose parent is archived.
    const active = new Set(rows.map((r) => r.id));
    const visible = options.includeArchived
      ? rows
      : rows.filter((r) => r.parent_id === null || active.has(r.parent_id));
    return { items: (visible as CategoryRow[]).map(toCategory) };
  }

  async createCategory(
    adminId: string,
    body: {
      mode: Mode;
      parentId?: string | null | undefined;
      slug: string;
      name: { en: string; ar: string };
      sortOrder?: number | undefined;
    },
    meta: RequestMeta,
  ): Promise<CategoryView> {
    return this.db.transaction().execute(async (trx) => {
      if (body.parentId) {
        const parent = await trx
          .selectFrom('categories')
          .select(['mode', 'depth', 'status'])
          .where('id', '=', body.parentId)
          .executeTakeFirst();
        if (!parent || parent.status !== 'active') {
          throw new ApiError(
            HttpStatus.UNPROCESSABLE_ENTITY,
            'PARENT_INVALID',
            'The parent category is not active.',
          );
        }
        if (parent.mode !== body.mode) {
          throw new ApiError(
            HttpStatus.UNPROCESSABLE_ENTITY,
            'PARENT_INVALID',
            'A subcategory must be in the same mode as its parent.',
          );
        }
        if (parent.depth >= 2) {
          throw new ApiError(
            HttpStatus.UNPROCESSABLE_ENTITY,
            'DEPTH_LIMIT',
            'Categories can be at most three levels deep.',
          );
        }
      }
      let row: CategoryRow;
      try {
        row = (await trx
          .insertInto('categories')
          .values({
            mode: body.mode,
            parent_id: body.parentId ?? null,
            slug: body.slug,
            name: JSON.stringify(body.name),
            sort_order: body.sortOrder ?? 0,
          })
          .returning(CATEGORY_COLUMNS)
          .executeTakeFirstOrThrow()) as CategoryRow;
      } catch (error) {
        if (isPgError(error, '23505')) {
          throw new ApiError(
            HttpStatus.CONFLICT,
            'SLUG_TAKEN',
            'This slug is already used in this mode.',
          );
        }
        throw error;
      }
      await writeAudit(trx, {
        actorType: 'admin',
        actorId: adminId,
        action: 'category.created',
        targetType: 'category',
        targetId: row.id,
        diff: { mode: row.mode, slug: row.slug, parentId: row.parent_id, name: row.name },
        requestId: meta.requestId,
      });
      return toCategory(row);
    });
  }

  async updateCategory(
    adminId: string,
    id: string,
    body: {
      name?: { en: string; ar: string } | undefined;
      sortOrder?: number | undefined;
      status?: 'active' | 'archived' | undefined;
    },
    meta: RequestMeta,
  ): Promise<CategoryView> {
    return this.db.transaction().execute(async (trx) => {
      const before = (await trx
        .selectFrom('categories')
        .select(CATEGORY_COLUMNS)
        .where('id', '=', id)
        .forUpdate()
        .executeTakeFirst()) as CategoryRow | undefined;
      if (!before) throw notFound();
      if (body.status === 'archived' && before.status === 'active') {
        const child = await trx
          .selectFrom('categories')
          .select('id')
          .where('parent_id', '=', id)
          .where('status', '=', 'active')
          .executeTakeFirst();
        if (child) {
          throw new ApiError(
            HttpStatus.CONFLICT,
            'HAS_ACTIVE_CHILDREN',
            'Archive the subcategories first.',
          );
        }
      }
      if (body.status === 'active' && before.parent_id) {
        const parent = await trx
          .selectFrom('categories')
          .select('status')
          .where('id', '=', before.parent_id)
          .executeTakeFirstOrThrow();
        if (parent.status !== 'active') {
          throw new ApiError(
            HttpStatus.CONFLICT,
            'PARENT_INVALID',
            'Restore the parent category first.',
          );
        }
      }
      const row = (await trx
        .updateTable('categories')
        .set({
          ...(body.name ? { name: JSON.stringify(body.name) } : {}),
          ...(body.sortOrder !== undefined ? { sort_order: body.sortOrder } : {}),
          ...(body.status ? { status: body.status } : {}),
        })
        .where('id', '=', id)
        .returning(CATEGORY_COLUMNS)
        .executeTakeFirstOrThrow()) as CategoryRow;
      await writeAudit(trx, {
        actorType: 'admin',
        actorId: adminId,
        action: body.status === 'archived' ? 'category.archived' : 'category.updated',
        targetType: 'category',
        targetId: id,
        diff: {
          before: { name: before.name, sortOrder: before.sort_order, status: before.status },
          after: { name: row.name, sortOrder: row.sort_order, status: row.status },
        },
        requestId: meta.requestId,
      });
      return toCategory(row);
    });
  }

  async brands(includeArchived: boolean) {
    let q = this.db.selectFrom('brands').select(['id', 'slug', 'name', 'status']);
    if (!includeArchived) q = q.where('status', '=', 'active');
    const rows = await q.orderBy('slug').execute();
    return { items: rows.map((r): BrandView => ({ ...r })) };
  }

  async createBrand(
    adminId: string,
    body: { slug: string; name: { en: string; ar: string } },
    meta: RequestMeta,
  ): Promise<BrandView> {
    return this.db.transaction().execute(async (trx) => {
      let row: BrandView;
      try {
        row = await trx
          .insertInto('brands')
          .values({ slug: body.slug, name: JSON.stringify(body.name), created_by: adminId })
          .returning(['id', 'slug', 'name', 'status'])
          .executeTakeFirstOrThrow();
      } catch (error) {
        if (isPgError(error, '23505')) {
          throw new ApiError(HttpStatus.CONFLICT, 'SLUG_TAKEN', 'This brand slug is already used.');
        }
        throw error;
      }
      await writeAudit(trx, {
        actorType: 'admin',
        actorId: adminId,
        action: 'brand.created',
        targetType: 'brand',
        targetId: row.id,
        diff: { slug: row.slug, name: row.name },
        requestId: meta.requestId,
      });
      return row;
    });
  }

  async updateBrand(
    adminId: string,
    id: string,
    body: {
      name?: { en: string; ar: string } | undefined;
      status?: 'active' | 'archived' | undefined;
    },
    meta: RequestMeta,
  ): Promise<BrandView> {
    return this.db.transaction().execute(async (trx) => {
      const before = await trx
        .selectFrom('brands')
        .select(['id', 'slug', 'name', 'status'])
        .where('id', '=', id)
        .forUpdate()
        .executeTakeFirst();
      if (!before) throw notFound();
      const row = await trx
        .updateTable('brands')
        .set({
          ...(body.name ? { name: JSON.stringify(body.name) } : {}),
          ...(body.status ? { status: body.status } : {}),
        })
        .where('id', '=', id)
        .returning(['id', 'slug', 'name', 'status'])
        .executeTakeFirstOrThrow();
      await writeAudit(trx, {
        actorType: 'admin',
        actorId: adminId,
        action: body.status === 'archived' ? 'brand.archived' : 'brand.updated',
        targetType: 'brand',
        targetId: id,
        diff: {
          before: { name: before.name, status: before.status },
          after: { name: row.name, status: row.status },
        },
        requestId: meta.requestId,
      });
      return row;
    });
  }
}
