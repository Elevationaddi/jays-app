import type { PublicStore } from '@jays/contracts';
import { colors, radius, spacing } from '@jays/ui';
import { useEffect, useState } from 'react';
import { ActivityIndicator, Image, StyleSheet, Text, View } from 'react-native';
import { ModeSwitch } from '../components/ModeSwitch';
import { Tabs } from '../components/Tabs';
import { Banner, Body, Button, Screen, Title } from '../components/ui';
import { useApp } from '../context';

/**
 * A public storefront: approved, live content only. A store that is suspended or not yet approved
 * answers 404, so it shows the same "could not load" state as a missing one.
 */
export function StoreScreen() {
  const { state, api, dispatch, tr } = useApp();
  const mode = state.mode === 'services' ? 'services' : 'shop';
  const storeId = state.storeByMode[mode];
  const [store, setStore] = useState<PublicStore | 'loading' | 'error'>('loading');

  useEffect(() => {
    let cancelled = false;
    setStore('loading');
    if (!storeId) {
      setStore('error');
      return;
    }
    api
      .store(storeId)
      .then((s) => {
        if (!cancelled) setStore(s);
      })
      .catch(() => {
        if (!cancelled) setStore('error');
      });
    return () => {
      cancelled = true;
    };
  }, [api, storeId]);

  const back = (
    <Button
      variant="ghost"
      label={`${state.locale === 'ar' ? '→' : '←'} ${tr('store.back')}`}
      onPress={() => dispatch({ type: 'navigate', route: mode === 'shop' ? '/shop' : '/services' })}
    />
  );

  return (
    <Screen footer={<Tabs />}>
      <ModeSwitch />
      <View style={{ alignItems: 'flex-start' }}>{back}</View>
      {store === 'loading' ? (
        <ActivityIndicator color={colors.accent} accessibilityLabel={tr('common.loading')} />
      ) : store === 'error' ? (
        <Banner kind="error">{tr('store.loadError')}</Banner>
      ) : (
        <>
          <View style={styles.hero}>
            {store.bannerUrl ? (
              <Image source={{ uri: store.bannerUrl }} style={styles.banner} alt="" />
            ) : (
              <View style={[styles.banner, styles.placeholder]} />
            )}
            <View style={styles.head}>
              {store.logoUrl ? (
                <Image source={{ uri: store.logoUrl }} style={styles.logo} alt="" />
              ) : (
                <View style={[styles.logo, styles.placeholder]} />
              )}
            </View>
          </View>
          <Title>{store.name[state.locale]}</Title>
          <Body>{store.description[state.locale]}</Body>
          <View style={styles.note}>
            <Text
              style={{ fontSize: 28 }}
              accessibilityElementsHidden
              importantForAccessibility="no"
            >
              {mode === 'shop' ? '🛍' : '📅'}
            </Text>
            <Body muted>{tr(mode === 'shop' ? 'store.productsLater' : 'store.servicesLater')}</Body>
          </View>
        </>
      )}
    </Screen>
  );
}

const styles = StyleSheet.create({
  hero: { borderRadius: radius.lg, overflow: 'hidden', backgroundColor: colors.surfaceRaised },
  banner: { width: '100%', aspectRatio: 4 },
  placeholder: { backgroundColor: '#F3ECF1' },
  head: { paddingHorizontal: spacing[2], marginTop: -36, paddingBottom: spacing[2] },
  logo: {
    width: 72,
    height: 72,
    borderRadius: 18,
    borderWidth: 3,
    borderColor: colors.surfaceRaised,
    backgroundColor: colors.border,
  },
  note: {
    backgroundColor: colors.surfaceRaised,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing[3],
    alignItems: 'center',
    gap: spacing[1],
  },
});
