import type { Wishlist } from '@jays/contracts';
import { colors, spacing } from '@jays/ui';
import { useEffect, useState } from 'react';
import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';
import { gridStyle, ProductCard } from '../components/ProductCard';
import { Tabs } from '../components/Tabs';
import { Banner, Body, Button, Screen, Title } from '../components/ui';
import { useApp } from '../context';
import { errorKey } from '../errors';

/** /wishlist: saved products. Ones no longer on sale stay listed until removed. */
export function WishlistScreen() {
  const { state, api, dispatch, tr } = useApp();
  const [list, setList] = useState<Wishlist | 'loading' | 'error'>('loading');
  const [error, setError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    if (!state.session) {
      dispatch({ type: 'requireSignIn', returnTo: '/wishlist' });
      return;
    }
    let cancelled = false;
    setList('loading');
    api
      .wishlist()
      .then((w) => {
        if (cancelled) return;
        setList(w);
        dispatch({ type: 'wishlist', productIds: w.items.map((i) => i.productId) });
      })
      .catch(() => !cancelled && setList('error'));
    return () => {
      cancelled = true;
    };
  }, [api, dispatch, state.session, attempt]);

  // Hearts on the cards change the saved ids; keep this list in step without refetching.
  const shown =
    typeof list === 'object' && state.wishlist
      ? list.items.filter((i) => state.wishlist?.includes(i.productId))
      : typeof list === 'object'
        ? list.items
        : [];

  async function remove(productId: string) {
    setError(null);
    try {
      const w = await api.removeFromWishlist(productId);
      setList(w);
      dispatch({ type: 'wishlist', productIds: w.items.map((i) => i.productId) });
    } catch (e) {
      setError(tr(errorKey(e).key));
    }
  }

  const available = shown.filter((i) => i.product);
  const gone = shown.filter((i) => !i.product);

  return (
    <Screen footer={<Tabs />}>
      <View style={{ alignItems: 'flex-start' }}>
        <Button
          variant="ghost"
          label={`${state.locale === 'ar' ? '→' : '←'} ${tr('tab.account')}`}
          onPress={() => dispatch({ type: 'navigate', route: '/account' })}
        />
      </View>
      <Title>{tr('wishlist.title')}</Title>
      {error ? <Banner kind="error">{error}</Banner> : null}
      {list === 'loading' ? (
        <ActivityIndicator color={colors.accent} accessibilityLabel={tr('common.loading')} />
      ) : list === 'error' ? (
        <Banner
          kind="error"
          action={
            <Button
              variant="secondary"
              label={tr('common.retry')}
              onPress={() => setAttempt((n) => n + 1)}
            />
          }
        >
          {tr('store.loadError')}
        </Banner>
      ) : shown.length === 0 ? (
        <>
          <Body muted>{tr('wishlist.empty')}</Body>
          <Button
            label={tr('wishlist.browse')}
            onPress={() => dispatch({ type: 'search', filters: {} })}
          />
        </>
      ) : (
        <>
          <View style={gridStyle}>
            {available.map((i) =>
              i.product ? <ProductCard key={i.productId} product={i.product} /> : null,
            )}
          </View>
          {gone.length > 0 ? (
            <>
              <Text style={styles.section} accessibilityRole="header">
                {tr('wishlist.unavailable')}
              </Text>
              {gone.map((i) => (
                <View key={i.productId} style={styles.gone}>
                  <Body muted>{tr('wishlist.unavailableItem')}</Body>
                  <Button
                    variant="secondary"
                    label={tr('wishlist.removeShort')}
                    onPress={() => void remove(i.productId)}
                  />
                </View>
              ))}
            </>
          ) : null}
        </>
      )}
    </Screen>
  );
}

const styles = StyleSheet.create({
  section: { marginTop: spacing[2], fontSize: 18, fontWeight: '700', color: colors.text },
  gone: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing[1],
    flexWrap: 'wrap',
  },
});
