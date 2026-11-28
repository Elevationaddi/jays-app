import { colors, minTouchTarget, radius, spacing } from '@jays/ui';
import { Pressable, StyleSheet, Text, View } from 'react-native';

/** A row of selectable chips (radio semantics). */
export function Chips<T extends string>({
  options,
  value,
  onChange,
  label,
}: {
  options: { value: T; label: string }[];
  value: T | null;
  onChange: (value: T) => void;
  label: string;
}) {
  return (
    <View accessibilityRole="radiogroup" accessibilityLabel={label} style={styles.chips}>
      {options.map((o) => (
        <Pressable
          key={o.value}
          accessibilityRole="radio"
          accessibilityState={{ selected: o.value === value }}
          onPress={() => onChange(o.value)}
          style={[styles.chip, o.value === value && styles.on]}
        >
          <Text style={[styles.text, o.value === value && { color: colors.accent }]}>
            {o.label}
          </Text>
        </Pressable>
      ))}
    </View>
  );
}

export const cardStyles = StyleSheet.create({
  card: {
    backgroundColor: colors.surfaceRaised,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing[2],
    gap: spacing[1],
  },
  section: { marginTop: spacing[1], fontSize: 18, fontWeight: '700', color: colors.text },
  row: { flexDirection: 'row', gap: spacing[1], alignItems: 'center' },
  text: { color: colors.text, fontSize: 15, fontWeight: '600' },
  muted: { color: colors.textMuted, fontSize: 14 },
});

const styles = StyleSheet.create({
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing[1] },
  chip: {
    minHeight: Math.max(40, minTouchTarget - 4),
    paddingHorizontal: 14,
    paddingVertical: 6,
    maxWidth: '100%',
    justifyContent: 'center',
    borderRadius: 999,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surfaceRaised,
  },
  on: { borderColor: colors.accent, borderWidth: 2 },
  text: { color: colors.text, fontSize: 15, fontWeight: '600' },
});

/** Several independent choices, each toggled on or off (checkbox semantics). */
export function MultiChips<T extends string>({
  options,
  values,
  onChange,
  label,
}: {
  options: { value: T; label: string }[];
  values: readonly T[];
  onChange: (values: T[]) => void;
  label: string;
}) {
  return (
    <View accessibilityLabel={label} style={styles.chips}>
      {options.map((o) => {
        const on = values.includes(o.value);
        return (
          <Pressable
            key={o.value}
            accessibilityRole="checkbox"
            accessibilityState={{ checked: on }}
            onPress={() =>
              onChange(on ? values.filter((v) => v !== o.value) : [...values, o.value])
            }
            style={[styles.chip, on && styles.on]}
          >
            <Text style={[styles.text, on && { color: colors.accent }]}>
              {on ? '✓ ' : '+ '}
              {o.label}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}
