import type { Database } from '@jays/db';
import { nonReturnableCategories } from '@jays/domain';
import type { Kysely, Transaction } from 'kysely';

type Conn = Kysely<Database> | Transaction<Database>;

/**
 * Category ids whose items cannot be returned (unless faulty): those an admin marked
 * non-returnable, with every category beneath them (ADR-0029). The category table is small.
 */
export async function nonReturnableCategoryIds(conn: Conn): Promise<Set<string>> {
  const rows = await conn
    .selectFrom('categories')
    .select(['id', 'parent_id', 'returnable'])
    .where('mode', '=', 'shop')
    .execute();
  return nonReturnableCategories(
    rows.map((r) => ({ id: r.id, parentId: r.parent_id, returnable: r.returnable })),
  );
}
