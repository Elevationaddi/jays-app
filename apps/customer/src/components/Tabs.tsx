import { colors, minTouchTarget } from '@jays/ui';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useApp } from '../context';

/** Bottom tabs for phase 1: the current mode's home and the shared account. */
export function Tabs() {
  const { state, dispatch, tr } = useApp();
  const home = state.mode === 'services' ? '/services' : '/shop';
  const tab = (route: '/shop' | '/services' | '/account', label: string) => {
    const selected = state.route === route || state.route === `${route}/store`;
    return (
      <Pressable
        key={route}
        accessibilityRole="tab"
        accessibilityState={{ selected }}
        onPress={() => dispatch({ type: 'navigate', route })}
        style={styles.tab}
      >
        <Text style={[styles.label, selected && { color: colors.accent }]}>{label}</Text>
      </Pressable>
    );
  };
  return (
    <View accessibilityRole="tablist" style={styles.bar}>
      {tab(home, tr('tab.home'))}
      {tab('/account', tr('tab.account'))}
    </View>
  );
}

const styles = StyleSheet.create({
  bar: {
    flexDirection: 'row',
    borderTopWidth: 1,
    borderTopColor: colors.border,
    backgroundColor: colors.surfaceRaised,
  },
  tab: { flex: 1, minHeight: minTouchTarget + 12, alignItems: 'center', justifyContent: 'center' },
  label: { fontSize: 16, fontWeight: '600', color: colors.textMuted },
});
