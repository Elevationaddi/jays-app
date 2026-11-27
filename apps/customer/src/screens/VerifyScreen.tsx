import { useEffect, useState } from 'react';
import { Banner, Body, Button, Field, Screen, Title } from '../components/ui';
import { useApp } from '../context';
import { errorKey } from '../errors';
import { saveRefreshToken } from '../secure-session';

/** /auth/verify: enter the 6-digit code; resend after the cooldown. */
export function VerifyScreen() {
  const { state, dispatch, api, tr } = useApp();
  const challenge = state.auth.challenge;
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<ReturnType<typeof errorKey> | null>(null);
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);
  if (!challenge) return null;
  const wait = Math.max(0, Math.ceil((Date.parse(challenge.resendAvailableAt) - now) / 1000));

  async function submit() {
    if (!challenge) return;
    setBusy(true);
    setError(null);
    try {
      const session = await api.verify(challenge.challengeId, code);
      await saveRefreshToken(session.tokens.refreshToken);
      dispatch({ type: 'signedIn', user: session.user, tokens: session.tokens });
    } catch (e) {
      setError(errorKey(e));
    } finally {
      setBusy(false);
    }
  }

  async function resend() {
    if (!challenge) return;
    try {
      dispatch({ type: 'challenge', challenge: await api.resend(challenge.challengeId) });
    } catch (e) {
      setError(errorKey(e));
    }
  }

  return (
    <Screen>
      <Title>{tr('auth.verify.title')}</Title>
      <Body muted>{tr('auth.verify.sentTo', { destination: `⁦${challenge.destination}⁩` })}</Body>
      {error ? <Banner kind="error">{tr(error.key, { seconds: error.seconds })}</Banner> : null}
      <Field
        label={tr('auth.code')}
        value={code}
        onChangeText={(v) => setCode(v.replace(/\D/g, '').slice(0, 6))}
        keyboardType="number-pad"
        autoComplete="one-time-code"
        textContentType="oneTimeCode"
        ltr
      />
      <Button
        label={tr('common.continue')}
        onPress={submit}
        busy={busy}
        disabled={code.length !== 6}
      />
      <Button
        variant="ghost"
        label={wait > 0 ? tr('auth.verify.resendIn', { seconds: wait }) : tr('auth.verify.resend')}
        disabled={wait > 0}
        onPress={resend}
      />
    </Screen>
  );
}
