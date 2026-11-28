import type {
  CategoryView,
  ProductFacets,
  ProductSort,
  PublicProductListItem,
} from '@jays/contracts';
import { colors, spacing } from '@jays/ui';
import { useEffect, useState } from 'react';
import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';
import { Chips } from '../components/Picker';
import { ModeSwitch } from '../components/ModeSwitch';
import { gridStyle, ProductCard } from '../components/ProductCard';
import { Tabs } from '../components/Tabs';
import { Banner, Body, Button, Checkbox, Field, Screen, Title } from '../components/ui';
import { useApp } from '../context';
import type { SearchFilters } from '../state';

const SORTS: ProductSort[] = ['newest', 'popular', 'rating', 'discount', 'price_asc', 'price_desc'];
const PAGE = 20;

/** "12.50" to fils; blank or unreadable is no limit. */
function toFils(text: string): number | undefined {
  const t = text.trim();
  if (!/^\d{1,7}(\.\d{1,2})?$/.test(t)) return undefined;
  return Math.round(Number(t) * 100);
}
const toAed = (fils: number | undefined) => (fils === undefined ? '' : String(fils / 100));

/**
 * /shop/search: text search over product titles and brands, with category, brand, price, stock,
 * sale and rating filters, and six sorts. Counts come from the server for the same filters.
 */
export function SearchScreen() {
  const { state, api, dispatch, tr } = useApp();
  const f = state.search;
  const [text, setText] = useState(f.q ?? '');
  const [min, setMin] = useState(toAed(f.minPriceFils));
  const [max, setMax] = useState(toAed(f.maxPriceFils));
  const [categories, setCategories] = useState<CategoryView[]>([]);
  const [facets, setFacets] = useState<ProductFacets | null>(null);
  const [items, setItems] = useState<PublicProductListItem[] | 'loading' | 'error'>('loading');
  const [cursor, setCursor] = useState<string | null>(null);
  const [more, setMore] = useState(false);
  const [attempt, setAttempt] = useState(0);

  const set = (patch: Partial<SearchFilters>) =>
    dispatch({ type: 'search', filters: { ...f, ...patch } });
  const params = {
    q: f.q,
    category: f.category,
    brand: f.brand,
    onSale: f.onSale || undefined,
    availability: f.inStock ? ('in_stock' as const) : undefined,
    minRating: f.minRating,
    minPriceFils: f.minPriceFils,
    maxPriceFils: f.maxPriceFils,
  };
  const key = JSON.stringify([params, f.sort]);

  useEffect(() => {
    api
      .categories('shop')
      .then((c) => setCategories(c.items.filter((x) => x.depth === 0)))
      .catch(() => setCategories([]));
  }, [api]);

  useEffect(() => {
    let cancelled = false;
    setItems('loading');
    Promise.all([
      api.products({ ...params, sort: f.sort ?? 'newest', limit: PAGE }),
      api.productFacets(params),
    ])
      .then(([page, counts]) => {
        if (cancelled) return;
        setItems(page.items);
        setCursor(page.nextCursor);
        setFacets(counts);
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
      const page = await api.products({ ...params, sort: f.sort ?? 'newest', limit: PAGE, cursor });
      setItems([...items, ...page.items]);
      setCursor(page.nextCursor);
    } catch {
      setAttempt((n) => n + 1);
    } finally {
      setMore(false);
    }
  }

  const applyText = () => set({ q: text.trim() || undefined });
  const applyPrice = () => set({ minPriceFils: toFils(min), maxPriceFils: toFils(max) });
  const filtered =
    Boolean(f.q || f.category || f.brand || f.onSale || f.inStock || f.minRating) ||
    f.minPriceFils !== undefined ||
    f.maxPriceFils !== undefined;

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
      <Title>{tr('search.title')}</Title>
      <Field
        label={tr('search.query')}
        value={text}
        onChangeText={setText}
        onSubmitEditing={applyText}
        returnKeyType="search"
        maxLength={100}
        placeholder={tr('search.placeholder')}
      />
      <Button variant="secondary" label={tr('search.go')} onPress={applyText} />

      <Text style={styles.section} accessibilityRole="header">
        {tr('search.sort')}
      </Text>
      <Chips
        label={tr('search.sort')}
        value={f.sort ?? 'newest'}
        onChange={(sort) => set({ sort })}
        options={SORTS.map((s) => ({ value: s, label: tr(`search.sort.${s}`) }))}
      />

      <Text style={styles.section} accessibilityRole="header">
        {tr('search.filters')}
      </Text>
      {categories.length > 0 ? (
        <Chips
          label={tr('categories.title')}
          value={f.category ?? 'all'}
          onChange={(c) => set({ category: c === 'all' ? undefined : c })}
          options={[
            { value: 'all', label: tr('search.allCategories') },
            ...categories.map((c) => ({ value: c.id, label: c.name[state.locale] })),
          ]}
        />
      ) : null}
      {facets && (facets.brands.length > 0 || f.brand) ? (
        <Chips
          label={tr('search.brand')}
          value={f.brand ?? 'all'}
          onChange={(b) => set({ brand: b === 'all' ? undefined : b })}
          options={[
            { value: 'all', label: tr('search.allBrands') },
            ...(facets?.brands ?? []).map((b) => ({
              value: b.id,
              label: `${b.name[state.locale]} (${b.count})`,
            })),
          ]}
        />
      ) : null}
      <Checkbox
        label={tr('search.inStock')}
        value={Boolean(f.inStock)}
        onChange={(v) => set({ inStock: v || undefined })}
      />
      <Checkbox
        label={facets ? `${tr('search.onSale')} (${facets.onSaleCount})` : tr('search.onSale')}
        value={Boolean(f.onSale)}
        onChange={(v) => set({ onSale: v || undefined })}
      />
      <Checkbox
        label={tr('search.fourStars')}
        value={f.minRating === 4}
        onChange={(v) => set({ minRating: v ? 4 : undefined })}
      />
      <View style={styles.priceRow}>
        <View style={{ flex: 1 }}>
          <Field
            label={tr('search.minPrice')}
            value={min}
            onChangeText={setMin}
            keyboardType="decimal-pad"
            ltr
            placeholder={facets && facets.priceMinFils !== null ? toAed(facets.priceMinFils) : ''}
          />
        </View>
        <View style={{ flex: 1 }}>
          <Field
            label={tr('search.maxPrice')}
            value={max}
            onChangeText={setMax}
            keyboardType="decimal-pad"
            ltr
            placeholder={facets && facets.priceMaxFils !== null ? toAed(facets.priceMaxFils) : ''}
          />
        </View>
      </View>
      <Button variant="secondary" label={tr('search.applyPrice')} onPress={applyPrice} />
      {filtered ? (
        <Button
          variant="ghost"
          label={tr('search.clear')}
          onPress={() => {
            setText('');
            setMin('');
            setMax('');
            dispatch({ type: 'search', filters: f.sort ? { sort: f.sort } : {} });
          }}
        />
      ) : null}

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
          <Text style={styles.section} accessibilityRole="header" accessibilityLiveRegion="polite">
            {tr('search.results', { count: facets?.total ?? items.length })}
          </Text>
          {items.length === 0 ? (
            <Body muted>{tr('search.empty')}</Body>
          ) : (
            <View style={gridStyle}>
              {items.map((p) => (
                <ProductCard key={p.id} product={p} />
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

const styles = StyleSheet.create({
  section: { marginTop: spacing[1], fontSize: 18, fontWeight: '700', color: colors.text },
  priceRow: { flexDirection: 'row', gap: spacing[1] },
});
