import type { LegalDocument, LegalDocumentSummary, MyLegal } from '@jays/contracts';
import { colors, spacing } from '@jays/ui';
import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';
import { cardStyles as s } from '../components/Picker';
import { Tabs } from '../components/Tabs';
import { Banner, Body, Button, Screen, Title } from '../components/ui';
import { useApp } from '../context';
import { actionForLink } from '../state';

/** The required documents the signed-in customer has not accepted in their current version. */
export function useLegalPending() {
  const { state, api } = useApp();
  const [mine, setMine] = useState<MyLegal | null>(null);
  const signedIn = !!state.session;
  const reload = useCallback(() => {
    if (!signedIn) return setMine(null);
    api
      .myLegal()
      .then(setMine)
      .catch(() => setMine(null));
  }, [api, signedIn]);
  useEffect(reload, [reload]);
  return { pending: mine?.pending ?? [], mine, reload };
}

/** A banner asking the customer to review and accept new versions; nothing when up to date. */
export function LegalPendingBanner() {
  const { dispatch, tr } = useApp();
  const { pending } = useLegalPending();
  if (pending.length === 0) return null;
  return (
    <Banner
      kind="info"
      action={
        <Button
          variant="secondary"
          label={tr('legal.review')}
          onPress={() => dispatch({ type: 'navigate', route: '/legal' })}
        />
      }
    >
      {tr('legal.pendingBanner')}
    </Banner>
  );
}

/** /legal: the documents in force (drafts awaiting legal review), and any to accept again. */
export function LegalScreen() {
  const { state, api, dispatch, tr } = useApp();
  const L = state.locale;
  const [docs, setDocs] = useState<LegalDocumentSummary[] | 'error' | null>(null);
  const { pending, mine, reload } = useLegalPending();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(false);
  useEffect(() => {
    api
      .legalDocuments()
      .then((r) => setDocs(r.items))
      .catch(() => setDocs('error'));
  }, [api]);

  async function acceptAll() {
    setBusy(true);
    setError(false);
    try {
      await api.acceptLegal({
        documents: pending.map((p) => ({ kind: p.kind, version: p.version })),
      });
      reload();
    } catch {
      setError(true);
    } finally {
      setBusy(false);
    }
  }

  const accepted = (kind: string, version: number) =>
    mine?.accepted.find((a) => a.kind === kind && a.version === version);
  const date = (iso: string) =>
    new Intl.DateTimeFormat(L === 'ar' ? 'ar-AE' : 'en-AE', {
      dateStyle: 'medium',
      timeZone: 'Asia/Dubai',
    }).format(new Date(iso));

  return (
    <Screen footer={<Tabs />}>
      <View style={{ alignItems: 'flex-start' }}>
        <Button
          variant="ghost"
          label={`${L === 'ar' ? '→' : '←'} ${tr('common.back')}`}
          onPress={() => dispatch({ type: 'navigate', route: '/account' })}
        />
      </View>
      <Title>{tr('legal.title')}</Title>
      <Banner kind="info">{tr('legal.draftNotice')}</Banner>
      {pending.length > 0 ? (
        <View style={s.card}>
          <Text style={s.section}>{tr('legal.newVersions')}</Text>
          {pending.map((p) => (
            <Pressable
              key={p.kind}
              accessibilityRole="link"
              onPress={() => dispatch({ type: 'openLegal', kind: p.kind })}
            >
              <Text style={styles.link}>
                {p.title[L]} · {tr('legal.version', { version: p.version })}
              </Text>
            </Pressable>
          ))}
          {error ? <Banner kind="error">{tr('legal.acceptError')}</Banner> : null}
          <Button label={tr('legal.acceptAll')} busy={busy} onPress={() => void acceptAll()} />
        </View>
      ) : null}
      {docs === null ? (
        <ActivityIndicator color={colors.accent} accessibilityLabel={tr('common.loading')} />
      ) : docs === 'error' ? (
        <Banner kind="error">{tr('store.loadError')}</Banner>
      ) : docs.length === 0 ? (
        <Body muted>{tr('legal.none')}</Body>
      ) : (
        <View style={{ gap: spacing[1] }}>
          {docs.map((d) => {
            const a = accepted(d.kind, d.version);
            return (
              <Pressable
                key={d.id}
                accessibilityRole="button"
                onPress={() => dispatch({ type: 'openLegal', kind: d.kind })}
                style={s.card}
              >
                <Text style={s.section}>{d.title[L]}</Text>
                <Text style={s.muted}>
                  {tr('legal.version', { version: d.version })} ·{' '}
                  {tr('legal.effective', { date: date(d.effectiveAt) })}
                </Text>
                {a ? (
                  <Text style={s.muted}>
                    {tr('legal.acceptedOn', { date: date(a.acceptedAt) })}
                  </Text>
                ) : null}
              </Pressable>
            );
          })}
        </View>
      )}
    </Screen>
  );
}

/** /legal/detail: one document's text, rendered from its simple Markdown. */
export function LegalDocumentScreen() {
  const { state, api, dispatch, tr } = useApp();
  const L = state.locale;
  const [doc, setDoc] = useState<LegalDocument | 'error' | null>(null);
  useEffect(() => {
    if (!state.legalKind) return;
    setDoc(null);
    api
      .legalDocument(state.legalKind)
      .then(setDoc)
      .catch(() => setDoc('error'));
  }, [api, state.legalKind]);
  return (
    <Screen footer={<Tabs />}>
      <View style={{ alignItems: 'flex-start' }}>
        <Button
          variant="ghost"
          label={`${L === 'ar' ? '→' : '←'} ${tr('legal.title')}`}
          onPress={() => dispatch({ type: 'navigate', route: '/legal' })}
        />
      </View>
      {doc === null ? (
        <ActivityIndicator color={colors.accent} accessibilityLabel={tr('common.loading')} />
      ) : doc === 'error' ? (
        <Banner kind="error">{tr('legal.notFound')}</Banner>
      ) : (
        <>
          <Title>{doc.title[L]}</Title>
          <Body muted>{tr('legal.version', { version: doc.version })}</Body>
          <Markdown text={doc.body[L]} />
        </>
      )}
    </Screen>
  );
}

const LINK = /\[([^\]]+)\]\((\/[^)\s]+)\)/g;

/** Headings, bullet points, quotes, bold and in-app links: all the drafts use. */
function Markdown({ text }: { text: string }) {
  const { dispatch } = useApp();
  const inline = (line: string, key: string) => {
    const parts: React.ReactNode[] = [];
    let last = 0;
    for (const m of line.matchAll(LINK)) {
      if (m.index! > last) parts.push(line.slice(last, m.index));
      const action = actionForLink(m[2]!);
      parts.push(
        <Text
          key={`${key}-${m.index}`}
          style={styles.link}
          accessibilityRole="link"
          onPress={action ? () => dispatch(action) : undefined}
        >
          {m[1]}
        </Text>,
      );
      last = m.index! + m[0].length;
    }
    parts.push(line.slice(last));
    return parts.map((p) => (typeof p === 'string' ? p.replace(/\*\*/g, '') : p));
  };
  return (
    <View style={{ gap: spacing[1] }}>
      {text.split('\n').map((raw, i) => {
        const line = raw.trim();
        if (!line) return null;
        const key = String(i);
        if (line.startsWith('## ')) {
          return (
            <Text key={key} style={styles.h2} accessibilityRole="header">
              {line.slice(3)}
            </Text>
          );
        }
        if (line.startsWith('> ')) {
          return (
            <Text key={key} style={styles.quote}>
              {inline(line.slice(2), key)}
            </Text>
          );
        }
        if (line.startsWith('- ')) {
          return (
            <Text key={key} style={styles.text}>
              {'•  '}
              {inline(line.slice(2), key)}
            </Text>
          );
        }
        return (
          <Text key={key} style={styles.text}>
            {inline(line, key)}
          </Text>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  h2: { color: colors.text, fontSize: 18, fontWeight: '700', marginTop: spacing[1] },
  text: { color: colors.text, fontSize: 15, lineHeight: 22 },
  quote: {
    color: colors.textMuted,
    fontSize: 14,
    lineHeight: 20,
    borderStartWidth: 3,
    borderColor: colors.accent,
    paddingStart: spacing[1],
  },
  link: { color: colors.accent, textDecorationLine: 'underline' },
});
