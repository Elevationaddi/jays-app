import type { PublicProductListItem } from '@jays/contracts';
import { colors, minTouchTarget, radius, spacing } from '@jays/ui';
import { Image, Pressable, StyleSheet, Text, View } from 'react-native';
import { useApp } from '../context';
import { money } from '../format';

/** A product tile: cover image, title, store, price (or range) and stock state. */
export function ProductCard({ product }: { product: PublicProductListItem }) {
  const { state, dispatch, tr } = useApp();
  const price =
    product.priceFromFils === product.priceToFils
      ? money(product.priceFromFils, state.locale)
      : tr('products.priceFrom', { price: money(product.priceFromFils, state.locale) });
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${product.title[state.locale]}, ${price}`}
      onPress={() => dispatch({ type: 'openProduct', productId: product.id })}
      style={({ pressed }) => [styles.card, pressed && { opacity: 0.85 }]}
    >
      {product.imageUrl ? (
        <Image source={{ uri: product.imageUrl }} style={styles.image} alt="" />
      ) : (
        <View style={[styles.image, { backgroundColor: '#F3ECF1' }]} />
      )}
      <View style={styles.body}>
        <Text style={styles.title} numberOfLines={2}>
          {product.title[state.locale]}
        </Text>
        <Text style={styles.store} numberOfLines={1}>
          {product.store.name[state.locale]}
        </Text>
        <Text style={styles.price}>{price}</Text>
        {!product.inStock ? <Text style={styles.out}>{tr('shop.outOfStock')}</Text> : null}
      </View>
    </Pressable>
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
  title: { color: colors.text, fontSize: 15, fontWeight: '600' },
  store: { color: colors.textMuted, fontSize: 13 },
  price: { color: colors.text, fontSize: 15, fontWeight: '700', marginTop: 4 },
  out: { color: colors.danger, fontSize: 13 },
});

export const gridStyle = StyleSheet.create({
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing[1] + 4 },
}).grid;
