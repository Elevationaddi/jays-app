import type { Mode } from '@jays/domain';
import { colors, minTouchTarget, radius } from '@jays/ui';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useApp } from '../context';

/** Persistent, accessible Shop Products / Book Services switch shown in every main tab. */
export function ModeSwitch() {
  const { state, dispatch, tr } = useApp();
  const option = (mode: Mode) => {
    const selected = state.mode === mode;
    return (
      <Pressable
        key={mode}
        accessibilityRole="tab"
        accessibilityState={{ selected }}
        onPress={() => dispatch({ type: 'chooseMode', mode })}
        style={[styles.option, selected && styles.selected]}
      >
        <Text style={[styles.text, selected && styles.selectedText]}>
          {tr(mode === 'shop' ? 'mode.shop' : 'mode.services')}
        </Text>
      </Pressable>
    );
  };
  return (
    <View accessibilityRole="tablist" accessibilityLabel={tr('mode.switch')} style={styles.track}>
      {option('shop')}
      {option('services')}
    </View>
  );
}

const styles = StyleSheet.create({
  track: {
    flexDirection: 'row',
    backgroundColor: '#EFE8E1',
    borderRadius: radius.md,
    padding: 4,
    gap: 4,
  },
  option: {
    flex: 1,
    minHeight: minTouchTarget,
    borderRadius: radius.sm,
    alignItems: 'center',
    justifyContent: 'center',
  },
  selected: {
    backgroundColor: colors.surfaceRaised,
    shadowColor: '#000',
    shadowOpacity: 0.08,
    shadowRadius: 4,
    shadowOffset: { width: 0, height: 1 },
  },
  text: { color: colors.textMuted, fontSize: 16, fontWeight: '600' },
  selectedText: { color: colors.accent },
});
