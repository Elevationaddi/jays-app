import type { PublicProduct, PublicProductListItem, ReviewSummary } from '@jays/contracts';
import { colors, minTouchTarget, radius, spacing } from '@jays/ui';
import { useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Image,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { Heart } from '../components/Heart';
import { ModeSwitch } from '../components/ModeSwitch';
import { gridStyle, ProductCard, RatingLine } from '../components/ProductCard';
import { Tabs } from '../components/Tabs';
import { Banner, Body, Button, Screen, Title } from '../components/ui';
import { useApp } from '../context';
import { errorKey } from '../errors';
import { money } from '../format';

/**
 * Product detail: live, approved content only. Stock shown is a yes/no (plus "only a few left"):
 * nothing is held until the order is placed, so the screen never promises a count.
 */
export function ProductScreen() {
  const { state, api, dispatch, tr } = useApp();
  const [product, setProduct] = useState<PublicProduct | 'loading' | 'error'>('loading');
  const [variantId, setVariantId] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [notice, setNotice] = useState<{ kind: 'info' | 'error'; text: string } | null>(null);
  const [related, setRelated] = useState<PublicProductListItem[]>([]);
  const [reviews, setReviews] = useState<ReviewSummary | null>(null);
  const [alerts, setAlerts] = useState<string[]>([]);
  const [alerting, setAlerting] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setRelated([]);
    setReviews(null);
    if (!state.productId) return;
    api
      .relatedProducts(state.productId)
      .then((r) => !cancelled && setRelated(r.items))
      .catch(() => undefined);
    api
      .productReviews(state.productId, { limit: 3 })
      .then((r) => !cancelled && setReviews(r))
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [api, state.productId]);

  const signedIn = Boolean(state.session);
  useEffect(() => {
    if (!signedIn) return setAlerts([]);
    let cancelled = false;
    api
      .stockAlerts()
      .then((a) => !cancelled && setAlerts(a.items.map((i) => i.variantId)))
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [api, signedIn]);

  useEffect(() => {
    let cancelled = false;
    setProduct('loading');
    if (!state.productId) return setProduct('error');
    api
      .product(state.productId)
      .then((p) => {
        if (cancelled) return;
        setProduct(p);
        setVariantId((p.variants.find((v) => v.inStock) ?? p.variants[0])?.id ?? null);
      })
      .catch(() => !cancelled && setProduct('error'));
    return () => {
      cancelled = true;
    };
  }, [api, state.productId]);

  const variant =
    typeof product === 'object' ? product.variants.find((v) => v.id === variantId) : undefined;

  /** Back-in-stock alert for the selected sold-out option. */
  async function toggleAlert() {
    if (!variant) return;
    if (!state.session) {
      dispatch({ type: 'requireSignIn', returnTo: '/shop/product' });
      return;
    }
    setAlerting(true);
    setNotice(null);
    try {
      const watching = alerts.includes(variant.id);
      const next = watching
        ? await api.removeStockAlert(variant.id)
        : await api.addStockAlert(variant.id);
      setAlerts(next.items.map((i) => i.variantId));
      setNotice({ kind: 'info', text: tr(watching ? 'alert.removed' : 'alert.added') });
    } catch (error) {
      setNotice({ kind: 'error', text: tr(errorKey(error).key) });
    } finally {
      setAlerting(false);
    }
  }

  async function add() {
    if (!variant) return;
    setAdding(true);
    setNotice(null);
    try {
      const cart = await api.cart(state.cartToken);
      const existing = cart.groups.flatMap((g) => g.lines).find((l) => l.variantId === variant.id);
      const next = await api.putCartItem(
        variant.id,
        (existing?.qty ?? 0) + 1,
        cart.cartToken ?? state.cartToken,
      );
      dispatch({ type: 'cart', cartToken: next.cartToken ?? null, count: next.itemCount });
      setNotice({ kind: 'info', text: tr('shop.added') });
    } catch (error) {
      setNotice({ kind: 'error', text: tr(errorKey(error).key) });
    } finally {
      setAdding(false);
    }
  }

  return (
    <Screen footer={<Tabs />}>
      <ModeSwitch />
      <View style={{ alignItems: 'flex-start' }}>
        <Button
          variant="ghost"
          label={`${state.locale === 'ar' ? '→' : '←'} ${tr('store.back')}`}
          onPress={() => dispatch({ type: 'navigate', route: '/shop' })}
        />
      </View>
      {product === 'loading' ? (
        <ActivityIndicator color={colors.accent} accessibilityLabel={tr('common.loading')} />
      ) : product === 'error' ? (
        <Banner kind="error">{tr('store.loadError')}</Banner>
      ) : (
        <>
          <ScrollView
            horizontal
            contentContainerStyle={{ gap: spacing[1] }}
            showsHorizontalScrollIndicator={false}
          >
            {product.images.map((uri) => (
              <Image key={uri} source={{ uri }} style={styles.image} alt="" />
            ))}
          </ScrollView>
          <View style={styles.headRow}>
            <View style={{ flex: 1, gap: 4 }}>
              {product.brand ? (
                <Text style={styles.brand}>{product.brand.name[state.locale]}</Text>
              ) : null}
              <Body muted>{tr('shop.by', { store: product.store.name[state.locale] })}</Body>
            </View>
            <Heart
              productId={product.id}
              title={product.title[state.locale]}
              size="large"
              onError={(text) => setNotice({ kind: 'error', text })}
            />
          </View>
          <Title>{product.title[state.locale]}</Title>
          <RatingLine rating={product.rating} large />
          {variant ? (
            <View style={styles.priceRow}>
              <Text style={[styles.price, variant.compareAtFils ? { color: colors.danger } : null]}>
                {money(variant.priceFils, state.locale)}
              </Text>
              {variant.compareAtFils ? (
                <>
                  <Text
                    style={styles.was}
                    accessibilityLabel={tr('sale.wasLabel', {
                      price: money(variant.compareAtFils, state.locale),
                    })}
                  >
                    {money(variant.compareAtFils, state.locale)}
                  </Text>
                  <Text style={styles.save}>
                    {tr('sale.badge', { percent: variant.discountPercent ?? 0 })}
                  </Text>
                </>
              ) : null}
            </View>
          ) : null}
          {product.variants.length > 1 ? (
            <View style={styles.variants} accessibilityRole="radiogroup">
              {product.variants.map((v) => {
                const selected = v.id === variantId;
                return (
                  <Pressable
                    key={v.id}
                    accessibilityRole="radio"
                    accessibilityState={{ selected, disabled: !v.inStock }}
                    onPress={() => setVariantId(v.id)}
                    style={[
                      styles.variant,
                      selected && styles.variantOn,
                      !v.inStock && { opacity: 0.5 },
                    ]}
                  >
                    <Text style={[styles.variantText, selected && { color: colors.accent }]}>
                      {v.name[state.locale]}
                    </Text>
                  </Pressable>
                );
              })}
            </View>
          ) : null}
          {variant && !variant.inStock ? (
            <Banner kind="error">{tr('shop.outOfStock')}</Banner>
          ) : variant?.lowStock ? (
            <Body muted>{tr('shop.lowStock')}</Body>
          ) : null}
          {notice ? <Banner kind={notice.kind}>{notice.text}</Banner> : null}
          {variant && !variant.inStock ? (
            <Button
              variant={alerts.includes(variant.id) ? 'secondary' : 'primary'}
              label={tr(alerts.includes(variant.id) ? 'alert.cancel' : 'alert.notifyMe')}
              accessibilityHint={tr('alert.hint')}
              onPress={() => void toggleAlert()}
              busy={alerting}
            />
          ) : (
            <Button
              label={tr('shop.addToCart')}
              onPress={() => void add()}
              busy={adding}
              disabled={!variant?.inStock}
            />
          )}
          {notice?.kind === 'info' && notice.text === tr('shop.added') ? (
            <Button
              variant="secondary"
              label={tr('cart.title')}
              onPress={() => dispatch({ type: 'navigate', route: '/cart' })}
            />
          ) : null}
          <Body muted>{tr('shop.stockNote')}</Body>
          <Body>{product.description[state.locale]}</Body>
          <Text style={styles.section} accessibilityRole="header">
            {tr('shop.delivery')}
          </Text>
          {product.delivery.map((z) => (
            <Body key={z.emirate} muted>
              {tr('shop.deliveryTo', {
                emirate: z.emirate,
                fee: z.feeFils ? money(z.feeFils, state.locale) : tr('money.free'),
                min: z.minDays,
                max: z.maxDays,
              })}
            </Body>
          ))}
          {product.returnEligible ? <Body muted>{tr('shop.returnEligible')}</Body> : null}
          {reviews && reviews.count > 0 ? (
            <>
              <Text style={styles.section} accessibilityRole="header">
                {tr('product.reviewsTitle', { count: reviews.count })}
              </Text>
              {reviews.items.map((r) => (
                <View key={r.id} style={styles.review}>
                  <Text
                    style={styles.stars}
                    accessibilityLabel={tr('rating.stars', { rating: r.rating })}
                  >
                    {'★'.repeat(r.rating)}
                    {'☆'.repeat(5 - r.rating)}
                  </Text>
                  {r.body ? <Body>{r.body}</Body> : null}
                  {r.author ? <Body muted>{r.author}</Body> : null}
                  {r.reply ? (
                    <Body muted>{tr('product.reviewReply', { reply: r.reply.body })}</Body>
                  ) : null}
                </View>
              ))}
            </>
          ) : null}
          {related.length > 0 ? (
            <>
              <Text style={styles.section} accessibilityRole="header">
                {tr('shop.related')}
              </Text>
              <View style={gridStyle}>
                {related.map((p) => (
                  <ProductCard key={p.id} product={p} />
                ))}
              </View>
            </>
          ) : null}
        </>
      )}
    </Screen>
  );
}

const styles = StyleSheet.create({
  image: { width: 280, height: 280, borderRadius: radius.lg, backgroundColor: colors.border },
  price: { fontSize: 22, fontWeight: '700', color: colors.text },
  priceRow: { flexDirection: 'row', alignItems: 'baseline', gap: spacing[1], flexWrap: 'wrap' },
  was: { fontSize: 16, color: colors.textMuted, textDecorationLine: 'line-through' },
  save: { fontSize: 14, fontWeight: '700', color: colors.danger },
  headRow: { flexDirection: 'row', alignItems: 'center', gap: spacing[1] },
  brand: { color: colors.textMuted, fontSize: 13, fontWeight: '700', textTransform: 'uppercase' },
  review: {
    gap: 4,
    paddingVertical: spacing[1],
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  stars: { color: colors.accent, fontSize: 16 },
  section: { marginTop: spacing[2], fontSize: 18, fontWeight: '700', color: colors.text },
  variants: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing[1] },
  variant: {
    minHeight: minTouchTarget,
    paddingHorizontal: 16,
    justifyContent: 'center',
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surfaceRaised,
  },
  variantOn: { borderColor: colors.accent, borderWidth: 2 },
  variantText: { color: colors.text, fontSize: 15, fontWeight: '600' },
});
