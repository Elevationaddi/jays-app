import type { Emirate } from '@jays/contracts';
import type { Mode } from '@jays/domain';
import { colors, minTouchTarget, radius, spacing } from '@jays/ui';
import * as Location from 'expo-location';
import { useCallback, useEffect, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { Banner, Body, Button, Screen, Title } from '../components/ui';
import { useApp } from '../context';
import { FALLBACK_EMIRATES, nearestEmirate } from '../location';

/** /welcome: language, emirate (manual always works), and two equal mode cards. */
export function WelcomeScreen() {
  const { state, dispatch, api, tr } = useApp();
  const [emirates, setEmirates] = useState<Emirate[] | null>(null);
  const [offline, setOffline] = useState(false);
  const [locationNote, setLocationNote] = useState<'denied' | 'unavailable' | 'matched' | null>(
    null,
  );
  const [locating, setLocating] = useState(false);

  const load = useCallback(() => {
    setOffline(false);
    api
      .emirates()
      .then((r) => setEmirates(r.items))
      .catch(() => {
        setOffline(true);
        setEmirates(FALLBACK_EMIRATES);
      });
  }, [api]);
  useEffect(load, [load]);

  async function useLocation() {
    setLocating(true);
    try {
      const permission = await Location.requestForegroundPermissionsAsync();
      if (permission.status !== 'granted') {
        setLocationNote('denied');
        return;
      }
      const position = await Location.getCurrentPositionAsync({
        accuracy: Location.Accuracy.Balanced,
      });
      dispatch({
        type: 'setEmirate',
        emirate: nearestEmirate(position.coords.latitude, position.coords.longitude),
      });
      setLocationNote('matched');
    } catch {
      setLocationNote('unavailable');
    } finally {
      setLocating(false);
    }
  }

  const card = (mode: Mode) => (
    <Pressable
      key={mode}
      accessibilityRole="button"
      accessibilityLabel={tr(mode === 'shop' ? 'mode.shop' : 'mode.services')}
      accessibilityHint={tr(
        mode === 'shop' ? 'mode.shop.description' : 'mode.services.description',
      )}
      onPress={() => dispatch({ type: 'chooseMode', mode })}
      style={({ pressed }) => [styles.card, pressed && { opacity: 0.9 }]}
    >
      <View style={styles.icon}>
        <Text style={{ fontSize: 28 }} accessibilityElementsHidden importantForAccessibility="no">
          {mode === 'shop' ? '🛍' : '📅'}
        </Text>
      </View>
      <Text style={styles.cardTitle}>{tr(mode === 'shop' ? 'mode.shop' : 'mode.services')}</Text>
      <Body muted>
        {tr(mode === 'shop' ? 'mode.shop.description' : 'mode.services.description')}
      </Body>
    </Pressable>
  );

  return (
    <Screen>
      <View style={styles.header}>
        <Text style={styles.brand}>{tr('app.name')}</Text>
        <Button
          variant="ghost"
          label={tr('language.switch')}
          accessibilityHint={tr('language.label')}
          onPress={() =>
            dispatch({ type: 'setLocale', locale: state.locale === 'ar' ? 'en' : 'ar' })
          }
        />
      </View>
      <Title>{tr('welcome.title')}</Title>
      <Body muted>{tr('welcome.subtitle')}</Body>

      <Text style={styles.section}>{tr('welcome.emirate')}</Text>
      {offline ? (
        <Banner
          kind="info"
          action={<Button variant="secondary" label={tr('common.retry')} onPress={load} />}
        >
          {tr('common.offline')}
        </Banner>
      ) : null}
      {locationNote ? (
        <Banner kind="info">
          {tr(
            locationNote === 'denied'
              ? 'welcome.location.denied'
              : locationNote === 'matched'
                ? 'welcome.location.matched'
                : 'welcome.location.unavailable',
          )}
        </Banner>
      ) : null}
      <View
        accessibilityRole="radiogroup"
        accessibilityLabel={tr('welcome.emirate.choose')}
        style={styles.chips}
      >
        {(emirates ?? []).map((e) => {
          const selected = state.emirate === e.code;
          return (
            <Pressable
              key={e.code}
              accessibilityRole="radio"
              accessibilityState={{ checked: selected }}
              onPress={() => dispatch({ type: 'setEmirate', emirate: e.code })}
              style={[styles.chip, selected && styles.chipOn]}
            >
              <Text style={[styles.chipText, selected && { color: colors.onAccent }]}>
                {e.name[state.locale]}
              </Text>
            </Pressable>
          );
        })}
      </View>
      <Button
        variant="secondary"
        label={tr('welcome.location.use')}
        busy={locating}
        onPress={useLocation}
      />

      <View style={styles.cards}>
        {card('shop')}
        {card('services')}
      </View>
      <Body muted>{tr('welcome.browseAsGuest')}</Body>
      {!state.session ? (
        <Button
          variant="ghost"
          label={tr('common.signIn')}
          onPress={() => dispatch({ type: 'requireSignIn', returnTo: '/welcome' })}
        />
      ) : null}
    </Screen>
  );
}

const styles = StyleSheet.create({
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  brand: { color: colors.accent, fontSize: 20, fontWeight: '700' },
  section: { marginTop: spacing[2], fontSize: 16, fontWeight: '700', color: colors.text },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing[1] },
  chip: {
    minHeight: minTouchTarget,
    paddingHorizontal: 14,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surfaceRaised,
    justifyContent: 'center',
  },
  chipOn: { backgroundColor: colors.accent, borderColor: colors.accent },
  chipText: { fontSize: 16, color: colors.text },
  cards: { flexDirection: 'row', gap: spacing[2], marginTop: spacing[2] },
  card: {
    flex: 1,
    backgroundColor: colors.surfaceRaised,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing[2],
    gap: spacing[1],
    minHeight: 200,
  },
  icon: {
    width: 52,
    height: 52,
    borderRadius: 14,
    backgroundColor: '#F3ECF1',
    alignItems: 'center',
    justifyContent: 'center',
  },
  cardTitle: { fontSize: 20, fontWeight: '700', color: colors.text },
});
