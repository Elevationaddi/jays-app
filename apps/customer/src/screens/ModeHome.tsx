import type { CategoryView, PublicProductListItem, PublicStore } from '@jays/contracts';
import { colors, minTouchTarget, radius, spacing } from '@jays/ui';
import { useEffect, useState } from 'react';
import { ActivityIndicator, Image, Pressable, StyleSheet, Text, View } from 'react-native';
import { ModeSwitch } from '../components/ModeSwitch';
import { ProductCard, gridStyle, toListItem } from '../components/ProductCard';
import { Tabs } from '../components/Tabs';
import { Banner, Body, Button, Field, Screen, Title } from '../components/ui';
import { useApp } from '../context';

type Load =
  | { state: 'loading' }
  | { state: 'error' }
  | {
      state: 'ready';
      categories: CategoryView[];
      stores: PublicStore[];
      products: PublicProductListItem[];
    };

/**
 * /shop and /services home: the mode's categories and approved storefronts. Only businesses that
 * passed review and are active in this mode are listed (the API enforces it). Shop mode also lists
 * approved products; booking arrives in phase 4, so services has no placeholder listings.
 */
export function ModeHome() {
  const { state, api, dispatch, tr } = useApp();
  const mode = state.mode === 'services' ? 'services' : 'shop';
  const shop = mode === 'shop';
  const name = state.session?.user.displayName;
  const [load, setLoad] = useState<Load>({ state: 'loading' });
  const [attempt, setAttempt] = useState(0);
  const [query, setQuery] = useState('');
  const [recent, setRecent] = useState<PublicProductListItem[]>([]);
  const recentKey = state.recentProductIds.slice(0, 6).join(',');

  // Recently viewed products, still on sale, in the order they were opened.
  useEffect(() => {
    if (!shop || !recentKey) return setRecent([]);
    let cancelled = false;
    Promise.all(
      recentKey.split(',').map((id) =>
        api
          .product(id)
          .then(toListItem)
          .catch(() => null),
      ),
    )
      .then((items) => !cancelled && setRecent(items.filter((p) => p !== null)))
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [api, shop, recentKey]);

  useEffect(() => {
    let cancelled = false;
    setLoad({ state: 'loading' });
    Promise.all([
      api.categories(mode),
      api.stores({ mode, limit: 50 }),
      mode === 'shop' ? api.products({ limit: 20 }) : Promise.resolve({ items: [] }),
    ])
      .then(([categories, stores, products]) => {
        if (!cancelled)
          setLoad({
            state: 'ready',
            categories: categories.items.filter((c) => c.depth === 0),
            stores: stores.items,
            products: products.items,
          });
      })
      .catch(() => {
        if (!cancelled) setLoad({ state: 'error' });
      });
    return () => {
      cancelled = true;
    };
  }, [api, mode, attempt]);

  return (
    <Screen footer={<Tabs />}>
      <ModeSwitch />
      <Body muted>{name ? tr('gateway.greeting', { name }) : tr('gateway.greetingAnonymous')}</Body>
      <Title>{tr(shop ? 'shop.home.title' : 'services.home.title')}</Title>
      {shop ? (
        <>
          <Field
            label={tr('search.query')}
            value={query}
            onChangeText={setQuery}
            returnKeyType="search"
            maxLength={100}
            placeholder={tr('search.placeholder')}
            onSubmitEditing={() =>
              dispatch({ type: 'search', filters: query.trim() ? { q: query.trim() } : {} })
            }
          />
          <View style={styles.chips}>
            <Button
              variant="secondary"
              label={tr('search.go')}
              onPress={() =>
                dispatch({ type: 'search', filters: query.trim() ? { q: query.trim() } : {} })
              }
            />
            <Button
              variant="ghost"
              label={tr('search.deals')}
              onPress={() =>
                dispatch({ type: 'search', filters: { onSale: true, sort: 'discount' } })
              }
            />
            <Button
              variant="ghost"
              label={tr('search.bestSellers')}
              onPress={() => dispatch({ type: 'search', filters: { sort: 'popular' } })}
            />
          </View>
        </>
      ) : (
        <>
          <Field
            label={tr('search.query')}
            value={query}
            onChangeText={setQuery}
            returnKeyType="search"
            maxLength={100}
            placeholder={tr('serviceSearch.placeholder')}
            onSubmitEditing={() =>
              dispatch({ type: 'searchServices', filters: query.trim() ? { q: query.trim() } : {} })
            }
          />
          <View style={styles.chips}>
            <Button
              variant="secondary"
              label={tr('search.go')}
              onPress={() =>
                dispatch({
                  type: 'searchServices',
                  filters: query.trim() ? { q: query.trim() } : {},
                })
              }
            />
            <Button
              variant="ghost"
              label={tr('serviceSearch.topRated')}
              onPress={() => dispatch({ type: 'searchServices', filters: { sort: 'rating' } })}
            />
            <Button
              variant="ghost"
              label={tr('serviceSearch.atHome')}
              onPress={() => dispatch({ type: 'searchServices', filters: { location: 'home' } })}
            />
          </View>
        </>
      )}
      {load.state === 'loading' ? (
        <ActivityIndicator color={colors.accent} accessibilityLabel={tr('common.loading')} />
      ) : load.state === 'error' ? (
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
      ) : (
        <>
          {load.categories.length > 0 ? (
            <>
              <Text style={styles.section} accessibilityRole="header">
                {tr('categories.title')}
              </Text>
              <View style={styles.chips}>
                {load.categories.map((c) =>
                  shop ? (
                    <Pressable
                      key={c.id}
                      accessibilityRole="button"
                      accessibilityHint={tr('search.categoryHint')}
                      onPress={() => dispatch({ type: 'search', filters: { category: c.id } })}
                      style={({ pressed }) => [styles.chip, pressed && { opacity: 0.85 }]}
                    >
                      <Text style={styles.chipText}>{c.name[state.locale]}</Text>
                    </Pressable>
                  ) : (
                    <View key={c.id} style={styles.chip}>
                      <Text style={styles.chipText}>{c.name[state.locale]}</Text>
                    </View>
                  ),
                )}
              </View>
            </>
          ) : null}
          {load.products.length > 0 ? (
            <>
              <Text style={styles.section} accessibilityRole="header">
                {tr('shop.products')}
              </Text>
              <View style={gridStyle}>
                {load.products.map((p) => (
                  <ProductCard key={p.id} product={p} />
                ))}
              </View>
            </>
          ) : null}
          <Text style={styles.section} accessibilityRole="header">
            {tr(shop ? 'shop.stores' : 'services.venues')}
          </Text>
          {load.stores.length === 0 ? (
            <View style={styles.empty} accessibilityRole="summary">
              <Text
                style={{ fontSize: 40 }}
                accessibilityElementsHidden
                importantForAccessibility="no"
              >
                {shop ? '🛍' : '📅'}
              </Text>
              <Body muted>{tr(shop ? 'shop.empty' : 'services.empty')}</Body>
            </View>
          ) : (
            load.stores.map((store) => (
              <Pressable
                key={store.id}
                accessibilityRole="button"
                accessibilityLabel={store.name[state.locale]}
                onPress={() => dispatch({ type: 'openStore', mode, storeId: store.id })}
                style={({ pressed }) => [styles.store, pressed && { opacity: 0.85 }]}
              >
                {store.bannerUrl ? (
                  <Image source={{ uri: store.bannerUrl }} style={styles.banner} alt="" />
                ) : (
                  <View style={[styles.banner, styles.placeholder]} />
                )}
                <View style={styles.storeBody}>
                  {store.logoUrl ? (
                    <Image source={{ uri: store.logoUrl }} style={styles.logo} alt="" />
                  ) : (
                    <View style={[styles.logo, styles.placeholder]} />
                  )}
                  <View style={{ flex: 1, gap: 2 }}>
                    <Text style={styles.storeName}>{store.name[state.locale]}</Text>
                    <Text style={styles.storeText} numberOfLines={2}>
                      {store.description[state.locale]}
                    </Text>
                  </View>
                </View>
              </Pressable>
            ))
          )}
        </>
      )}
      {shop && recent.length > 0 ? (
        <>
          <Text style={styles.section} accessibilityRole="header">
            {tr('shop.recentlyViewed')}
          </Text>
          <View style={gridStyle}>
            {recent.map((p) => (
              <ProductCard key={p.id} product={p} />
            ))}
          </View>
        </>
      ) : null}
      {!shop ? (
        <>
          <Text style={styles.section}>{tr('gateway.recent')}</Text>
          <Body muted>{tr('gateway.recent.empty')}</Body>
        </>
      ) : null}
    </Screen>
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
  section: { marginTop: spacing[2], fontSize: 18, fontWeight: '700', color: colors.text },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing[1] },
  chip: {
    minHeight: minTouchTarget,
    paddingHorizontal: 14,
    justifyContent: 'center',
    borderRadius: 999,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surfaceRaised,
  },
  chipText: { color: colors.text, fontSize: 15 },
  store: {
    backgroundColor: colors.surfaceRaised,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.border,
    overflow: 'hidden',
    minHeight: minTouchTarget,
  },
  banner: { width: '100%', aspectRatio: 4, backgroundColor: colors.border },
  placeholder: { backgroundColor: '#F3ECF1' },
  storeBody: { flexDirection: 'row', gap: spacing[2], padding: spacing[2], alignItems: 'center' },
  logo: { width: 56, height: 56, borderRadius: 14, backgroundColor: colors.border },
  storeName: { color: colors.text, fontSize: 17, fontWeight: '700' },
  storeText: { color: colors.textMuted, fontSize: 15, lineHeight: 21 },
});
