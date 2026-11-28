import type { ConsentRecord, Privacy, UnsubscribeResult } from '@jays/contracts';
import { colors } from '@jays/ui';
import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Platform, Share, Text, View } from 'react-native';
import { cardStyles as s } from '../components/Picker';
import { Tabs } from '../components/Tabs';
import { Banner, Body, Button, Checkbox, Field, Screen, Title } from '../components/ui';
import { useApp } from '../context';
import { errorKey } from '../errors';

const CHANNELS = ['email', 'sms', 'push'] as const;
type Channel = (typeof CHANNELS)[number];

const day = (iso: string, locale: 'en' | 'ar') =>
  new Intl.DateTimeFormat(locale === 'ar' ? 'ar-AE' : 'en-AE', {
    dateStyle: 'medium',
    timeZone: 'Asia/Dubai',
  }).format(new Date(iso));

/** Saves the export as a file on the web and opens the share sheet on a phone. */
async function saveExport(json: string) {
  if (Platform.OS === 'web' && typeof document !== 'undefined') {
    const url = URL.createObjectURL(new Blob([json], { type: 'application/json' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = 'jays-my-data.json';
    a.click();
    URL.revokeObjectURL(url);
    return;
  }
  await Share.share({ message: json });
}

/**
 * /privacy: marketing consent per channel (D15), order and appointment update channels (D14),
 * consent history, data export and account deletion (ADR-0019). Every toggle saves straight away.
 */
export function PrivacyScreen() {
  const { state, api, dispatch, tr } = useApp();
  const L = state.locale;
  const [privacy, setPrivacy] = useState<Privacy | 'error' | null>(null);
  const [history, setHistory] = useState<ConsentRecord[]>([]);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [password, setPassword] = useState('');
  const [reason, setReason] = useState('');

  const load = useCallback(() => {
    Promise.all([api.privacy(), api.consentHistory({ limit: 20 })])
      .then(([p, h]) => {
        setPrivacy(p);
        setHistory(h.items);
      })
      .catch(() => setPrivacy('error'));
  }, [api]);

  useEffect(() => {
    if (!state.session) {
      dispatch({ type: 'requireSignIn', returnTo: '/privacy' });
      return;
    }
    load();
  }, [dispatch, load, state.session]);

  const run = (task: () => Promise<string | null>) => {
    setBusy(true);
    setError(null);
    setNotice(null);
    task()
      .then((n) => setNotice(n))
      .catch((e: unknown) => {
        const { key } = errorKey(e);
        setError(tr(key));
      })
      .finally(() => setBusy(false));
  };

  const toggle = (group: 'marketing' | 'notifications', c: Channel, value: boolean) =>
    run(async () => {
      const p = await api.updatePrivacy({ [group]: { [c]: value }, locale: L });
      setPrivacy(p);
      if (group === 'marketing') setHistory((await api.consentHistory({ limit: 20 })).items);
      return tr('privacy.saved');
    });

  const exportData = () =>
    run(async () => {
      const data = await api.exportMyData();
      await saveExport(JSON.stringify(data, null, 2));
      return tr('privacy.exportReady');
    });

  const requestDeletion = () =>
    run(async () => {
      const p = await api.requestAccountDeletion(password, reason.trim() || undefined);
      setPrivacy(p);
      setDeleting(false);
      setPassword('');
      setReason('');
      return null;
    });

  const keepAccount = () =>
    run(async () => {
      setPrivacy(await api.cancelAccountDeletion());
      return tr('privacy.deleteKept');
    });

  return (
    <Screen footer={<Tabs />}>
      <View style={{ alignItems: 'flex-start' }}>
        <Button
          variant="ghost"
          label={`${L === 'ar' ? '→' : '←'} ${tr('account.title')}`}
          onPress={() => dispatch({ type: 'navigate', route: '/account' })}
        />
      </View>
      <Title>{tr('privacy.title')}</Title>
      {privacy === null ? (
        <ActivityIndicator color={colors.accent} accessibilityLabel={tr('common.loading')} />
      ) : privacy === 'error' ? (
        <Banner kind="error">{tr('common.error')}</Banner>
      ) : (
        <>
          {notice ? <Banner kind="info">{notice}</Banner> : null}
          {error ? <Banner kind="error">{error}</Banner> : null}

          <View style={s.card}>
            <Text style={s.section}>{tr('privacy.marketingTitle')}</Text>
            <Body muted>{tr('privacy.marketingHint')}</Body>
            {CHANNELS.map((c) => (
              <Checkbox
                key={c}
                label={tr(`privacy.channel.${c}`)}
                value={privacy.marketing[c]}
                onChange={(v) => !busy && toggle('marketing', c, v)}
              />
            ))}
          </View>

          <View style={s.card}>
            <Text style={s.section}>{tr('privacy.notifyTitle')}</Text>
            <Body muted>{tr('privacy.notifyHint')}</Body>
            {CHANNELS.map((c) => (
              <Checkbox
                key={c}
                label={tr(`privacy.channel.${c}`)}
                value={privacy.notifications[c]}
                onChange={(v) => !busy && toggle('notifications', c, v)}
              />
            ))}
          </View>

          <View style={s.card}>
            <Text style={s.section}>{tr('privacy.history')}</Text>
            {history.length === 0 ? (
              <Body muted>{tr('privacy.historyEmpty')}</Body>
            ) : (
              history.map((r) => (
                <Text key={r.id} style={s.muted}>
                  {tr(`privacy.channel.${r.purpose.replace('marketing_', '') as Channel}`)} ·{' '}
                  {r.granted ? tr('privacy.granted') : tr('privacy.withdrawn')} ·{' '}
                  {tr(`privacy.source.${r.source}`)} · {day(r.createdAt, L)}
                </Text>
              ))
            )}
          </View>

          <View style={s.card}>
            <Text style={s.section}>{tr('privacy.export')}</Text>
            <Body muted>{tr('privacy.exportHint')}</Body>
            <Button
              variant="secondary"
              label={tr('privacy.export')}
              busy={busy}
              onPress={exportData}
            />
          </View>

          <View style={s.card}>
            <Text style={s.section}>{tr('privacy.deleteTitle')}</Text>
            {privacy.deletion ? (
              <>
                <Body>
                  {tr('privacy.deleteScheduled', { date: day(privacy.deletion.scheduledFor, L) })}
                </Body>
                {privacy.deletion.postponedReason ? (
                  <Body muted>
                    {tr('privacy.deletePostponed', {
                      reason: tr(`privacy.blocker.${privacy.deletion.postponedReason}`),
                    })}
                  </Body>
                ) : null}
                <Button label={tr('privacy.deleteKeep')} busy={busy} onPress={keepAccount} />
              </>
            ) : (
              <>
                <Body muted>
                  {tr('privacy.deleteHint', { days: String(privacy.deletionGraceDays) })}
                </Body>
                {deleting ? (
                  <>
                    <Field
                      label={tr('privacy.deletePassword')}
                      value={password}
                      onChangeText={setPassword}
                      secureTextEntry
                      autoComplete="current-password"
                    />
                    <Field
                      label={tr('privacy.deleteReason')}
                      value={reason}
                      onChangeText={setReason}
                      maxLength={1000}
                    />
                    <Button
                      label={tr('privacy.deleteConfirm')}
                      busy={busy}
                      disabled={password.length === 0}
                      onPress={requestDeletion}
                    />
                    <Button
                      variant="ghost"
                      label={tr('common.cancel')}
                      onPress={() => setDeleting(false)}
                    />
                  </>
                ) : (
                  <Button
                    variant="secondary"
                    label={tr('privacy.deleteStart')}
                    onPress={() => setDeleting(true)}
                  />
                )}
              </>
            )}
          </View>
        </>
      )}
    </Screen>
  );
}

/** /unsubscribe: one-click withdrawal from a marketing message, no sign-in needed. */
export function UnsubscribeScreen() {
  const { state, api, dispatch, tr } = useApp();
  const token = state.unsubscribeToken ?? '';
  const [check, setCheck] = useState<UnsubscribeResult | 'invalid' | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api
      .checkUnsubscribe(token)
      .then(setCheck)
      .catch(() => setCheck('invalid'));
  }, [api, token]);

  const confirm = () => {
    setBusy(true);
    setError(null);
    api
      .unsubscribe(token)
      .then(setCheck)
      .catch((e: unknown) => setError(tr(errorKey(e).key)))
      .finally(() => setBusy(false));
  };

  const channel = check && check !== 'invalid' ? tr(`unsubscribe.channel.${check.channel}`) : '';

  return (
    <Screen>
      <Title>{tr('unsubscribe.title')}</Title>
      {check === null ? (
        <ActivityIndicator color={colors.accent} accessibilityLabel={tr('common.loading')} />
      ) : check === 'invalid' ? (
        <Banner kind="error">{tr('unsubscribe.invalid')}</Banner>
      ) : check.done ? (
        <Banner kind="info">{tr('unsubscribe.done', { channel })}</Banner>
      ) : (
        <>
          <Body>{tr('unsubscribe.prompt', { channel })}</Body>
          {error ? <Banner kind="error">{error}</Banner> : null}
          <Button label={tr('unsubscribe.confirm')} busy={busy} onPress={confirm} />
        </>
      )}
      <Button
        variant="ghost"
        label={tr('common.continue')}
        onPress={() => dispatch({ type: 'navigate', route: '/welcome' })}
      />
    </Screen>
  );
}
