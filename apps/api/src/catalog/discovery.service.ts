import { Inject, Injectable } from '@nestjs/common';
import type { StockAlert, Wishlist } from '@jays/contracts';
import type { Db } from '@jays/db';
import { availableStock, STOCK_ALERTS_MAX, WISHLIST_MAX } from '@jays/domain';
import { DB } from '../common/tokens.js';
import { conflict, notFound, policy } from './product-views.js';
import { PublicProductsService, purchasableVariants } from './public-products.service.js';

/**
 * Wishlists and back-in-stock alerts (phase 8.6, ADR-0023). Only products that are on sale can
 * be saved or watched. The alert itself is fired by a database trigger on the variant, so every
 * stock path (restock, cancellation, released reservation) is covered.
 */
@Injectable()
export class DiscoveryService {
  constructor(
    @Inject(DB) private readonly db: Db,
    @Inject(PublicProductsService) private readonly products: PublicProductsService,
  ) {}

  async wishlist(userId: string): Promise<Wishlist> {
    const rows = await this.db
      .selectFrom('wishlist_items')
      .select(['product_id', 'created_at'])
      .where('user_id', '=', userId)
      .orderBy('created_at', 'desc')
      .orderBy('product_id')
      .execute();
    const items = await this.products.listItems(rows.map((r) => r.product_id));
    return {
      items: rows.map((r) => ({
        productId: r.product_id,
        addedAt: r.created_at.toISOString(),
        product: items.get(r.product_id) ?? null,
      })),
    };
  }

  async addToWishlist(userId: string, productId: string): Promise<Wishlist> {
    const visible = await this.products.listItems([productId]);
    if (!visible.has(productId)) throw notFound();
    await this.db.transaction().execute(async (trx) => {
      // Serialises one person's concurrent adds so the cap holds.
      await trx.selectFrom('users').select('id').where('id', '=', userId).forUpdate().execute();
      const existing = await trx
        .selectFrom('wishlist_items')
        .select('product_id')
        .where('user_id', '=', userId)
        .where('product_id', '=', productId)
        .executeTakeFirst();
      if (existing) return;
      const { n } = await trx
        .selectFrom('wishlist_items')
        .select((eb) => eb.fn.countAll<number>().as('n'))
        .where('user_id', '=', userId)
        .executeTakeFirstOrThrow();
      if (Number(n) >= WISHLIST_MAX) {
        throw policy('WISHLIST_FULL', `A wishlist holds up to ${WISHLIST_MAX} products.`);
      }
      await trx
        .insertInto('wishlist_items')
        .values({ user_id: userId, product_id: productId })
        .execute();
    });
    return this.wishlist(userId);
  }

  async removeFromWishlist(userId: string, productId: string): Promise<Wishlist> {
    await this.db
      .deleteFrom('wishlist_items')
      .where('user_id', '=', userId)
      .where('product_id', '=', productId)
      .execute();
    return this.wishlist(userId);
  }

  async alerts(userId: string): Promise<{ items: StockAlert[] }> {
    const rows = await this.db
      .selectFrom('stock_alerts as a')
      .innerJoin('variants as v', 'v.id', 'a.variant_id')
      .select(['a.id', 'a.variant_id', 'v.product_id', 'a.created_at'])
      .where('a.user_id', '=', userId)
      .where('a.notified_at', 'is', null)
      .orderBy('a.created_at', 'desc')
      .orderBy('a.id')
      .execute();
    return {
      items: rows.map((r) => ({
        id: r.id,
        variantId: r.variant_id,
        productId: r.product_id,
        createdAt: r.created_at.toISOString(),
      })),
    };
  }

  async addAlert(userId: string, variantId: string): Promise<{ items: StockAlert[] }> {
    await this.db.transaction().execute(async (trx) => {
      await trx.selectFrom('users').select('id').where('id', '=', userId).forUpdate().execute();
      const [variant] = await purchasableVariants(trx, [variantId]);
      if (!variant) throw notFound();
      if (availableStock({ onHand: variant.stock_on_hand, reserved: variant.stock_reserved }) > 0) {
        throw conflict('IN_STOCK', 'This option is in stock. Add it to your bag instead.');
      }
      const open = await trx
        .selectFrom('stock_alerts')
        .select(['variant_id'])
        .where('user_id', '=', userId)
        .where('notified_at', 'is', null)
        .execute();
      if (open.some((a) => a.variant_id === variantId)) return;
      if (open.length >= STOCK_ALERTS_MAX) {
        throw policy('STOCK_ALERTS_FULL', `You can watch up to ${STOCK_ALERTS_MAX} items.`);
      }
      await trx
        .insertInto('stock_alerts')
        .values({ user_id: userId, variant_id: variantId })
        .execute();
    });
    return this.alerts(userId);
  }

  async removeAlert(userId: string, variantId: string): Promise<{ items: StockAlert[] }> {
    await this.db
      .deleteFrom('stock_alerts')
      .where('user_id', '=', userId)
      .where('variant_id', '=', variantId)
      .where('notified_at', 'is', null)
      .execute();
    return this.alerts(userId);
  }
}
