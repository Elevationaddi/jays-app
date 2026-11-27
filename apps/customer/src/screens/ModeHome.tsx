import { colors, radius, spacing } from '@jays/ui';
import { StyleSheet, Text, View } from 'react-native';
import { ModeSwitch } from '../components/ModeSwitch';
import { Tabs } from '../components/Tabs';
import { Body, Screen, Title } from '../components/ui';
import { useApp } from '../context';

/**
 * /shop and /services home. Catalog and venues arrive in phases 3 and 4; until then this shows an
 * honest empty state instead of placeholder listings (nothing is public before approval).
 */
export function ModeHome() {
  const { state, tr } = useApp();
  const shop = state.mode !== 'services';
  const name = state.session?.user.displayName;
  return (
    <Screen footer={<Tabs />}>
      <ModeSwitch />
      <Body muted>{name ? tr('gateway.greeting', { name }) : tr('gateway.greetingAnonymous')}</Body>
      <Title>{tr(shop ? 'shop.home.title' : 'services.home.title')}</Title>
      <View style={styles.empty} accessibilityRole="summary">
        <Text style={{ fontSize: 40 }} accessibilityElementsHidden importantForAccessibility="no">
          {shop ? '🛍' : '📅'}
        </Text>
        <Body muted>{tr(shop ? 'shop.empty' : 'services.empty')}</Body>
      </View>
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
});
