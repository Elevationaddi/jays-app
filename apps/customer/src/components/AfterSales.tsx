import type { OrderView } from '@jays/contracts';
import { colors } from '@jays/ui';
import { useState } from 'react';
import { Linking, Pressable, Text, View } from 'react-native';
import { useApp } from '../context';
import { errorKey } from '../errors';
import { money } from '../format';
import { Chips, cardStyles as s } from './Picker';
import { Banner, Button, Checkbox, Field } from './ui';

type Shipment = OrderView['merchants'][number];

/** Stars 1 to 5 and an optional text. Used for order items and appointments (T10). */
export function ReviewForm({
  title,
  onSubmit,
}: {
  title: string;
  onSubmit: (rating: number, body: string | undefined) => Promise<void>;
}) {
  const { tr } = useApp();
  const [rating, setRating] = useState<string | null>(null);
  const [body, setBody] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  return (
    <View style={s.card}>
      <Text style={s.section}>
        {tr('care.review')}: {title}
      </Text>
      <Chips
        label={tr('care.rating')}
        value={rating}
        onChange={setRating}
        options={['1', '2', '3', '4', '5'].map((n) => ({
          value: n,
          label: `★ ${tr('care.stars', { n })}`,
        }))}
      />
      <Field
        label={tr('care.reviewBody')}
        value={body}
        onChangeText={setBody}
        multiline
        maxLength={2000}
      />
      {error ? <Banner kind="error">{error}</Banner> : null}
      <Button
        label={tr('care.reviewSubmit')}
        disabled={!rating}
        busy={busy}
        onPress={() => {
          if (!rating) return;
          setBusy(true);
          setError(null);
          onSubmit(Number(rating), body.trim() || undefined)
            .catch((e: unknown) => setError(tr(errorKey(e).key)))
            .finally(() => setBusy(false));
        }}
      />
    </View>
  );
}

/**
 * After-sales actions for one store's part of an order: tracking, cancel before processing, return
 * after delivery, reviews of delivered items and a link to support. The API decides what is allowed
 * (`canCancel`, `canReturn`, `reviewableItemIds`); the screen only offers those actions.
 */
export function ShipmentCare({
  orderId,
  shipment,
  onChanged,
}: {
  orderId: string;
  shipment: Shipment;
  onChanged: (order: OrderView | null, notice: string) => void;
}) {
  const { state, api, dispatch, tr } = useApp();
  const [panel, setPanel] = useState<'cancel' | 'return' | null>(null);
  const [reason, setReason] = useState('');
  const [qty, setQty] = useState<Record<string, number>>({});
  const [faulty, setFaulty] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const f = shipment.fulfillment;
  const L = state.locale;

  const run = (task: () => Promise<void>) => {
    setBusy(true);
    setError(null);
    task()
      .catch((e: unknown) => setError(tr(errorKey(e).key)))
      .finally(() => setBusy(false));
  };

  const cancel = () =>
    run(async () => {
      const order = await api.cancelSuborder(orderId, {
        merchantOrderId: shipment.id,
        ...(reason.trim().length >= 3 ? { reason: reason.trim() } : {}),
      });
      setPanel(null);
      onChanged(order, tr('care.canceled'));
    });

  const items = Object.entries(qty)
    .filter(([, n]) => n > 0)
    .map(([orderItemId, n]) => ({ orderItemId, qty: n }));
  const requestReturn = () =>
    run(async () => {
      await api.requestReturn(orderId, {
        merchantOrderId: shipment.id,
        items,
        reason: reason.trim(),
        faulty,
      });
      setPanel(null);
      setQty({});
      setFaulty(false);
      onChanged(null, tr('care.returnRequested'));
    });

  const reviewable = shipment.items.filter((i) => shipment.reviewableItemIds.includes(i.id));

  return (
    <View style={{ gap: 8 }}>
      {f.carrier ? (
        <View style={s.row}>
          <Text style={[s.muted, { flex: 1 }]}>
            {tr('fulfil.shippedWith', { carrier: f.carrier })} {f.trackingNumber}
          </Text>
          {f.trackingUrl ? (
            <Pressable
              accessibilityRole="link"
              onPress={() => void Linking.openURL(f.trackingUrl as string)}
              style={{ minHeight: 44, justifyContent: 'center' }}
            >
              <Text style={[s.text, { color: colors.accent }]}>{tr('care.track')}</Text>
            </Pressable>
          ) : null}
        </View>
      ) : null}

      {shipment.returns.length ? (
        <View style={{ gap: 4 }}>
          <Text style={s.text}>{tr('care.returns')}</Text>
          {shipment.returns.map((r) => (
            <Text key={r.id} style={s.muted}>
              {tr(`returnStatus.${r.status as 'requested'}`)} · {money(r.amountFils, L)}
            </Text>
          ))}
        </View>
      ) : null}

      {error ? <Banner kind="error">{error}</Banner> : null}

      {panel === 'cancel' ? (
        <View style={{ gap: 8 }}>
          <Text style={s.muted}>{tr('care.cancelHint')}</Text>
          <Field
            label={tr('care.cancelReason')}
            value={reason}
            onChangeText={setReason}
            maxLength={1000}
          />
          <Button label={tr('care.cancelConfirm')} busy={busy} onPress={cancel} />
          <Button variant="ghost" label={tr('common.cancel')} onPress={() => setPanel(null)} />
        </View>
      ) : null}

      {panel === 'return' ? (
        <View style={{ gap: 8 }}>
          <Text style={s.muted}>{tr('care.returnHint')}</Text>
          {shipment.returnPolicy.returnUntil ? (
            <Text style={s.muted}>
              {tr('returns.until', {
                date: new Date(shipment.returnPolicy.returnUntil).toLocaleDateString(
                  L === 'ar' ? 'ar-AE' : 'en-AE',
                  { dateStyle: 'medium', timeZone: 'Asia/Dubai' },
                ),
              })}
            </Text>
          ) : null}
          {shipment.items.map((i) => {
            const n = qty[i.id] ?? 0;
            const set = (v: number) => setQty({ ...qty, [i.id]: Math.max(0, Math.min(i.qty, v)) });
            return (
              <View key={i.id} style={s.row}>
                <Text style={[s.muted, { flex: 1 }]}>
                  {tr('care.returnQty', { title: i.title[L], qty: n, max: i.qty })}
                  {i.returnable ? '' : `\n${tr('returns.itemFaultyOnly')}`}
                </Text>
                <Button
                  variant="secondary"
                  label="−"
                  onPress={() => set(n - 1)}
                  disabled={n === 0}
                  accessibilityHint={tr('care.less')}
                />
                <Button
                  variant="secondary"
                  label="+"
                  onPress={() => set(n + 1)}
                  disabled={n === i.qty}
                  accessibilityHint={tr('care.more')}
                />
              </View>
            );
          })}
          <Checkbox label={tr('returns.faulty')} value={faulty} onChange={setFaulty} />
          <Field
            label={tr('care.returnReason')}
            value={reason}
            onChangeText={setReason}
            maxLength={1000}
          />
          <Button
            label={tr('care.returnSubmit')}
            busy={busy}
            disabled={
              items.length === 0 ||
              reason.trim().length < 3 ||
              (!faulty &&
                items.some(
                  (it) => !shipment.items.find((i) => i.id === it.orderItemId)?.returnable,
                ))
            }
            onPress={requestReturn}
          />
          <Button variant="ghost" label={tr('common.cancel')} onPress={() => setPanel(null)} />
        </View>
      ) : null}

      {panel === null ? (
        <View style={{ gap: 8 }}>
          {shipment.canCancel ? (
            <Button
              variant="secondary"
              label={tr('care.cancel')}
              onPress={() => setPanel('cancel')}
            />
          ) : null}
          {shipment.canReturn ? (
            <Button
              variant="secondary"
              label={tr('care.return')}
              onPress={() => setPanel('return')}
            />
          ) : null}
        </View>
      ) : null}

      {reviewable.map((i) => (
        <ReviewForm
          key={i.id}
          title={i.title[L]}
          onSubmit={async (rating, body) => {
            await api.createReview({ orderItemId: i.id, rating, ...(body ? { body } : {}) });
            onChanged(null, tr('care.reviewed'));
          }}
        />
      ))}

      <Button
        variant="ghost"
        label={tr('care.help')}
        onPress={() => dispatch({ type: 'newTicket', draft: { type: 'order', orderId } })}
      />
    </View>
  );
}
