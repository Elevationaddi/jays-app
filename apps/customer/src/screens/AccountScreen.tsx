import { colors, radius, spacing } from '@jays/ui';
import { StyleSheet, View } from 'react-native';
import { ModeSwitch } from '../components/ModeSwitch';
import { Tabs } from '../components/Tabs';
import { Body, Button, Screen, Title } from '../components/ui';
import { useApp } from '../context';
import { FALLBACK_EMIRATES } from '../location';

/** /account: shared profile across both modes. Personal data requires sign-in. */
export function AccountScreen() {
  const { state, dispatch, tr, signOut } = useApp();
  const user = state.session?.user;
  const emirate = FALLBACK_EMIRATES.find((e) => e.code === (user?.emirate ?? state.emirate));
  return (
    <Screen footer={<Tabs />}>
      <ModeSwitch />
      <Title>{tr('account.title')}</Title>
      {!user ? (
        <>
          <Body muted>{tr('account.signInPrompt')}</Body>
          <Button
            label={tr('common.signIn')}
            onPress={() => dispatch({ type: 'requireSignIn', returnTo: '/account' })}
          />
        </>
      ) : (
        <View style={styles.card}>
          <Body>{user.displayName ?? user.email ?? user.phone}</Body>
          <Body muted>{user.email ?? user.phone}</Body>
          <Body>
            {tr('account.emirate')}: {emirate ? emirate.name[state.locale] : '—'}
          </Body>
        </View>
      )}
      <Button
        variant="secondary"
        label={tr('language.switch')}
        onPress={() => dispatch({ type: 'setLocale', locale: state.locale === 'ar' ? 'en' : 'ar' })}
      />
      <Body muted>{tr('account.business')}</Body>
      {user ? <Button variant="ghost" label={tr('common.signOut')} onPress={signOut} /> : null}
    </Screen>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: colors.surfaceRaised,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing[2],
    gap: 4,
  },
});
