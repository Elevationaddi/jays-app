import type { OrderView } from '@jays/contracts';
import { colors, minTouchTarget, radius, spacing } from '@jays/ui';
import { useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';
import { Tabs } from '../components/Tabs';
import { Totals } from '../components/Totals';
import { Banner, Body, Button, Screen, Title } from '../components/ui';
import { useApp } from '../context';
import { money } from '../format';

type ListItem = Awaited<ReturnType<ReturnType<typeof useApp>['api']['orders']>>['items'][number];

const dateOf = (iso: string, locale: 'en' | 'ar') =>
  new Intl.DateTimeFormat(locale === 'ar' ? 'ar-AE' : 'en-AE', {
    dateStyle: 'medium',
    timeZone: 'Asia/Dubai',
  }).format(new Date(iso));

/** The customer's orders, newest first. */
export function OrdersScreen() {
  const { state, api, dispatch, tr } = useApp();
  const [orders, setOrders] = useState<ListItem[] | 'loading' | 'error'>('loading');

  useEffect(() => {
    if (!state.session) {
      dispatch({ type: 'requireSignIn', returnTo: '/orders' });
      return;
    }
    api
      .orders({ limit: 50 })
      .then((p) => setOrders(p.items))
      .catch(() => setOrders('error'));
  }, [api, dispatch, state.session]);

  return (
    <Screen footer={<Tabs />}>
      <Title>{tr('myOrders.title')}</Title>
      {orders === 'loading' ? (
        <ActivityIndicator color={colors.accent} accessibilityLabel={tr('common.loading')} />
      ) : orders === 'error' ? (
        <Banner kind="error">{tr('common.error')}</Banner>
      ) : orders.length === 0 ? (
        <Body muted>{tr('myOrders.empty')}</Body>
      ) : (
        orders.map((o) => (
          <Pressable
            key={o.id}
            accessibilityRole="button"
            onPress={() => dispatch({ type: 'openOrder', orderId: o.id })}
            style={({ pressed }) => [styles.card, pressed && { opacity: 0.85 }]}
          >
            <View style={styles.row}>
              <Text style={styles.text}>#{o.id.slice(0, 8).toUpperCase()}</Text>
              <Text style={styles.text}>{money(o.totalFils, state.locale)}</Text>
            </View>
            <Text style={styles.muted}>
              {dateOf(o.createdAt, state.locale)} · {tr('orders.items', { count: o.itemCount })} ·{' '}
              {tr('myOrders.stores', { count: o.merchantCount })}
            </Text>
            <Text
              style={[
                styles.muted,
                { color: o.status === 'paid' ? colors.success : colors.textMuted },
              ]}
            >
              {tr(`orderStatus.${o.status}`)}
            </Text>
          </Pressable>
        ))
      )}
    </Screen>
  );
}

/** One order: a shipment per store, each with its own status and delivery window. */
export function OrderScreen() {
  const { state, api, dispatch, tr } = useApp();
  const [order, setOrder] = useState<OrderView | 'loading' | 'error'>('loading');

  useEffect(() => {
    if (!state.orderId) return setOrder('error');
    api
      .order(state.orderId)
      .then(setOrder)
      .catch(() => setOrder('error'));
  }, [api, state.orderId]);

  return (
    <Screen footer={<Tabs />}>
      <View style={{ alignItems: 'flex-start' }}>
        <Button
          variant="ghost"
          label={`${state.locale === 'ar' ? '→' : '←'} ${tr('myOrders.title')}`}
          onPress={() => dispatch({ type: 'navigate', route: '/orders' })}
        />
      </View>
      {order === 'loading' ? (
        <ActivityIndicator color={colors.accent} accessibilityLabel={tr('common.loading')} />
      ) : order === 'error' ? (
        <Banner kind="error">{tr('common.error')}</Banner>
      ) : (
        <>
          <Title>#{order.id.slice(0, 8).toUpperCase()}</Title>
          <Body muted>
            {tr(`orderStatus.${order.status}`)} · {dateOf(order.createdAt, state.locale)}
          </Body>
          {order.merchants.map((m) => (
            <View key={m.id} style={styles.card}>
              <View style={styles.row}>
                <Text style={styles.text}>{m.store.name[state.locale]}</Text>
                <Text style={styles.muted}>{tr(`merchantOrderStatus.${m.status}`)}</Text>
              </View>
              {m.items.map((i) => (
                <View key={i.id} style={styles.row}>
                  <Text style={[styles.muted, { flex: 1 }]}>
                    {i.qty} × {i.title[state.locale]} · {i.variantName[state.locale]}
                  </Text>
                  <Text style={styles.text}>{money(i.lineTotalFils, state.locale)}</Text>
                </View>
              ))}
              <Text style={styles.muted}>
                {tr('orders.deliveryWindow', { min: m.delivery.minDays, max: m.delivery.maxDays })}
              </Text>
            </View>
          ))}
          <Totals t={order} />
        </>
      )}
    </Screen>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: colors.surfaceRaised,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing[2],
    gap: 6,
    minHeight: minTouchTarget,
  },
  row: { flexDirection: 'row', justifyContent: 'space-between', gap: spacing[1] },
  text: { color: colors.text, fontSize: 15, fontWeight: '600' },
  muted: { color: colors.textMuted, fontSize: 14 },
});
