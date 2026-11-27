import { t } from '@jays/i18n';
import { colors, spacing, typography } from '@jays/ui';
import { StatusBar } from 'expo-status-bar';
import { SafeAreaView, StyleSheet, Text } from 'react-native';
import { deviceLocale, isRtl } from './locale';

// Foundation screen only. The real /welcome gateway (language, emirate, Shop Products and Book
// Services) is built in phase 1.
export function App() {
  const locale = deviceLocale([Intl.DateTimeFormat().resolvedOptions().locale]);
  const rtl = isRtl(locale);
  return (
    <SafeAreaView style={[styles.screen, { direction: rtl ? 'rtl' : 'ltr' }]}>
      <Text accessibilityRole="header" style={styles.title}>
        {t(locale, 'surface.customer')}
      </Text>
      <Text style={styles.body}>{t(locale, 'app.scaffoldNotice')}</Text>
      <StatusBar style="dark" />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: colors.surface,
    padding: spacing[3],
    justifyContent: 'center',
  },
  title: { color: colors.accent, fontSize: 28, fontWeight: '600', marginBottom: spacing[2] },
  body: { color: colors.textMuted, fontSize: typography.minBodySize },
});
