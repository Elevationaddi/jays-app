import type { CartView } from '@jays/contracts';
import { colors, minTouchTarget, radius, spacing } from '@jays/ui';
import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Image, Pressable, StyleSheet, Text, View } from 'react-native';
import { ModeSwitch } from '../components/ModeSwitch';
import { Tabs } from '../components/Tabs';
import { Banner, Body, Button, Screen, Title } from '../components/ui';
import { useApp } from '../context';
import { errorKey } from '../errors';
import { money } from '../format';

/**
 * The cart, grouped by store. Prices here are current list prices; the binding price is the
 * checkout quote. Lines that cannot be bought are marked and block checkout.
 */
export function CartScreen() {
  const { state, api, dispatch, tr } = useApp();
  const [cart, setCart] = useState<CartView | 'loading' | 'error'>('loading');
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const apply = useCallback(
    (c: CartView) => {
      setCart(c);
      dispatch({
        type: 'cart',
        cartToken: c.cartToken ?? (state.session ? null : state.cartToken),
        count: c.itemCount,
      });
    },
    [dispatch, state.session, state.cartToken],
  );

  useEffect(() => {
    let cancelled = false;
    api
      .cart(state.session ? null : state.cartToken)
      .then((c) => !cancelled && apply(c))
      .catch(() => !cancelled && setCart('error'));
    return () => {
      cancelled = true;
    };
  }, [api, state.session]);

  async function change(variantId: string, qty: number) {
    setBusy(variantId);
    setError(null);
    try {
      const token = state.session ? null : state.cartToken;
      apply(
        qty > 0
          ? await api.putCartItem(variantId, qty, token)
          : await api.removeCartItem(variantId, token),
      );
    } catch (e) {
      setError(tr(errorKey(e).key));
    } finally {
      setBusy(null);
    }
  }

  const checkout = () =>
    state.session
      ? dispatch({ type: 'navigate', route: '/checkout' })
      : dispatch({ type: 'requireSignIn', returnTo: '/checkout' });

  return (
    <Screen footer={<Tabs />}>
      <ModeSwitch />
      <Title>{tr('cart.title')}</Title>
      {cart === 'loading' ? (
        <ActivityIndicator color={colors.accent} accessibilityLabel={tr('common.loading')} />
      ) : cart === 'error' ? (
        <Banner kind="error">{tr('common.error')}</Banner>
      ) : cart.groups.length === 0 ? (
        <View style={styles.empty}>
          <Text style={{ fontSize: 40 }} accessibilityElementsHidden importantForAccessibility="no">
            🛍
          </Text>
          <Body muted>{tr('cart.empty')}</Body>
          <Button
            variant="secondary"
            label={tr('shop.products')}
            onPress={() => dispatch({ type: 'navigate', route: '/shop' })}
          />
        </View>
      ) : (
        <>
          {error ? <Banner kind="error">{error}</Banner> : null}
          {!cart.checkoutReady ? <Banner kind="error">{tr('cart.notReady')}</Banner> : null}
          {cart.groups.map((g) => (
            <View key={g.store.id} style={styles.group}>
              <Text style={styles.store} accessibilityRole="header">
                {g.store.name[state.locale]}
              </Text>
              {g.lines.map((l) => (
                <View key={l.variantId} style={styles.line}>
                  {l.imageUrl ? (
                    <Image source={{ uri: l.imageUrl }} style={styles.thumb} alt="" />
                  ) : (
                    <View style={styles.thumb} />
                  )}
                  <View style={{ flex: 1, gap: 2 }}>
                    <Text style={styles.title}>{l.title[state.locale]}</Text>
                    <Text style={styles.muted}>{l.variantName[state.locale]}</Text>
                    <Text style={styles.title}>{money(l.lineTotalFils, state.locale)}</Text>
                    {l.priceSeenFils !== l.unitPriceFils ? (
                      <Text style={styles.muted}>
                        {tr('cart.priceChanged', { price: money(l.priceSeenFils, state.locale) })}
                      </Text>
                    ) : null}
                    {l.issues
                      .filter((i) => i !== 'price_changed')
                      .map((i) => (
                        <Text key={i} style={styles.issue}>
                          {tr(`cartIssue.${i}`)}
                        </Text>
                      ))}
                    <View style={styles.qtyRow}>
                      <Stepper
                        label="−"
                        a11y={`${tr('cart.qty')} −`}
                        disabled={busy !== null}
                        onPress={() => void change(l.variantId, l.qty - 1)}
                      />
                      <Text style={styles.qty} accessibilityLabel={`${tr('cart.qty')}: ${l.qty}`}>
                        {l.qty}
                      </Text>
                      <Stepper
                        label="+"
                        a11y={`${tr('cart.qty')} +`}
                        disabled={busy !== null}
                        onPress={() => void change(l.variantId, l.qty + 1)}
                      />
                      <Button
                        variant="ghost"
                        label={tr('cart.remove')}
                        onPress={() => void change(l.variantId, 0)}
                        disabled={busy !== null}
                      />
                    </View>
                  </View>
                </View>
              ))}
            </View>
          ))}
          <View style={styles.total}>
            <Text style={styles.title}>{tr('money.subtotal')}</Text>
            <Text style={styles.title}>{money(cart.subtotalFils, state.locale)}</Text>
          </View>
          {!state.session ? <Body muted>{tr('cart.signIn')}</Body> : null}
          <Button label={tr('cart.checkout')} onPress={checkout} disabled={!cart.checkoutReady} />
        </>
      )}
    </Screen>
  );
}

function Stepper({
  label,
  a11y,
  onPress,
  disabled,
}: {
  label: string;
  a11y: string;
  onPress: () => void;
  disabled: boolean;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={a11y}
      disabled={disabled}
      onPress={onPress}
      style={[styles.stepper, disabled && { opacity: 0.5 }]}
    >
      <Text style={styles.stepperText}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  empty: {
    backgroundColor: colors.surfaceRaised,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing[3],
    alignItems: 'center',
    gap: spacing[1],
  },
  group: {
    backgroundColor: colors.surfaceRaised,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing[2],
    gap: spacing[2],
  },
  store: { fontSize: 16, fontWeight: '700', color: colors.text },
  line: { flexDirection: 'row', gap: spacing[2] },
  thumb: { width: 72, height: 72, borderRadius: radius.md, backgroundColor: colors.border },
  title: { color: colors.text, fontSize: 15, fontWeight: '600' },
  muted: { color: colors.textMuted, fontSize: 14 },
  issue: { color: colors.danger, fontSize: 14 },
  qtyRow: { flexDirection: 'row', alignItems: 'center', gap: spacing[1], flexWrap: 'wrap' },
  qty: { minWidth: 28, textAlign: 'center', fontSize: 16, color: colors.text },
  stepper: {
    width: minTouchTarget,
    height: minTouchTarget,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    alignItems: 'center',
    justifyContent: 'center',
  },
  stepperText: { fontSize: 20, color: colors.accent, fontWeight: '700' },
  total: { flexDirection: 'row', justifyContent: 'space-between' },
});
