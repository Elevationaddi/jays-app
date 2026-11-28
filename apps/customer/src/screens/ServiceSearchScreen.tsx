import type { PublicServiceListItem, ServiceSort } from '@jays/contracts';
import { colors, radius, spacing } from '@jays/ui';
import { useEffect, useState } from 'react';
import { ActivityIndicator, Image, Pressable, StyleSheet, Text, View } from 'react-native';
import { Chips } from '../components/Picker';
import { ModeSwitch } from '../components/ModeSwitch';
import { RatingLine } from '../components/ProductCard';
import { Tabs } from '../components/Tabs';
import { Banner, Body, Button, Checkbox, Field, Screen, Title } from '../components/ui';
import { useApp } from '../context';
import { money } from '../format';
import type { ServiceFilters } from '../state';

const SORTS: ServiceSort[] = ['relevance', 'popular', 'rating', 'price_asc', 'price_desc'];
const PAGE = 20;

/**
 * /services/search (phase 8.7): bookable services across venues in the customer's emirate, by
 * text, at the venue or at home, rating, and five sorts. Tapping a result opens its booking page.
 */
export function ServiceSearchScreen() {
  const { state, api, dispatch, tr } = useApp();
  const f = state.serviceSearch;
  const [text, setText] = useState(f.q ?? '');
  const [items, setItems] = useState<PublicServiceListItem[] | 'loading' | 'error'>('loading');
  const [cursor, setCursor] = useState<string | null>(null);
  const [more, setMore] = useState(false);
  const [attempt, setAttempt] = useState(0);

  const set = (patch: Partial<ServiceFilters>) =>
    dispatch({ type: 'searchServices', filters: { ...f, ...patch } });
  const params = {
    q: f.q,
    location: f.location,
    minRating: f.minRating,
    emirate: state.emirate ?? undefined,
    sort: f.sort ?? ('relevance' as const),
  };
  const key = JSON.stringify(params);

  useEffect(() => {
    let cancelled = false;
    setItems('loading');
    api
      .searchServices({ ...params, limit: PAGE })
      .then((page) => {
        if (cancelled) return;
        setItems(page.items);
        setCursor(page.nextCursor);
      })
      .catch(() => !cancelled && setItems('error'));
    return () => {
      cancelled = true;
    };
  }, [api, key, attempt]);

  async function loadMore() {
    if (!cursor || typeof items !== 'object') return;
    setMore(true);
    try {
      const page = await api.searchServices({ ...params, limit: PAGE, cursor });
      setItems([...items, ...page.items]);
      setCursor(page.nextCursor);
    } catch {
      setAttempt((n) => n + 1);
    } finally {
      setMore(false);
    }
  }

  const applyText = () => set({ q: text.trim() || undefined });

  return (
    <Screen footer={<Tabs />}>
      <ModeSwitch />
      <View style={{ alignItems: 'flex-start' }}>
        <Button
          variant="ghost"
          label={`${state.locale === 'ar' ? '→' : '←'} ${tr('store.back')}`}
          onPress={() => dispatch({ type: 'navigate', route: '/services' })}
        />
      </View>
      <Title>{tr('serviceSearch.title')}</Title>
      <Field
        label={tr('search.query')}
        value={text}
        onChangeText={setText}
        onSubmitEditing={applyText}
        returnKeyType="search"
        maxLength={100}
        placeholder={tr('serviceSearch.placeholder')}
      />
      <Button variant="secondary" label={tr('search.go')} onPress={applyText} />

      <Text style={styles.section} accessibilityRole="header">
        {tr('search.sort')}
      </Text>
      <Chips
        label={tr('search.sort')}
        value={f.sort ?? 'relevance'}
        onChange={(sort) => set({ sort })}
        options={SORTS.map((s) => ({ value: s, label: tr(`serviceSearch.sort.${s}`) }))}
      />
      <Text style={styles.section} accessibilityRole="header">
        {tr('search.filters')}
      </Text>
      <Chips
        label={tr('book.where')}
        value={f.location ?? 'any'}
        onChange={(v) => set({ location: v === 'any' ? undefined : v })}
        options={[
          { value: 'any', label: tr('serviceSearch.anywhere') },
          { value: 'venue', label: tr('book.atVenue') },
          { value: 'home', label: tr('book.atHome') },
        ]}
      />
      <Checkbox
        label={tr('search.fourStars')}
        value={f.minRating === 4}
        onChange={(v) => set({ minRating: v ? 4 : undefined })}
      />

      {items === 'loading' ? (
        <ActivityIndicator color={colors.accent} accessibilityLabel={tr('common.loading')} />
      ) : items === 'error' ? (
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
          {items.length === 0 ? (
            <Body muted>{tr('serviceSearch.empty')}</Body>
          ) : (
            <View style={{ gap: spacing[1] }} accessibilityLiveRegion="polite">
              {items.map((s) => (
                <ServiceCard key={s.id} service={s} />
              ))}
            </View>
          )}
          {cursor ? (
            <Button
              variant="secondary"
              label={tr('search.more')}
              busy={more}
              onPress={() => void loadMore()}
            />
          ) : null}
        </>
      )}
    </Screen>
  );
}

function ServiceCard({ service: s }: { service: PublicServiceListItem }) {
  const { state, dispatch, tr } = useApp();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${s.title[state.locale]}, ${s.venue.name[state.locale]}`}
      onPress={() => dispatch({ type: 'openService', venueId: s.venue.id, serviceId: s.id })}
      style={styles.card}
    >
      {s.imageUrl ? (
        <Image source={{ uri: s.imageUrl }} style={styles.image} accessibilityIgnoresInvertColors />
      ) : null}
      <View style={{ flex: 1, gap: 2 }}>
        <Text style={styles.title}>{s.title[state.locale]}</Text>
        <Text style={styles.muted}>{s.venue.name[state.locale]}</Text>
        <RatingLine rating={s.rating} />
        <Text style={styles.text}>
          {tr('service.summary', {
            duration: s.durationMin,
            price: money(s.priceFils, state.locale),
          })}
        </Text>
        <Text style={styles.muted}>
          {[
            s.locationMode !== 'home' ? tr('book.atVenue') : null,
            s.locationMode !== 'in_venue' ? tr('book.atHome') : null,
            s.addonCount > 0 ? tr('serviceSearch.addons', { count: s.addonCount }) : null,
          ]
            .filter(Boolean)
            .join(' · ')}
        </Text>
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  section: { marginTop: spacing[1], fontSize: 18, fontWeight: '700', color: colors.text },
  card: {
    flexDirection: 'row',
    gap: spacing[1],
    backgroundColor: colors.surfaceRaised,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing[2],
  },
  image: { width: 72, height: 72, borderRadius: radius.md },
  title: { color: colors.text, fontSize: 16, fontWeight: '700' },
  text: { color: colors.text, fontSize: 15 },
  muted: { color: colors.textMuted, fontSize: 14 },
});
