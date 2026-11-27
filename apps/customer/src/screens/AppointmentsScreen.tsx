import type { Availability, Booking } from '@jays/contracts';
import { addDays, localDateOf } from '@jays/domain';
import { colors } from '@jays/ui';
import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, Text, View } from 'react-native';
import { Chips, cardStyles as s } from '../components/Picker';
import { Tabs } from '../components/Tabs';
import { Banner, Body, Button, Screen, Title } from '../components/ui';
import { useApp } from '../context';
import { errorKey } from '../errors';
import { money, shortDate, timeIn } from '../format';

const when = (b: Booking, locale: 'en' | 'ar', tr: ReturnType<typeof useApp>['tr']) =>
  tr('booking.at', {
    date: shortDate(b.startAt, locale, b.timeZone),
    time: timeIn(b.startAt, locale, b.timeZone),
  });

/** Upcoming and past appointments. */
export function AppointmentsScreen() {
  const { state, api, dispatch, tr } = useApp();
  const [scope, setScope] = useState<'upcoming' | 'past'>('upcoming');
  const [items, setItems] = useState<Booking[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!state.session) {
      dispatch({ type: 'requireSignIn', returnTo: '/appointments' });
      return;
    }
    let cancelled = false;
    setItems(null);
    api
      .bookings({ scope, limit: 50 })
      .then((p) => {
        if (!cancelled) setItems(p.items);
      })
      .catch((e) => {
        if (!cancelled) setError(tr(errorKey(e).key));
      });
    return () => {
      cancelled = true;
    };
  }, [api, scope, state.session]);

  return (
    <Screen footer={<Tabs />}>
      <Title>{tr('appointments.title')}</Title>
      <Chips
        label={tr('appointments.title')}
        value={scope}
        onChange={setScope}
        options={[
          { value: 'upcoming', label: tr('appointments.upcoming') },
          { value: 'past', label: tr('appointments.past') },
        ]}
      />
      {error ? <Banner kind="error">{error}</Banner> : null}
      {items === null ? (
        <ActivityIndicator color={colors.accent} accessibilityLabel={tr('common.loading')} />
      ) : items.length === 0 ? (
        <Body muted>{tr('appointments.empty')}</Body>
      ) : (
        items.map((b) => (
          <Pressable
            key={b.id}
            accessibilityRole="button"
            onPress={() => dispatch({ type: 'openBooking', bookingId: b.id })}
            style={s.card}
          >
            <View style={s.row}>
              <Text style={[s.text, { flex: 1 }]}>{b.service.title[state.locale]}</Text>
              <Text style={s.muted}>{tr(`bookingStatus.${b.status}`)}</Text>
            </View>
            <Text style={s.muted}>
              {when(b, state.locale, tr)} · {tr('booking.with', { name: b.staff.displayName })}
            </Text>
            <Text style={s.muted}>
              {b.business.name[state.locale]} · {b.branch.name[state.locale]}
            </Text>
          </Pressable>
        ))
      )}
    </Screen>
  );
}

/** One appointment: details, payment if still held, cancel (with refund preview) and move. */
export function AppointmentScreen() {
  const { state, api, dispatch, tr } = useApp();
  const [booking, setBooking] = useState<Booking | 'loading' | 'error'>('loading');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [moving, setMoving] = useState(false);
  const [date, setDate] = useState<string | null>(null);
  const [slots, setSlots] = useState<Availability | 'loading' | null>(null);
  const [slot, setSlot] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!state.bookingId) return;
    try {
      setBooking(await api.booking(state.bookingId));
    } catch {
      setBooking('error');
    }
  }, [api, state.bookingId]);

  useEffect(() => {
    if (!state.session) {
      dispatch({ type: 'requireSignIn', returnTo: '/appointments' });
      return;
    }
    void load();
  }, [load, state.session]);

  useEffect(() => {
    if (!moving || typeof booking !== 'object' || !date) return;
    let cancelled = false;
    setSlots('loading');
    setSlot(null);
    api
      .availability({ branchId: booking.branch.id, serviceId: booking.service.id, date })
      .then((a) => {
        if (!cancelled) setSlots(a);
      })
      .catch(() => {
        if (!cancelled) setSlots(null);
      });
    return () => {
      cancelled = true;
    };
  }, [api, moving, booking, date]);

  const run = async (fn: () => Promise<void>) => {
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      await fn();
    } catch (e) {
      setError(tr(errorKey(e).key));
    } finally {
      setBusy(false);
    }
  };

  const back = (
    <View style={{ alignItems: 'flex-start' }}>
      <Button
        variant="ghost"
        label={`${state.locale === 'ar' ? '→' : '←'} ${tr('appointments.title')}`}
        onPress={() => dispatch({ type: 'navigate', route: '/appointments' })}
      />
    </View>
  );

  if (booking === 'loading') {
    return (
      <Screen footer={<Tabs />}>
        <ActivityIndicator color={colors.accent} accessibilityLabel={tr('common.loading')} />
      </Screen>
    );
  }
  if (booking === 'error') {
    return (
      <Screen footer={<Tabs />}>
        {back}
        <Banner kind="error">{tr('common.error')}</Banner>
      </Screen>
    );
  }

  const b = booking;
  const today = localDateOf(new Date(), b.timeZone);
  const dates = Array.from({ length: 14 }, (_, i) => addDays(today, i));

  const cancel = () =>
    run(async () => {
      setBooking(await api.cancelBooking(b.id));
      setNotice(tr('appointments.canceled'));
    });
  const move = () =>
    run(async () => {
      if (!slot) return;
      setBooking(await api.rescheduleBooking(b.id, slot, null));
      setMoving(false);
      setNotice(tr('appointments.moved'));
    });
  const payNow = () =>
    run(async () => {
      const p = await api.payBooking(b.id);
      if (p.paymentIntentId && p.paymentClientSecret) {
        await api.mockConfirmPayment(p.paymentIntentId, p.paymentClientSecret, 'success');
      }
      for (let i = 0; i < 15; i += 1) {
        const next = await api.booking(b.id);
        if (next.status !== 'held') {
          setBooking(next);
          return;
        }
        await new Promise((r) => setTimeout(r, 1000));
      }
    });

  return (
    <Screen footer={<Tabs />}>
      {back}
      <Title>{b.service.title[state.locale]}</Title>
      {notice ? <Banner kind="info">{notice}</Banner> : null}
      {error ? <Banner kind="error">{error}</Banner> : null}
      <View style={s.card}>
        <View style={s.row}>
          <Text style={[s.text, { flex: 1 }]}>{when(b, state.locale, tr)}</Text>
          <Text style={s.muted}>{tr(`bookingStatus.${b.status}`)}</Text>
        </View>
        <Text style={s.muted}>
          {tr('booking.with', { name: b.staff.displayName })} ·{' '}
          {tr('service.summary', {
            duration: b.service.durationMin,
            price: money(b.priceFils, state.locale),
          })}
        </Text>
        <Text style={s.text}>
          {b.business.name[state.locale]} · {b.branch.name[state.locale]}
        </Text>
        <Text style={s.muted}>
          {[b.branch.building, b.branch.street, b.branch.area].join(', ')}
        </Text>
        <Text style={s.muted}>
          {tr('book.policy', {
            hours: b.policy.cutoffHours,
            percent: b.policy.lateRefundBps / 100,
          })}
        </Text>
        {b.refundFils ? (
          <Text style={s.text}>
            {tr('appointments.refund', { amount: money(b.refundFils, state.locale) })}
          </Text>
        ) : null}
      </View>

      {b.status === 'held' && b.payment?.paymentIntentId ? (
        <Button label={tr('appointments.payNow')} onPress={() => void payNow()} busy={busy} />
      ) : null}

      {b.canReschedule ? (
        moving ? (
          <View style={s.card}>
            <Text style={s.section}>{tr('appointments.reschedule')}</Text>
            <Chips
              label={tr('book.date')}
              value={date}
              onChange={setDate}
              options={dates.map((d) => ({
                value: d,
                label: shortDate(`${d}T12:00:00Z`, state.locale, 'UTC'),
              }))}
            />
            {slots === 'loading' ? (
              <ActivityIndicator color={colors.accent} />
            ) : slots && slots.slots.length > 0 ? (
              <Chips
                label={tr('book.time')}
                value={slot}
                onChange={setSlot}
                options={slots.slots.map((x) => ({
                  value: x.startAt,
                  label: timeIn(x.startAt, state.locale, b.timeZone),
                }))}
              />
            ) : date ? (
              <Body muted>{tr('book.noSlots')}</Body>
            ) : null}
            <Button
              label={tr('appointments.rescheduleSave')}
              onPress={() => void move()}
              disabled={!slot}
              busy={busy}
            />
            <Button variant="ghost" label={tr('common.cancel')} onPress={() => setMoving(false)} />
          </View>
        ) : (
          <Button
            variant="secondary"
            label={tr('appointments.reschedule')}
            onPress={() => {
              setMoving(true);
              setDate(localDateOf(new Date(b.startAt), b.timeZone));
            }}
          />
        )
      ) : null}

      {b.cancelRefundFils !== null ? (
        <View style={s.card}>
          <Body muted>
            {tr('appointments.cancelRefund', { amount: money(b.cancelRefundFils, state.locale) })}
          </Body>
          <Button
            variant="ghost"
            label={tr('appointments.cancel')}
            onPress={() => void cancel()}
            busy={busy}
          />
        </View>
      ) : null}
    </Screen>
  );
}
