import type { SupportInfo, TicketView } from '@jays/contracts';
import * as DocumentPicker from 'expo-document-picker';
import { colors } from '@jays/ui';
import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Linking, Pressable, Text, View } from 'react-native';
import { Chips, cardStyles as s } from '../components/Picker';
import { Tabs } from '../components/Tabs';
import { Banner, Body, Button, Field, Screen, Title } from '../components/ui';
import { useApp } from '../context';
import { errorKey } from '../errors';
import type { Route, TicketDraft } from '../state';

type TicketItem = Omit<TicketView, 'messages' | 'attachments'>;
const TYPES: TicketDraft['type'][] = ['order', 'booking', 'payment', 'account', 'other'];

const stamp = (iso: string, locale: 'en' | 'ar') =>
  new Intl.DateTimeFormat(locale === 'ar' ? 'ar-AE' : 'en-AE', {
    dateStyle: 'medium',
    timeStyle: 'short',
    timeZone: 'Asia/Dubai',
  }).format(new Date(iso));

function Back({ route, label }: { route: Route; label: string }) {
  const { state, dispatch } = useApp();
  return (
    <View style={{ alignItems: 'flex-start' }}>
      <Button
        variant="ghost"
        label={`${state.locale === 'ar' ? '→' : '←'} ${label}`}
        onPress={() => dispatch({ type: 'navigate', route })}
      />
    </View>
  );
}

/** /support: the customer's tickets, newest activity first, and a way to open a new one. */
export function SupportScreen() {
  const { state, api, dispatch, tr } = useApp();
  const [items, setItems] = useState<TicketItem[] | 'error' | null>(null);
  const [info, setInfo] = useState<SupportInfo | null>(null);

  useEffect(() => {
    api
      .supportInfo()
      .then(setInfo)
      .catch(() => setInfo(null));
  }, [api]);

  useEffect(() => {
    if (!state.session) {
      dispatch({ type: 'requireSignIn', returnTo: '/support' });
      return;
    }
    api
      .myTickets({ limit: 50 })
      .then((p) => setItems(p.items))
      .catch(() => setItems('error'));
  }, [api, dispatch, state.session]);

  return (
    <Screen footer={<Tabs />}>
      <Back route="/account" label={tr('account.title')} />
      <Title>{tr('support.title')}</Title>
      {info ? (
        <View style={s.card}>
          <Body>
            {tr('support.hours', {
              opens: info.hours.opens,
              closes: info.hours.closes,
              hours: String(info.firstResponseHours),
            })}
          </Body>
          <Body muted>{info.openNow ? tr('support.openNow') : tr('support.closedNow')}</Body>
        </View>
      ) : null}
      <Button
        label={tr('support.new')}
        onPress={() => dispatch({ type: 'newTicket', draft: { type: 'other' } })}
      />
      {items === null ? (
        <ActivityIndicator color={colors.accent} accessibilityLabel={tr('common.loading')} />
      ) : items === 'error' ? (
        <Banner kind="error">{tr('common.error')}</Banner>
      ) : items.length === 0 ? (
        <Body muted>{tr('support.empty')}</Body>
      ) : (
        items.map((t) => (
          <Pressable
            key={t.id}
            accessibilityRole="button"
            onPress={() => dispatch({ type: 'openTicket', ticketId: t.id })}
            style={s.card}
          >
            <View style={s.row}>
              <Text style={[s.text, { flex: 1 }]}>{t.subject}</Text>
              <Text style={s.muted}>{tr(`ticketStatus.${t.status}`)}</Text>
            </View>
            <Text style={s.muted}>
              {tr(`ticketType.${t.type}`)} · {stamp(t.lastMessageAt, state.locale)}
            </Text>
          </Pressable>
        ))
      )}
    </Screen>
  );
}

/** /support/new: a ticket, prefilled with the order or appointment it came from. */
export function NewTicketScreen() {
  const { state, api, dispatch, tr } = useApp();
  const draft = state.ticketDraft;
  const [type, setType] = useState<TicketDraft['type']>(draft.type);
  const [subject, setSubject] = useState('');
  const [body, setBody] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!state.session) dispatch({ type: 'requireSignIn', returnTo: '/support' });
  }, [dispatch, state.session]);

  const send = () => {
    setBusy(true);
    setError(null);
    api
      .openTicket({
        type,
        subject: subject.trim(),
        body: body.trim(),
        ...(draft.orderId ? { orderId: draft.orderId } : {}),
        ...(draft.bookingId ? { bookingId: draft.bookingId } : {}),
      })
      .then((t) => dispatch({ type: 'openTicket', ticketId: t.id }))
      .catch((e: unknown) => setError(tr(errorKey(e).key)))
      .finally(() => setBusy(false));
  };

  return (
    <Screen footer={<Tabs />}>
      <Back route="/support" label={tr('support.title')} />
      <Title>{tr('support.new')}</Title>
      {draft.orderId ? (
        <Body muted>
          {tr('support.aboutOrder', { id: draft.orderId.slice(0, 8).toUpperCase() })}
        </Body>
      ) : draft.bookingId ? (
        <Body muted>{tr('support.aboutBooking')}</Body>
      ) : null}
      <Chips
        label={tr('support.type')}
        value={type}
        onChange={setType}
        options={TYPES.map((t) => ({ value: t, label: tr(`ticketType.${t}`) }))}
      />
      <Field
        label={tr('support.subject')}
        value={subject}
        onChangeText={setSubject}
        maxLength={200}
      />
      <Field
        label={tr('support.body')}
        value={body}
        onChangeText={setBody}
        multiline
        maxLength={5000}
      />
      {error ? <Banner kind="error">{error}</Banner> : null}
      <Button
        label={tr('support.send')}
        busy={busy}
        disabled={subject.trim().length < 3 || body.trim().length < 1}
        onPress={send}
      />
    </Screen>
  );
}

/** /support/detail: the conversation, oldest first, with a reply box. Internal notes never arrive here. */
export function TicketScreen() {
  const { state, api, tr } = useApp();
  const [ticket, setTicket] = useState<TicketView | 'error' | null>(null);
  const [reply, setReply] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState(false);

  const load = useCallback(() => {
    if (!state.ticketId) return setTicket('error');
    api
      .myTicket(state.ticketId)
      .then(setTicket)
      .catch(() => setTicket('error'));
  }, [api, state.ticketId]);
  useEffect(load, [load]);

  const [attachNote, setAttachNote] = useState<string | null>(null);
  const attach = async () => {
    if (typeof ticket !== 'object' || !ticket) return;
    const picked = await DocumentPicker.getDocumentAsync({
      type: ['application/pdf', 'image/jpeg', 'image/png'],
      copyToCacheDirectory: true,
    });
    const file = picked.canceled ? null : picked.assets[0];
    if (!file) return;
    const contentType = file.mimeType as 'application/pdf' | 'image/jpeg' | 'image/png';
    setBusy(true);
    setError(null);
    setAttachNote(null);
    try {
      const bytes = await (await fetch(file.uri)).blob();
      const upload = await api.ticketAttachmentUpload(ticket.id, {
        fileName: file.name,
        contentType,
        sizeBytes: file.size ?? bytes.size,
      });
      await api.upload(upload, bytes);
      setTicket(await api.completeTicketAttachment(ticket.id, upload.id));
      setAttachNote(tr('support.attached'));
    } catch (e: unknown) {
      setError(tr(errorKey(e).key));
    } finally {
      setBusy(false);
    }
  };

  const open = (attachmentId: string) => {
    if (typeof ticket !== 'object' || !ticket) return;
    api
      .ticketAttachment(ticket.id, attachmentId)
      .then((link) => Linking.openURL(link.url))
      .catch((e: unknown) => setError(tr(errorKey(e).key)));
  };

  const send = () => {
    if (typeof ticket !== 'object' || !ticket) return;
    setBusy(true);
    setError(null);
    api
      .replyToTicket(ticket.id, reply.trim())
      .then((t) => {
        setTicket(t);
        setReply('');
        setSent(true);
      })
      .catch((e: unknown) => setError(tr(errorKey(e).key)))
      .finally(() => setBusy(false));
  };

  return (
    <Screen footer={<Tabs />}>
      <Back route="/support" label={tr('support.title')} />
      {ticket === null ? (
        <ActivityIndicator color={colors.accent} accessibilityLabel={tr('common.loading')} />
      ) : ticket === 'error' ? (
        <Banner kind="error">{tr('common.error')}</Banner>
      ) : (
        <>
          <Title>{ticket.subject}</Title>
          <Body muted>
            {tr(`ticketType.${ticket.type}`)} · {tr(`ticketStatus.${ticket.status}`)}
          </Body>
          {sent ? <Banner kind="info">{tr('support.sent')}</Banner> : null}
          {ticket.messages.map((m) => (
            <View
              key={m.id}
              style={[s.card, m.author === 'support' && { borderColor: colors.accent }]}
            >
              <Text style={s.text}>
                {m.author === 'customer' ? tr('support.you') : tr('support.team')}
              </Text>
              <Text style={{ color: colors.text, fontSize: 16, lineHeight: 24 }}>{m.body}</Text>
              <Text style={s.muted}>{stamp(m.createdAt, state.locale)}</Text>
            </View>
          ))}
          {ticket.attachments.length ? (
            <View style={{ gap: 4 }}>
              <Text style={s.text}>{tr('support.attachments')}</Text>
              {ticket.attachments.map((a) => (
                <Pressable
                  key={a.id}
                  accessibilityRole="link"
                  onPress={() => open(a.id)}
                  style={{ minHeight: 44, justifyContent: 'center' }}
                >
                  <Text style={[s.text, { color: colors.accent }]}>
                    {a.fileName} · {Math.ceil(a.sizeBytes / 1024)} KB
                  </Text>
                </Pressable>
              ))}
            </View>
          ) : null}
          {attachNote ? <Banner kind="info">{attachNote}</Banner> : null}
          {ticket.status === 'resolved' ? <Body muted>{tr('support.resolvedHint')}</Body> : null}
          <Field
            label={tr('support.reply')}
            value={reply}
            onChangeText={setReply}
            multiline
            maxLength={5000}
          />
          {error ? <Banner kind="error">{error}</Banner> : null}
          <Button
            label={tr('support.send')}
            busy={busy}
            disabled={reply.trim().length < 1}
            onPress={send}
          />
          <Button variant="secondary" label={tr('support.attach')} busy={busy} onPress={attach} />
        </>
      )}
    </Screen>
  );
}
