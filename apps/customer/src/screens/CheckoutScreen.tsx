import type { Address, CreateOrderResponse, Emirate, QuoteView } from '@jays/contracts';
import { colors, minTouchTarget, radius, spacing } from '@jays/ui';
import { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';
import { Chips } from '../components/Picker';
import { Tabs } from '../components/Tabs';
import { Totals } from '../components/Totals';
import { Banner, Body, Button, Field, Screen, Title } from '../components/ui';
import { useApp } from '../context';
import { errorKey } from '../errors';
import { money, newIdempotencyKey, timeOfDay } from '../format';

type Step =
  | { name: 'address' }
  | { name: 'review'; quote: QuoteView }
  | { name: 'pay'; order: CreateOrderResponse }
  | { name: 'waiting'; orderId: string }
  | { name: 'done'; orderId: string; outcome: 'paid' | 'failed' | 'expired' };

/**
 * Checkout: address, server-priced quote, order, then the payment provider's page. The order is
 * only marked paid when the provider's signed webhook arrives, so after paying this screen waits
 * for the order status instead of assuming success.
 */
export function CheckoutScreen() {
  const { state, api, dispatch, tr } = useApp();
  const [addresses, setAddresses] = useState<Address[] | null>(null);
  const [emirates, setEmirates] = useState<Emirate[]>([]);
  const [addressId, setAddressId] = useState<string | null>(null);
  const [step, setStep] = useState<Step>({ name: 'address' });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [form, setForm] = useState({
    emirate: state.emirate ?? 'DXB',
    area: '',
    street: '',
    building: '',
  });
  // One key per quote: retrying "Place order" after a lost response returns the same order.
  const orderKey = useRef<{ quoteId: string; key: string } | null>(null);

  useEffect(() => {
    if (!state.session) {
      dispatch({ type: 'requireSignIn', returnTo: '/checkout' });
      return;
    }
    Promise.all([api.addresses({ limit: 50 }), api.emirates()])
      .then(([a, e]) => {
        setAddresses(a.items);
        setEmirates(e.items);
        setAddressId((a.items.find((x) => x.isDefault) ?? a.items[0])?.id ?? null);
      })
      .catch((e) => setError(tr(errorKey(e).key)));
  }, [api, state.session]);

  const run = useCallback(
    async (fn: () => Promise<void>) => {
      setBusy(true);
      setError(null);
      try {
        await fn();
      } catch (e) {
        setError(tr(errorKey(e).key));
      } finally {
        setBusy(false);
      }
    },
    [tr],
  );

  const saveAddress = () =>
    run(async () => {
      const a = await api.createAddress({ ...form, emirate: form.emirate as Address['emirate'] });
      setAddresses((list) => [...(list ?? []), a]);
      setAddressId(a.id);
    });

  const review = () =>
    run(async () => {
      if (!addressId) return;
      setStep({ name: 'review', quote: await api.quote(addressId) });
    });

  /** Re-quotes with another delivery method for one seller (ADR-0029). */
  const chooseMethod = (quote: QuoteView, storeId: string, method: 'standard' | 'express') =>
    run(async () => {
      if (!addressId) return;
      const methods = Object.fromEntries(quote.groups.map((g) => [g.store.id, g.delivery.method]));
      methods[storeId] = method;
      setStep({ name: 'review', quote: await api.quote(addressId, methods) });
    });

  const place = (quote: QuoteView) =>
    run(async () => {
      if (orderKey.current?.quoteId !== quote.quoteId)
        orderKey.current = { quoteId: quote.quoteId, key: newIdempotencyKey('order') };
      const order = await api.createOrder(quote.quoteId, orderKey.current.key);
      setStep({ name: 'pay', order });
    });

  const pay = (order: CreateOrderResponse, outcome: 'success' | 'fail') =>
    run(async () => {
      if (!order.paymentIntentId || !order.paymentClientSecret) return;
      await api.mockConfirmPayment(order.paymentIntentId, order.paymentClientSecret, outcome);
      setStep({ name: 'waiting', orderId: order.orderId });
    });

  // Wait for the provider's webhook to settle the order (polls for up to about 30 seconds).
  useEffect(() => {
    if (step.name !== 'waiting') return;
    let cancelled = false;
    let tries = 0;
    const tick = async () => {
      tries += 1;
      try {
        const o = await api.order(step.orderId);
        if (cancelled) return;
        if (o.status === 'paid' || o.status === 'failed' || o.status === 'expired') {
          if (o.status === 'paid') dispatch({ type: 'cart', cartToken: null, count: 0 });
          setStep({ name: 'done', orderId: o.id, outcome: o.status });
          return;
        }
      } catch {
        // keep waiting; the order page shows the final state too
      }
      if (!cancelled && tries < 30) setTimeout(() => void tick(), 1000);
    };
    void tick();
    return () => {
      cancelled = true;
    };
  }, [api, dispatch, step]);

  const back = (
    <View style={{ alignItems: 'flex-start' }}>
      <Button
        variant="ghost"
        label={`${state.locale === 'ar' ? '→' : '←'} ${tr('cart.title')}`}
        onPress={() => dispatch({ type: 'navigate', route: '/cart' })}
      />
    </View>
  );

  return (
    <Screen footer={<Tabs />}>
      {step.name === 'address' || step.name === 'review' ? back : null}
      <Title>{tr('checkout.title')}</Title>
      {error ? <Banner kind="error">{error}</Banner> : null}

      {step.name === 'address' ? (
        addresses === null ? (
          <ActivityIndicator color={colors.accent} accessibilityLabel={tr('common.loading')} />
        ) : (
          <>
            <Text style={styles.section} accessibilityRole="header">
              {tr('checkout.address')}
            </Text>
            <View accessibilityRole="radiogroup" style={{ gap: spacing[1] }}>
              {addresses.map((a) => (
                <Pressable
                  key={a.id}
                  accessibilityRole="radio"
                  accessibilityState={{ selected: a.id === addressId }}
                  onPress={() => setAddressId(a.id)}
                  style={[styles.option, a.id === addressId && styles.optionOn]}
                >
                  <Text style={styles.text}>
                    {[a.unit, a.building, a.street, a.area].filter(Boolean).join(', ')}
                  </Text>
                  <Text style={styles.muted}>
                    {emirates.find((e) => e.code === a.emirate)?.name[state.locale] ?? a.emirate}
                  </Text>
                </Pressable>
              ))}
            </View>
            <View style={styles.card}>
              <Text style={styles.text}>{tr('checkout.addAddress')}</Text>
              <View style={styles.chips}>
                {emirates.map((e) => (
                  <Pressable
                    key={e.code}
                    accessibilityRole="radio"
                    accessibilityState={{ selected: form.emirate === e.code }}
                    onPress={() => setForm({ ...form, emirate: e.code })}
                    style={[styles.chip, form.emirate === e.code && styles.optionOn]}
                  >
                    <Text style={styles.text}>{e.name[state.locale]}</Text>
                  </Pressable>
                ))}
              </View>
              <Field
                label={tr('checkout.area')}
                value={form.area}
                onChangeText={(area) => setForm({ ...form, area })}
              />
              <Field
                label={tr('checkout.street')}
                value={form.street}
                onChangeText={(street) => setForm({ ...form, street })}
              />
              <Field
                label={tr('checkout.building')}
                value={form.building}
                onChangeText={(building) => setForm({ ...form, building })}
              />
              <Button
                variant="secondary"
                label={tr('checkout.saveAddress')}
                onPress={() => void saveAddress()}
                disabled={!form.area || !form.street || !form.building}
                busy={busy}
              />
            </View>
            <Button
              label={tr('checkout.review')}
              onPress={() => void review()}
              disabled={!addressId}
              busy={busy}
            />
          </>
        )
      ) : null}

      {step.name === 'review' ? (
        <>
          <Body muted>
            {tr('checkout.expires', { time: timeOfDay(step.quote.expiresAt, state.locale) })}
          </Body>
          {step.quote.groups.map((g) => (
            <View key={g.store.id} style={styles.card}>
              <Text style={styles.text}>{g.store.name[state.locale]}</Text>
              {g.lines.map((l) => (
                <View key={l.variantId} style={styles.row}>
                  <Text style={[styles.muted, { flex: 1 }]}>
                    {l.qty} × {l.title[state.locale]} · {l.variantName[state.locale]}
                  </Text>
                  <Text style={styles.text}>{money(l.lineTotalFils, state.locale)}</Text>
                </View>
              ))}
              <Text style={styles.muted}>
                {tr('money.delivery')}:{' '}
                {g.deliveryFils ? money(g.deliveryFils, state.locale) : tr('money.free')} ·{' '}
                {tr('orders.deliveryWindow', { min: g.delivery.minDays, max: g.delivery.maxDays })}
              </Text>
              {g.deliveryOptions.length > 1 ? (
                <Chips
                  label={tr('checkout.deliveryMethod')}
                  value={g.delivery.method}
                  onChange={(m) => {
                    if (m !== g.delivery.method) void chooseMethod(step.quote, g.store.id, m);
                  }}
                  options={g.deliveryOptions.map((o) => ({
                    value: o.method,
                    label: `${tr(`delivery.method.${o.method}`)} · ${
                      o.feeFils ? money(o.feeFils, state.locale) : tr('money.free')
                    } · ${tr('orders.deliveryWindow', { min: o.minDays, max: o.maxDays })}`,
                  }))}
                />
              ) : null}
            </View>
          ))}
          <Totals t={step.quote} />
          <Button label={tr('checkout.place')} onPress={() => void place(step.quote)} busy={busy} />
          <Button
            variant="ghost"
            label={tr('common.back')}
            onPress={() => setStep({ name: 'address' })}
          />
        </>
      ) : null}

      {step.name === 'pay' ? (
        <View style={styles.card}>
          <Banner kind="info">{tr('checkout.mockNotice')}</Banner>
          <Body>
            {tr('checkout.payWindow', {
              time: timeOfDay(step.order.paymentExpiresAt, state.locale),
            })}
          </Body>
          <Button
            label={tr('checkout.pay', { amount: money(step.order.totalFils, state.locale) })}
            onPress={() => void pay(step.order, 'success')}
            busy={busy}
          />
          <Button
            variant="ghost"
            label={tr('checkout.payFail')}
            onPress={() => void pay(step.order, 'fail')}
            disabled={busy}
          />
        </View>
      ) : null}

      {step.name === 'waiting' ? (
        <View style={styles.card}>
          <ActivityIndicator color={colors.accent} />
          <Body>{tr('checkout.waiting')}</Body>
        </View>
      ) : null}

      {step.name === 'done' ? (
        <View style={styles.card}>
          <Banner kind={step.outcome === 'paid' ? 'info' : 'error'}>
            {tr(
              step.outcome === 'paid'
                ? 'checkout.paid'
                : step.outcome === 'failed'
                  ? 'checkout.failed'
                  : 'checkout.expired',
            )}
          </Banner>
          <Button
            label={tr('myOrders.title')}
            onPress={() => dispatch({ type: 'openOrder', orderId: step.orderId })}
          />
        </View>
      ) : null}
    </Screen>
  );
}

const styles = StyleSheet.create({
  section: { marginTop: spacing[1], fontSize: 18, fontWeight: '700', color: colors.text },
  card: {
    backgroundColor: colors.surfaceRaised,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing[2],
    gap: spacing[1],
  },
  option: {
    minHeight: minTouchTarget,
    padding: spacing[2],
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surfaceRaised,
  },
  optionOn: { borderColor: colors.accent, borderWidth: 2 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing[1] },
  chip: {
    minHeight: 40,
    paddingHorizontal: 12,
    justifyContent: 'center',
    borderRadius: 999,
    borderWidth: 1,
    borderColor: colors.border,
  },
  row: { flexDirection: 'row', gap: spacing[1] },
  text: { color: colors.text, fontSize: 15, fontWeight: '600' },
  muted: { color: colors.textMuted, fontSize: 14 },
});
