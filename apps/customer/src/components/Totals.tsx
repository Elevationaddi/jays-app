import { colors, spacing } from '@jays/ui';
import { StyleSheet, Text, View } from 'react-native';
import { useApp } from '../context';
import { money } from '../format';

/** Subtotal, delivery, VAT (included in prices) and total, from server-computed amounts. */
export function Totals({
  t,
}: {
  t: {
    subtotalFils: number;
    deliveryFils: number;
    discountFils: number;
    taxFils: number;
    totalFils: number;
  };
}) {
  const { state, tr } = useApp();
  const row = (label: string, value: string, strong = false) => (
    <View style={styles.row} key={label}>
      <Text style={[styles.text, strong && styles.strong]}>{label}</Text>
      <Text style={[styles.text, strong && styles.strong]}>{value}</Text>
    </View>
  );
  return (
    <View style={{ gap: 6 }}>
      {row(tr('money.subtotal'), money(t.subtotalFils, state.locale))}
      {row(
        tr('money.delivery'),
        t.deliveryFils ? money(t.deliveryFils, state.locale) : tr('money.free'),
      )}
      {t.discountFils ? row(tr('money.discount'), `−${money(t.discountFils, state.locale)}`) : null}
      {row(tr('money.total'), money(t.totalFils, state.locale), true)}
      {row(tr('money.vat'), money(t.taxFils, state.locale))}
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', justifyContent: 'space-between', gap: spacing[2] },
  text: { color: colors.textMuted, fontSize: 15 },
  strong: { color: colors.text, fontWeight: '700', fontSize: 17 },
});
