import type { PublicProduct } from '@jays/contracts';
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
import { ModeSwitch } from '../components/ModeSwitch';
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
          <Body muted>{tr('shop.by', { store: product.store.name[state.locale] })}</Body>
          <Title>{product.title[state.locale]}</Title>
          {variant ? (
            <Text style={styles.price}>{money(variant.priceFils, state.locale)}</Text>
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
          <Button
            label={tr('shop.addToCart')}
            onPress={() => void add()}
            busy={adding}
            disabled={!variant?.inStock}
          />
          {notice?.kind === 'info' ? (
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
        </>
      )}
    </Screen>
  );
}

const styles = StyleSheet.create({
  image: { width: 280, height: 280, borderRadius: radius.lg, backgroundColor: colors.border },
  price: { fontSize: 22, fontWeight: '700', color: colors.text },
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
