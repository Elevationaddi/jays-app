import type { CategoryView, PublicStore } from '@jays/contracts';
import { colors, minTouchTarget, radius, spacing } from '@jays/ui';
import { useEffect, useState } from 'react';
import { ActivityIndicator, Image, Pressable, StyleSheet, Text, View } from 'react-native';
import { ModeSwitch } from '../components/ModeSwitch';
import { Tabs } from '../components/Tabs';
import { Banner, Body, Button, Screen, Title } from '../components/ui';
import { useApp } from '../context';

type Load =
  | { state: 'loading' }
  | { state: 'error' }
  | { state: 'ready'; categories: CategoryView[]; stores: PublicStore[] };

/**
 * /shop and /services home: the mode's categories and approved storefronts. Only businesses that
 * passed review and are active in this mode are listed (the API enforces it). Products and booking
 * arrive in phases 3 and 4, so there are no placeholder listings.
 */
export function ModeHome() {
  const { state, api, dispatch, tr } = useApp();
  const mode = state.mode === 'services' ? 'services' : 'shop';
  const shop = mode === 'shop';
  const name = state.session?.user.displayName;
  const [load, setLoad] = useState<Load>({ state: 'loading' });
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let cancelled = false;
    setLoad({ state: 'loading' });
    Promise.all([api.categories(mode), api.stores({ mode, limit: 50 })])
      .then(([categories, stores]) => {
        if (!cancelled)
          setLoad({
            state: 'ready',
            categories: categories.items.filter((c) => c.depth === 0),
            stores: stores.items,
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
                {load.categories.map((c) => (
                  <View key={c.id} style={styles.chip}>
                    <Text style={styles.chipText}>{c.name[state.locale]}</Text>
                  </View>
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
      <Text style={styles.section}>{tr('gateway.recent')}</Text>
      <Body muted>{tr('gateway.recent.empty')}</Body>
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
    minHeight: 36,
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
