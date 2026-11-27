import type { Challenge } from '@jays/contracts';
import { useState } from 'react';
import { Banner, Body, Button, Field, Screen, Title } from '../components/ui';
import { useApp } from '../context';
import { errorKey } from '../errors';
import { saveRefreshToken } from '../secure-session';

/** /auth/reset: request a code, then set a new password (ends other sessions). */
export function ResetScreen() {
  const { dispatch, api, tr } = useApp();
  const [identifier, setIdentifier] = useState('');
  const [challenge, setChallenge] = useState<Challenge | null>(null);
  const [code, setCode] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<ReturnType<typeof errorKey> | null>(null);

  async function run(step: () => Promise<void>) {
    setBusy(true);
    setError(null);
    try {
      await step();
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
        onPress={() => dispatch({ type: 'navigate', route: '/auth' })}
      />
      <Title>{tr('auth.reset.title')}</Title>
      {error ? <Banner kind="error">{tr(error.key, { seconds: error.seconds })}</Banner> : null}
      {!challenge ? (
        <>
          <Field
            label={tr('auth.identifier')}
            value={identifier}
            onChangeText={setIdentifier}
            autoCapitalize="none"
            ltr
          />
          <Button
            label={tr('auth.reset.send')}
            busy={busy}
            disabled={!identifier}
            onPress={() =>
              run(async () => setChallenge(await api.requestPasswordReset(identifier)))
            }
          />
        </>
      ) : (
        <>
          <Body muted>
            {tr('auth.verify.sentTo', { destination: `⁦${challenge.destination}⁩` })}
          </Body>
          <Field
            label={tr('auth.code')}
            value={code}
            onChangeText={(v) => setCode(v.replace(/\D/g, '').slice(0, 6))}
            keyboardType="number-pad"
            ltr
          />
          <Field
            label={tr('auth.newPassword')}
            hint={tr('auth.password.hint')}
            value={password}
            onChangeText={setPassword}
            secureTextEntry
            autoComplete="new-password"
          />
          <Button
            label={tr('auth.reset.submit')}
            busy={busy}
            disabled={code.length !== 6 || password.length < 10}
            onPress={() =>
              run(async () => {
                const session = await api.resetPassword(challenge.challengeId, code, password);
                await saveRefreshToken(session.tokens.refreshToken);
                dispatch({ type: 'signedIn', user: session.user, tokens: session.tokens });
              })
            }
          />
        </>
      )}
    </Screen>
  );
}
