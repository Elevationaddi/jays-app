import { createHash, randomBytes } from 'node:crypto';
import { HttpStatus, Inject, Injectable } from '@nestjs/common';
import type { CartView } from '@jays/contracts';
import type { Database, Db } from '@jays/db';
import {
  availableStock,
  BLOCKING_ISSUES,
  CART_MAX_LINES,
  CART_MAX_QTY,
  cartLineIssues,
} from '@jays/domain';
import { sql, type Transaction } from 'kysely';
import { ApiError } from '../common/error.filter.js';
import { DB } from '../common/tokens.js';
import { notFound } from '../catalog/product-views.js';
import { PublicProductsService, purchasableVariants } from '../catalog/public-products.service.js';

type Trx = Transaction<Database>;
type Conn = Db | Trx;
type Localized = { en: string; ar: string };

export interface CartOwner {
  userId: string | null;
  /** Guest cart token from the X-Cart-Token header. */
  token: string | null;
}

export const hashCartToken = (token: string) => createHash('sha256').update(token).digest('hex');
const TOKEN = /^[A-Za-z0-9_-]{43}$/;

/**
 * Carts (docs/02-customer.md: /shop/cart). Guests get a cart addressed by an opaque token; signing
 * in merges it into the account's cart (T01). The cart is never cleared by switching mode. Every
 * view is repriced on the server and flags stale lines.
 */
@Injectable()
export class CartService {
  constructor(
    @Inject(DB) private readonly db: Db,
    @Inject(PublicProductsService) private readonly products: PublicProductsService,
  ) {}

  private async findCart(conn: Conn, owner: CartOwner): Promise<{ id: string } | undefined> {
    if (owner.userId) {
      return conn
        .selectFrom('carts')
        .select('id')
        .where('user_id', '=', owner.userId)
        .where('status', '=', 'active')
        .executeTakeFirst();
    }
    if (owner.token && TOKEN.test(owner.token)) {
      return conn
        .selectFrom('carts')
        .select('id')
        .where('guest_token_hash', '=', hashCartToken(owner.token))
        .where('status', '=', 'active')
        .executeTakeFirst();
    }
    return undefined;
  }

  /** The user's active cart, created on first use (one per user, enforced by a unique index). */
  async userCartId(conn: Conn, userId: string): Promise<string> {
    await conn
      .insertInto('carts')
      .values({ user_id: userId })
      .onConflict((oc) => oc.column('user_id').where('status', '=', 'active').doNothing())
      .execute();
    const row = await conn
      .selectFrom('carts')
      .select('id')
      .where('user_id', '=', userId)
      .where('status', '=', 'active')
      .executeTakeFirstOrThrow();
    return row.id;
  }

  async view(owner: CartOwner, issuedToken: string | null = null): Promise<CartView> {
    const cart = await this.findCart(this.db, owner);
    const cartToken = owner.userId ? null : (issuedToken ?? (cart ? owner.token : null));
    if (!cart) return this.empty(cartToken);
    return this.viewOf(cart.id, cartToken);
  }

  private empty(cartToken: string | null): CartView {
    return {
      cartToken,
      groups: [],
      itemCount: 0,
      subtotalFils: 0,
      currency: 'AED',
      checkoutReady: false,
    };
  }

  async viewOf(cartId: string, cartToken: string | null): Promise<CartView> {
    const items = await this.db
      .selectFrom('cart_items as ci')
      .innerJoin('variants as v', 'v.id', 'ci.variant_id')
      .innerJoin('products as p', 'p.id', 'v.product_id')
      .leftJoin('storefronts as s', 's.business_id', 'v.business_id')
      .innerJoin('businesses as b', 'b.id', 'v.business_id')
      .select([
        'ci.variant_id',
        'ci.qty',
        'ci.price_seen_fils',
        'v.product_id',
        'v.business_id',
        'v.name as variant_name',
        'v.price_fils',
        'v.stock_on_hand',
        'v.stock_reserved',
        'p.title',
        'p.live_title',
        'p.live_media_ids',
        's.live_name',
        'b.display_name',
      ])
      .where('ci.cart_id', '=', cartId)
      .orderBy('ci.created_at')
      .orderBy('ci.id')
      .execute();
    if (items.length === 0) return this.empty(cartToken);
    const purchasable = new Set(
      (
        await purchasableVariants(
          this.db,
          items.map((i) => i.variant_id),
        )
      ).map((v) => v.id),
    );
    const groups = new Map<string, CartView['groups'][number]>();
    let ready = true;
    for (const i of items) {
      const available = availableStock({ onHand: i.stock_on_hand, reserved: i.stock_reserved });
      const ok = purchasable.has(i.variant_id);
      const issues = cartLineIssues({
        purchasable: ok,
        qty: i.qty,
        available,
        priceFils: i.price_fils,
        priceSeenFils: i.price_seen_fils,
      });
      if (issues.some((x) => BLOCKING_ISSUES.includes(x))) ready = false;
      const group = groups.get(i.business_id) ?? {
        store: { id: i.business_id, name: (i.live_name ?? i.display_name) as Localized },
        lines: [],
        subtotalFils: 0,
      };
      const lineTotal = i.price_fils * i.qty;
      group.lines.push({
        variantId: i.variant_id,
        productId: i.product_id,
        title: (i.live_title ?? i.title) as Localized,
        variantName: i.variant_name,
        imageUrl: ok ? this.products.mediaUrl(i.live_media_ids[0]) : null,
        qty: i.qty,
        unitPriceFils: i.price_fils,
        priceSeenFils: i.price_seen_fils,
        lineTotalFils: lineTotal,
        inStock: ok && available > 0,
        issues,
      });
      if (ok) group.subtotalFils += lineTotal;
      groups.set(i.business_id, group);
    }
    const list = [...groups.values()];
    return {
      cartToken,
      groups: list,
      itemCount: items.reduce((n, i) => n + i.qty, 0),
      subtotalFils: list.reduce((n, g) => n + g.subtotalFils, 0),
      currency: 'AED',
      checkoutReady: ready,
    };
  }

  /** Sets a line's quantity. Out-of-stock or hidden variants cannot be added. */
  async putItem(owner: CartOwner, variantId: string, qty: number): Promise<CartView> {
    if (!Number.isSafeInteger(qty) || qty < 1 || qty > CART_MAX_QTY) {
      throw new ApiError(
        HttpStatus.BAD_REQUEST,
        'VALIDATION_FAILED',
        'The quantity is not valid.',
        {
          qty: [`must be 1 to ${CART_MAX_QTY}`],
        },
      );
    }
    const [variant] = await purchasableVariants(this.db, [variantId]);
    if (!variant) throw notFound();
    const available = availableStock({
      onHand: variant.stock_on_hand,
      reserved: variant.stock_reserved,
    });
    if (available === 0) {
      throw new ApiError(HttpStatus.CONFLICT, 'OUT_OF_STOCK', 'This item is out of stock.');
    }
    if (qty > available) {
      throw new ApiError(
        HttpStatus.CONFLICT,
        'INSUFFICIENT_STOCK',
        `Only ${available} available.`,
        { qty: [`at most ${available} available`] },
      );
    }
    let issued: string | null = null;
    const cartId = await this.db.transaction().execute(async (trx) => {
      let id: string;
      if (owner.userId) {
        id = await this.userCartId(trx, owner.userId);
      } else {
        const existing = await this.findCart(trx, owner);
        if (existing) {
          id = existing.id;
        } else {
          issued = randomBytes(32).toString('base64url');
          id = (
            await trx
              .insertInto('carts')
              .values({ guest_token_hash: hashCartToken(issued) })
              .returning('id')
              .executeTakeFirstOrThrow()
          ).id;
        }
      }
      // Serialize writers on this cart, then check the line limit.
      await trx.selectFrom('carts').select('id').where('id', '=', id).forUpdate().execute();
      const count = await trx
        .selectFrom('cart_items')
        .select((eb) => eb.fn.countAll<string>().as('n'))
        .where('cart_id', '=', id)
        .where('variant_id', '<>', variantId)
        .executeTakeFirstOrThrow();
      if (Number(count.n) >= CART_MAX_LINES) {
        throw new ApiError(
          HttpStatus.UNPROCESSABLE_ENTITY,
          'CART_FULL',
          `A cart holds ${CART_MAX_LINES} different items.`,
        );
      }
      await trx
        .insertInto('cart_items')
        .values({ cart_id: id, variant_id: variantId, qty, price_seen_fils: variant.price_fils })
        .onConflict((oc) =>
          oc
            .columns(['cart_id', 'variant_id'])
            .doUpdateSet({ qty, price_seen_fils: variant.price_fils }),
        )
        .execute();
      return id;
    });
    return this.viewOf(cartId, owner.userId ? null : (issued ?? owner.token));
  }

  async removeItem(owner: CartOwner, variantId: string): Promise<CartView> {
    const cart = await this.findCart(this.db, owner);
    if (cart) {
      await this.db
        .deleteFrom('cart_items')
        .where('cart_id', '=', cart.id)
        .where('variant_id', '=', variantId)
        .execute();
    }
    return this.view(owner);
  }

  /** Merges a guest cart into the signed-in user's cart (T01). Quantities add up, capped. */
  async merge(userId: string, token: string): Promise<CartView> {
    const cartId = await this.db.transaction().execute(async (trx) => {
      const target = await this.userCartId(trx, userId);
      const guest = await trx
        .selectFrom('carts')
        .select(['id', 'status'])
        .where('guest_token_hash', '=', hashCartToken(token))
        .forUpdate()
        .executeTakeFirst();
      if (!guest || guest.status !== 'active') return target;
      await trx.selectFrom('carts').select('id').where('id', '=', target).forUpdate().execute();
      await sql`
        INSERT INTO cart_items (cart_id, variant_id, qty, price_seen_fils)
        SELECT ${target}::uuid, g.variant_id, g.qty, g.price_seen_fils
          FROM cart_items g WHERE g.cart_id = ${guest.id}::uuid
        ON CONFLICT (cart_id, variant_id)
        DO UPDATE SET qty = least(${CART_MAX_QTY}, cart_items.qty + excluded.qty),
                      price_seen_fils = excluded.price_seen_fils`.execute(trx);
      await trx
        .updateTable('carts')
        .set({ status: 'merged', merged_into: target })
        .where('id', '=', guest.id)
        .execute();
      return target;
    });
    return this.viewOf(cartId, null);
  }
}
