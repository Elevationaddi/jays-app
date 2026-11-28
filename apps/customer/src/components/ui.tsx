import { colors, minTouchTarget, radius, spacing, typography } from '@jays/ui';
import type { ReactNode } from 'react';
import {
  ActivityIndicator,
  Pressable,
  SafeAreaView,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  type TextInputProps,
  View,
} from 'react-native';
import { IS_STAGING } from '../api';
import { useApp } from '../context';

export function Screen({ children, footer }: { children: ReactNode; footer?: ReactNode }) {
  const { rtl, tr } = useApp();
  return (
    <SafeAreaView style={[styles.screen, { direction: rtl ? 'rtl' : 'ltr' }]}>
      {IS_STAGING ? (
        <Text accessibilityRole="text" style={styles.stagingNotice}>
          {tr('staging.notice')}
        </Text>
      ) : null}
      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        {children}
      </ScrollView>
      {footer}
    </SafeAreaView>
  );
}

export function Title({ children }: { children: ReactNode }) {
  return (
    <Text accessibilityRole="header" style={styles.title}>
      {children}
    </Text>
  );
}

export function Body({ children, muted }: { children: ReactNode; muted?: boolean }) {
  return <Text style={[styles.body, muted ? styles.muted : null]}>{children}</Text>;
}

export function Button({
  label,
  onPress,
  variant = 'primary',
  disabled,
  busy,
  accessibilityHint,
}: {
  label: string;
  onPress: () => void;
  variant?: 'primary' | 'secondary' | 'ghost';
  disabled?: boolean;
  busy?: boolean;
  accessibilityHint?: string;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ disabled: Boolean(disabled || busy), busy: Boolean(busy) }}
      accessibilityHint={accessibilityHint}
      disabled={disabled || busy}
      onPress={onPress}
      style={({ pressed }) => [
        styles.button,
        variant === 'secondary' && styles.buttonSecondary,
        variant === 'ghost' && styles.buttonGhost,
        (disabled || busy) && { opacity: 0.5 },
        pressed && { opacity: 0.85 },
      ]}
    >
      {busy ? (
        <ActivityIndicator color={variant === 'primary' ? colors.onAccent : colors.accent} />
      ) : (
        <Text style={[styles.buttonText, variant !== 'primary' && { color: colors.accent }]}>
          {label}
        </Text>
      )}
    </Pressable>
  );
}

export function Field({
  label,
  hint,
  ltr,
  ...input
}: TextInputProps & { label: string; hint?: string; ltr?: boolean }) {
  const { rtl } = useApp();
  return (
    <View style={styles.field}>
      <Text style={styles.label}>{label}</Text>
      <TextInput
        accessibilityLabel={label}
        accessibilityHint={hint}
        placeholderTextColor={colors.textMuted}
        style={[
          styles.input,
          {
            textAlign: ltr || !rtl ? 'left' : 'right',
            writingDirection: ltr ? 'ltr' : rtl ? 'rtl' : 'ltr',
          },
        ]}
        {...input}
      />
      {hint ? <Text style={[styles.body, styles.muted, { fontSize: 14 }]}>{hint}</Text> : null}
    </View>
  );
}

export function Banner({
  kind,
  children,
  action,
}: {
  kind: 'error' | 'info';
  children: ReactNode;
  action?: ReactNode;
}) {
  return (
    <View
      accessibilityRole="alert"
      style={[styles.banner, kind === 'error' ? styles.bannerError : styles.bannerInfo]}
    >
      <Text style={[styles.body, kind === 'error' && { color: colors.danger }]}>{children}</Text>
      {action}
    </View>
  );
}

export function Checkbox({
  label,
  value,
  onChange,
}: {
  label: string;
  value: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <Pressable
      accessibilityRole="checkbox"
      accessibilityState={{ checked: value }}
      onPress={() => onChange(!value)}
      style={styles.check}
    >
      <View style={[styles.box, value && styles.boxOn]}>
        {value ? <Text style={{ color: colors.onAccent, fontWeight: '700' }}>✓</Text> : null}
      </View>
      <Text style={[styles.body, { flex: 1 }]}>{label}</Text>
    </Pressable>
  );
}

export const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.surface },
  stagingNotice: {
    backgroundColor: '#FBF1E4',
    color: colors.text,
    fontSize: 13,
    paddingHorizontal: spacing[2],
    paddingVertical: 6,
    textAlign: 'center',
  },
  content: { padding: spacing[3], paddingBottom: spacing[6], gap: spacing[2] },
  title: { color: colors.text, fontSize: 28, fontWeight: '700' },
  body: { color: colors.text, fontSize: typography.minBodySize, lineHeight: 24 },
  muted: { color: colors.textMuted },
  button: {
    minHeight: minTouchTarget,
    borderRadius: radius.sm,
    backgroundColor: colors.accent,
    borderWidth: 1,
    borderColor: colors.accent,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: spacing[3],
  },
  buttonSecondary: { backgroundColor: 'transparent' },
  buttonGhost: { backgroundColor: 'transparent', borderColor: 'transparent' },
  buttonText: { color: colors.onAccent, fontSize: typography.minBodySize, fontWeight: '600' },
  field: { gap: 6 },
  label: { color: colors.text, fontSize: typography.minBodySize, fontWeight: '600' },
  input: {
    minHeight: minTouchTarget,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.sm,
    backgroundColor: colors.surfaceRaised,
    paddingHorizontal: 12,
    fontSize: typography.minBodySize,
    color: colors.text,
  },
  banner: { borderRadius: radius.sm, padding: spacing[2], borderWidth: 1, gap: spacing[1] },
  bannerError: { backgroundColor: '#FBEAEA', borderColor: '#E6B8B8' },
  bannerInfo: { backgroundColor: '#FBF1E4', borderColor: '#ECD6B8' },
  check: { flexDirection: 'row', gap: 12, alignItems: 'flex-start', minHeight: minTouchTarget },
  box: {
    width: 24,
    height: 24,
    borderRadius: 4,
    borderWidth: 2,
    borderColor: colors.accent,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 2,
  },
  boxOn: { backgroundColor: colors.accent },
});
