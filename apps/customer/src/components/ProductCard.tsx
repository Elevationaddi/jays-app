import type { PublicProduct, PublicProductListItem } from '@jays/contracts';
import { colors, minTouchTarget, radius, spacing } from '@jays/ui';
import { Image, Pressable, StyleSheet, Text, View } from 'react-native';
import { useApp } from '../context';
import { money } from '../format';
import { Heart } from './Heart';

/** The tile view of a product detail (recently viewed products are fetched one by one). */
export function toListItem(p: PublicProduct): PublicProductListItem {
  const prices = p.variants.map((v) => v.priceFils);
  const cheapest = [...p.variants].sort((a, b) => a.priceFils - b.priceFils)[0];
  const discounts = p.variants.map((v) => v.discountPercent ?? 0);
  const best = Math.max(0, ...discounts);
  return {
    id: p.id,
    title: p.title,
    brand: p.brand,
    store: p.store,
    categoryId: p.categoryId,
    imageUrl: p.images[0] ?? null,
    priceFromFils: prices.length ? Math.min(...prices) : 0,
    priceToFils: prices.length ? Math.max(...prices) : 0,
    compareAtFils: cheapest?.compareAtFils ?? null,
    discountPercent: best > 0 ? best : null,
    rating: p.rating,
    currency: 'AED',
    inStock: p.inStock,
    publishedAt: p.publishedAt,
  };
}

/** Stars and review count, e.g. "★ 4.6 (12)". */
export function RatingLine({
  rating,
  large,
}: {
  rating: { average: number; count: number } | null;
  large?: boolean;
}) {
  const { state, tr } = useApp();
  if (!rating) return null;
  const average = rating.average.toLocaleString(state.locale === 'ar' ? 'ar-AE' : 'en-AE', {
    minimumFractionDigits: 1,
    maximumFractionDigits: 1,
  });
  return (
    <Text
      style={[styles.rating, large && { fontSize: 16 }]}
      accessibilityLabel={tr('rating.label', { average, count: rating.count })}
    >
      ★ {average} <Text style={styles.muted}>({rating.count})</Text>
    </Text>
  );
}

/** A product tile: cover image, sale badge, wishlist heart, title, store, rating, price and stock. */
export function ProductCard({ product }: { product: PublicProductListItem }) {
  const { state, dispatch, tr } = useApp();
  const price =
    product.priceFromFils === product.priceToFils
      ? money(product.priceFromFils, state.locale)
      : tr('products.priceFrom', { price: money(product.priceFromFils, state.locale) });
  const title = product.title[state.locale];
  const was = product.compareAtFils ? money(product.compareAtFils, state.locale) : null;
  return (
    <View style={styles.card}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={[
          title,
          price,
          was ? tr('sale.wasLabel', { price: was }) : null,
          product.inStock ? null : tr('shop.outOfStock'),
        ]
          .filter(Boolean)
          .join(', ')}
        onPress={() => dispatch({ type: 'openProduct', productId: product.id })}
        style={({ pressed }) => [pressed && { opacity: 0.85 }]}
      >
        {product.imageUrl ? (
          <Image source={{ uri: product.imageUrl }} style={styles.image} alt="" />
        ) : (
          <View style={[styles.image, { backgroundColor: '#F3ECF1' }]} />
        )}
        {product.discountPercent ? (
          <View style={styles.badge}>
            <Text style={styles.badgeText}>
              {tr('sale.badge', { percent: product.discountPercent })}
            </Text>
          </View>
        ) : null}
        <View style={styles.body}>
          {product.brand ? (
            <Text style={styles.brand} numberOfLines={1}>
              {product.brand.name[state.locale]}
            </Text>
          ) : null}
          <Text style={styles.title} numberOfLines={2}>
            {title}
          </Text>
          <Text style={styles.store} numberOfLines={1}>
            {product.store.name[state.locale]}
          </Text>
          <RatingLine rating={product.rating} />
          <View style={styles.priceRow}>
            <Text style={[styles.price, was && { color: colors.danger }]}>{price}</Text>
            {was ? <Text style={styles.was}>{was}</Text> : null}
          </View>
          {!product.inStock ? <Text style={styles.out}>{tr('shop.outOfStock')}</Text> : null}
        </View>
      </Pressable>
      <View style={styles.heart}>
        <Heart productId={product.id} title={title} />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    width: '48%',
    flexGrow: 1,
    minWidth: 150,
    maxWidth: 260,
    backgroundColor: colors.surfaceRaised,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.border,
    overflow: 'hidden',
    minHeight: minTouchTarget,
  },
  image: { width: '100%', aspectRatio: 1, backgroundColor: colors.border },
  body: { padding: spacing[1] + 4, gap: 2 },
  brand: { color: colors.textMuted, fontSize: 12, fontWeight: '700', textTransform: 'uppercase' },
  title: { color: colors.text, fontSize: 15, fontWeight: '600' },
  store: { color: colors.textMuted, fontSize: 13 },
  rating: { color: colors.text, fontSize: 13, fontWeight: '600' },
  muted: { color: colors.textMuted, fontWeight: '400' },
  priceRow: {
    flexDirection: 'row',
    alignItems: 'baseline',
    gap: 6,
    flexWrap: 'wrap',
    marginTop: 4,
  },
  price: { color: colors.text, fontSize: 15, fontWeight: '700' },
  was: { color: colors.textMuted, fontSize: 13, textDecorationLine: 'line-through' },
  out: { color: colors.danger, fontSize: 13 },
  badge: {
    position: 'absolute',
    top: 8,
    start: 8,
    backgroundColor: colors.danger,
    borderRadius: 6,
    paddingHorizontal: 6,
    paddingVertical: 2,
  },
  badgeText: { color: '#FFFFFF', fontSize: 12, fontWeight: '700' },
  heart: { position: 'absolute', top: 4, end: 4 },
});

export const gridStyle = StyleSheet.create({
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing[1] + 4 },
}).grid;
