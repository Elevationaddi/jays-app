import { useState } from 'react';
import { View } from 'react-native';
import { Banner, Body, Button, Checkbox, Field, Screen, Title } from '../components/ui';
import { useApp } from '../context';
import { errorKey } from '../errors';
import { saveRefreshToken } from '../secure-session';

/** /auth: sign in or create an account with email or mobile number. */
export function AuthScreen() {
  const { state, dispatch, api, tr } = useApp();
  const [mode, setMode] = useState<'signin' | 'register'>('signin');
  const [channel, setChannel] = useState<'email' | 'phone'>('email');
  const [contact, setContact] = useState('');
  const [password, setPassword] = useState('');
  const [terms, setTerms] = useState(false);
  const [marketing, setMarketing] = useState({ email: false, sms: false, push: false });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<ReturnType<typeof errorKey> | null>(null);

  async function submit() {
    setBusy(true);
    setError(null);
    try {
      if (mode === 'signin') {
        const result = await api.login(contact, password);
        if (result.status === 'verification_required')
          dispatch({ type: 'challenge', challenge: result.challenge });
        else {
          await saveRefreshToken(result.tokens.refreshToken);
          dispatch({ type: 'signedIn', user: result.user, tokens: result.tokens });
        }
      } else {
        const challenge = await api.register({
          ...(channel === 'email' ? { email: contact } : { phone: contact }),
          password,
          locale: state.locale,
          acceptTerms: terms as true,
          marketing,
        });
        dispatch({ type: 'challenge', challenge });
      }
    } catch (e) {
      setError(errorKey(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Screen>
      <Button
        variant="ghost"
        label={`← ${tr('common.back')}`}
        onPress={() => dispatch({ type: 'navigate', route: state.auth.returnTo })}
      />
      <Title>{tr(mode === 'signin' ? 'auth.signIn.title' : 'auth.register.title')}</Title>
      {error ? <Banner kind="error">{tr(error.key, { seconds: error.seconds })}</Banner> : null}
      <Field
        label={
          mode === 'signin'
            ? tr('auth.identifier')
            : channel === 'email'
              ? tr('auth.email')
              : tr('auth.phone')
        }
        hint={mode === 'register' && channel === 'phone' ? tr('auth.phone.hint') : undefined}
        value={contact}
        onChangeText={setContact}
        autoCapitalize="none"
        autoComplete={channel === 'phone' && mode === 'register' ? 'tel' : 'username'}
        keyboardType={channel === 'phone' && mode === 'register' ? 'phone-pad' : 'email-address'}
        ltr
      />
      {mode === 'register' ? (
        <Button
          variant="ghost"
          label={channel === 'email' ? tr('auth.usePhone') : tr('auth.useEmail')}
          onPress={() => setChannel(channel === 'email' ? 'phone' : 'email')}
        />
      ) : null}
      <Field
        label={tr('auth.password')}
        hint={mode === 'register' ? tr('auth.password.hint') : undefined}
        value={password}
        onChangeText={setPassword}
        secureTextEntry
        autoComplete={mode === 'signin' ? 'current-password' : 'new-password'}
      />
      {mode === 'register' ? (
        <View style={{ gap: 4 }}>
          <Checkbox label={tr('auth.terms')} value={terms} onChange={setTerms} />
          <Body muted>{tr('auth.marketing')}</Body>
          {(['email', 'sms', 'push'] as const).map((c) => (
            <Checkbox
              key={c}
              label={tr(`auth.marketing.${c}`)}
              value={marketing[c]}
              onChange={(v) => setMarketing({ ...marketing, [c]: v })}
            />
          ))}
        </View>
      ) : null}
      <Button
        label={tr('common.continue')}
        onPress={submit}
        busy={busy}
        disabled={!contact || !password || (mode === 'register' && !terms)}
      />
      {mode === 'signin' ? (
        <Button
          variant="ghost"
          label={tr('auth.forgot')}
          onPress={() => dispatch({ type: 'navigate', route: '/auth/reset' })}
        />
      ) : null}
      <Button
        variant="ghost"
        label={mode === 'signin' ? tr('auth.noAccount') : tr('auth.haveAccount')}
        onPress={() => setMode(mode === 'signin' ? 'register' : 'signin')}
      />
      <Body muted>{tr('welcome.browseAsGuest')}</Body>
    </Screen>
  );
}
