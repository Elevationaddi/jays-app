import { colors } from '@jays/ui';
import { useEffect, useState } from 'react';
import { ActivityIndicator, Text, View } from 'react-native';
import { cardStyles as s } from '../components/Picker';
import { Tabs } from '../components/Tabs';
import { Banner, Body, Button, Screen, Title } from '../components/ui';
import { useApp } from '../context';
import { actionForLink } from '../state';

type Page = Awaited<ReturnType<ReturnType<typeof useApp>['api']['notifications']>>;

/** /notifications: in-app messages, newest first. Opening the list marks them read. */
export function NotificationsScreen() {
  const { state, api, dispatch, tr } = useApp();
  const [page, setPage] = useState<Page | 'error' | null>(null);

  useEffect(() => {
    if (!state.session) {
      dispatch({ type: 'requireSignIn', returnTo: '/notifications' });
      return;
    }
    let cancelled = false;
    api
      .notifications({ limit: 50 })
      .then(async (p) => {
        if (cancelled) return;
        setPage(p);
        // Unread items keep their highlight on this visit; the server records them as read.
        if (p.unread > 0) await api.markNotificationsRead().catch(() => undefined);
      })
      .catch(() => {
        if (!cancelled) setPage('error');
      });
    return () => {
      cancelled = true;
    };
  }, [api, dispatch, state.session]);

  const when = (iso: string) =>
    new Intl.DateTimeFormat(state.locale === 'ar' ? 'ar-AE' : 'en-AE', {
      dateStyle: 'medium',
      timeStyle: 'short',
      timeZone: 'Asia/Dubai',
    }).format(new Date(iso));

  return (
    <Screen footer={<Tabs />}>
      <View style={{ alignItems: 'flex-start' }}>
        <Button
          variant="ghost"
          label={`${state.locale === 'ar' ? '→' : '←'} ${tr('account.title')}`}
          onPress={() => dispatch({ type: 'navigate', route: '/account' })}
        />
      </View>
      <Title>{tr('inbox.title')}</Title>
      {page === null ? (
        <ActivityIndicator color={colors.accent} accessibilityLabel={tr('common.loading')} />
      ) : page === 'error' ? (
        <Banner kind="error">{tr('common.error')}</Banner>
      ) : page.items.length === 0 ? (
        <Body muted>{tr('inbox.empty')}</Body>
      ) : (
        <>
          {page.unread ? <Body muted>{tr('inbox.unread', { count: page.unread })}</Body> : null}
          {page.items.map((n) => {
            const open = n.link ? actionForLink(n.link) : null;
            return (
              <View
                key={n.id}
                style={[s.card, !n.readAt && { borderColor: colors.accent, borderWidth: 2 }]}
              >
                <Text style={s.text}>{n.title}</Text>
                <Text style={{ color: colors.text, fontSize: 16, lineHeight: 24 }}>{n.body}</Text>
                <Text style={s.muted}>{when(n.createdAt)}</Text>
                {open ? (
                  <View style={{ alignItems: 'flex-start' }}>
                    <Button
                      variant="secondary"
                      label={tr('inbox.open')}
                      onPress={() => dispatch(open)}
                    />
                  </View>
                ) : null}
              </View>
            );
          })}
        </>
      )}
    </Screen>
  );
}
