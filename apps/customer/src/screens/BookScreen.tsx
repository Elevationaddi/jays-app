import type {
  Address,
  Availability,
  Booking,
  Emirate,
  PayBookingResponse,
  PublicVenue,
} from '@jays/contracts';
import { addDays, coverageFor, localDateOf } from '@jays/domain';
import { colors } from '@jays/ui';
import { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Text, View } from 'react-native';
import { Chips, cardStyles as s } from '../components/Picker';
import { Tabs } from '../components/Tabs';
import { Banner, Body, Button, Field, Screen, Title } from '../components/ui';
import { useApp } from '../context';
import { errorKey } from '../errors';
import { money, newIdempotencyKey, shortDate, timeIn } from '../format';

const DAYS = 14;
const ANY = 'any';

type Step =
  | { name: 'pick' }
  | { name: 'pay'; booking: Booking; payment: PayBookingResponse | null }
  | { name: 'waiting'; bookingId: string }
  | { name: 'done'; booking: Booking };

/**
 * Booking flow (docs/05-workflows.md, Appointment): branch, professional (or anyone), date and a
 * free time; holding it reserves the time for 10 minutes; paying opens the provider. The
 * appointment is confirmed only when the provider's signed webhook arrives, so the screen waits
 * for the booking status rather than assuming success.
 */
export function BookScreen() {
  const { state, api, dispatch, tr } = useApp();
  const venueId = state.storeByMode.services;
  const [venue, setVenue] = useState<PublicVenue | 'loading' | 'error'>('loading');
  const [branchId, setBranchId] = useState<string | null>(null);
  const [staffId, setStaffId] = useState<string>(ANY);
  const [date, setDate] = useState<string | null>(null);
  const [slots, setSlots] = useState<Availability | 'loading' | null>(null);
  const [slot, setSlot] = useState<string | null>(null);
  const [step, setStep] = useState<Step>({ name: 'pick' });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // One key per chosen time: retrying "Hold" after a lost response returns the same hold.
  const holdKey = useRef<{ slot: string; key: string } | null>(null);
  // Home visits (D9): where the appointment happens, and which saved address.
  const [location, setLocation] = useState<'venue' | 'home'>('venue');
  const [addresses, setAddresses] = useState<Address[] | null>(null);
  const [emirates, setEmirates] = useState<Emirate[]>([]);
  const [addressId, setAddressId] = useState<string | null>(null);
  const [form, setForm] = useState({ emirate: '', area: '', street: '', building: '' });

  useEffect(() => {
    if (!venueId) {
      setVenue('error');
      return;
    }
    let cancelled = false;
    api
      .venue(venueId)
      .then((v) => {
        if (cancelled) return;
        setVenue(v);
        const service = v.services.find((x) => x.id === state.bookServiceId);
        setBranchId(service?.branchIds[0] ?? null);
        setLocation(service?.locationMode === 'home' ? 'home' : 'venue');
        setDate(localDateOf(new Date(), v.branches[0]?.timezone ?? 'Asia/Dubai'));
      })
      .catch(() => {
        if (!cancelled) setVenue('error');
      });
    return () => {
      cancelled = true;
    };
  }, [api, venueId, state.bookServiceId]);

  const service =
    typeof venue === 'object'
      ? venue.services.find((x) => x.id === state.bookServiceId)
      : undefined;
  const branch =
    typeof venue === 'object' ? venue.branches.find((b) => b.id === branchId) : undefined;
  const timeZone = branch?.timezone ?? 'Asia/Dubai';

  // Saved addresses, once a home visit is chosen and the customer is signed in.
  useEffect(() => {
    if (location !== 'home' || !state.session || addresses !== null) return;
    Promise.all([api.addresses({ limit: 50 }), api.emirates()])
      .then(([a, e]) => {
        setAddresses(a.items);
        setEmirates(e.items);
        setAddressId((a.items.find((x) => x.isDefault) ?? a.items[0])?.id ?? null);
      })
      .catch((e) => setError(tr(errorKey(e).key)));
  }, [api, location, state.session, addresses, tr]);

  useEffect(() => {
    if (!service || !branchId || !date) return;
    let cancelled = false;
    setSlots('loading');
    setSlot(null);
    api
      .availability({
        branchId,
        serviceId: service.id,
        date,
        location,
        ...(staffId !== ANY ? { staffId } : {}),
      })
      .then((a) => {
        if (!cancelled) setSlots(a);
      })
      .catch((e) => {
        if (!cancelled) {
          setSlots(null);
          setError(tr(errorKey(e).key));
        }
      });
    return () => {
      cancelled = true;
    };
  }, [api, service, branchId, date, staffId, location, tr]);

  const run = useCallback(
    async (fn: () => Promise<void>) => {
      setBusy(true);
      setError(null);
      try {
        await fn();
      } catch (e) {
        setError(tr(errorKey(e).key));
      } finally {
        setBusy(false);
      }
    },
    [tr],
  );

  const hold = () =>
    run(async () => {
      if (!service || !branchId || !slot) return;
      if (!state.session) {
        dispatch({ type: 'requireSignIn', returnTo: '/services/book' });
        return;
      }
      if (location === 'home' && !addressId) return;
      const choice = `${slot}|${location}|${addressId ?? ''}`;
      if (holdKey.current?.slot !== choice) {
        holdKey.current = { slot: choice, key: newIdempotencyKey('hold') };
      }
      const booking = await api.holdBooking(
        {
          branchId,
          serviceId: service.id,
          startAt: slot,
          staffId: staffId === ANY ? null : staffId,
          location,
          ...(location === 'home' ? { addressId } : {}),
        },
        holdKey.current.key,
      );
      setStep({ name: 'pay', booking, payment: await api.payBooking(booking.id) });
    });

  const saveAddress = () =>
    run(async () => {
      const a = await api.createAddress({ ...form, emirate: form.emirate as Address['emirate'] });
      setAddresses((list) => [...(list ?? []), a]);
      setAddressId(a.id);
      setForm({ emirate: '', area: '', street: '', building: '' });
    });

  const pay = (payment: PayBookingResponse, outcome: 'success' | 'fail') =>
    run(async () => {
      if (!payment.paymentIntentId || !payment.paymentClientSecret) return;
      await api.mockConfirmPayment(payment.paymentIntentId, payment.paymentClientSecret, outcome);
      setStep({ name: 'waiting', bookingId: payment.bookingId });
    });

  // Wait for the provider's webhook to settle the booking (up to about 30 seconds).
  useEffect(() => {
    if (step.name !== 'waiting') return;
    let cancelled = false;
    let tries = 0;
    const tick = async () => {
      tries += 1;
      try {
        const b = await api.booking(step.bookingId);
        if (cancelled) return;
        if (b.status !== 'held') {
          setStep({ name: 'done', booking: b });
          return;
        }
      } catch {
        // keep waiting; the appointment page shows the final state too
      }
      if (!cancelled && tries < 30) setTimeout(() => void tick(), 1000);
    };
    void tick();
    return () => {
      cancelled = true;
    };
  }, [api, step]);

  const back = (
    <View style={{ alignItems: 'flex-start' }}>
      <Button
        variant="ghost"
        label={`${state.locale === 'ar' ? '→' : '←'} ${tr('store.back')}`}
        onPress={() => dispatch({ type: 'navigate', route: '/services/store' })}
      />
    </View>
  );

  if (venue === 'loading') {
    return (
      <Screen footer={<Tabs />}>
        <ActivityIndicator color={colors.accent} accessibilityLabel={tr('common.loading')} />
      </Screen>
    );
  }
  if (venue === 'error' || !service) {
    return (
      <Screen footer={<Tabs />}>
        {back}
        <Banner kind="error">{tr('store.loadError')}</Banner>
      </Screen>
    );
  }

  const staffOptions = venue.staff.filter(
    (p) => p.serviceIds.includes(service.id) && (!branchId || p.branchIds.includes(branchId)),
  );
  const today = localDateOf(new Date(), timeZone);
  const dates = Array.from({ length: DAYS }, (_, i) => addDays(today, i));
  const home = venue.homeServices;
  const offersBoth = service.locationMode === 'both' && home !== null;
  const address = addresses?.find((a) => a.id === addressId);
  const coverage = home && address ? coverageFor(home.areas, address) : null;
  const belowMinimum = home !== null && service.priceFils < home.minOrderFils;
  const homeBlocked = location === 'home' && (!address || !coverage || belowMinimum);
  const emirateName = (code: string) =>
    emirates.find((e) => e.code === code)?.name[state.locale] ?? code;
  const policy = tr('book.policy', {
    hours: service.cancelCutoffHours,
    percent: service.lateCancelRefundBps / 100,
  });

  return (
    <Screen footer={<Tabs />}>
      {step.name === 'pick' ? back : null}
      <Title>{service.title[state.locale]}</Title>
      <Body muted>
        {venue.name[state.locale]} ·{' '}
        {tr('service.summary', {
          duration: service.durationMin,
          price: money(service.priceFils, state.locale),
        })}
      </Body>
      {error ? <Banner kind="error">{error}</Banner> : null}

      {step.name === 'pick' ? (
        <>
          {offersBoth ? (
            <>
              <Text style={s.section} accessibilityRole="header">
                {tr('book.where')}
              </Text>
              <Chips
                label={tr('book.where')}
                value={location}
                onChange={setLocation}
                options={[
                  { value: 'venue', label: tr('book.atVenue') },
                  { value: 'home', label: tr('book.atHome') },
                ]}
              />
            </>
          ) : null}
          {location === 'home' && home ? (
            <View style={s.card}>
              <Text style={s.text}>{tr('book.homeAddress')}</Text>
              {!state.session ? (
                <Body muted>{tr('book.homeSignIn')}</Body>
              ) : addresses === null ? (
                <ActivityIndicator
                  color={colors.accent}
                  accessibilityLabel={tr('common.loading')}
                />
              ) : (
                <>
                  {addresses.length > 0 ? (
                    <Chips
                      label={tr('book.homeAddress')}
                      value={addressId}
                      onChange={setAddressId}
                      options={addresses.map((a) => ({
                        value: a.id,
                        label: [a.label, a.building, a.area].filter(Boolean).join(', '),
                      }))}
                    />
                  ) : (
                    <Body muted>{tr('book.noAddresses')}</Body>
                  )}
                  {address && coverage ? (
                    <Body>
                      {tr('book.travelFee', {
                        amount: money(coverage.travelFeeFils, state.locale),
                      })}
                    </Body>
                  ) : null}
                  {address && !coverage ? (
                    <Banner kind="error">{tr('book.notCovered')}</Banner>
                  ) : null}
                  {belowMinimum ? (
                    <Banner kind="error">
                      {tr('book.belowMinimum', {
                        amount: money(home.minOrderFils, state.locale),
                      })}
                    </Banner>
                  ) : null}
                  <Body muted>
                    {tr('book.coverage', {
                      areas: home.areas
                        .map(
                          (a) => `${emirateName(a.emirate)} (${a.area ?? tr('home.wholeEmirate')})`,
                        )
                        .join(', '),
                    })}
                  </Body>
                  <Text style={s.text}>{tr('checkout.addAddress')}</Text>
                  <Chips
                    label={tr('checkout.addAddress')}
                    value={form.emirate || null}
                    onChange={(emirate) => setForm({ ...form, emirate })}
                    options={[...new Set(home.areas.map((a) => a.emirate))].map((code) => ({
                      value: code,
                      label: emirateName(code),
                    }))}
                  />
                  <Field
                    label={tr('checkout.area')}
                    value={form.area}
                    onChangeText={(area) => setForm({ ...form, area })}
                  />
                  <Field
                    label={tr('checkout.street')}
                    value={form.street}
                    onChangeText={(street) => setForm({ ...form, street })}
                  />
                  <Field
                    label={tr('checkout.building')}
                    value={form.building}
                    onChangeText={(building) => setForm({ ...form, building })}
                  />
                  <Button
                    variant="secondary"
                    label={tr('checkout.saveAddress')}
                    onPress={() => void saveAddress()}
                    disabled={!form.emirate || !form.area || !form.street || !form.building}
                    busy={busy}
                  />
                </>
              )}
            </View>
          ) : null}
          {service.branchIds.length > 1 && location === 'venue' ? (
            <>
              <Text style={s.section} accessibilityRole="header">
                {tr('book.branch')}
              </Text>
              <Chips
                label={tr('book.branch')}
                value={branchId}
                onChange={(id) => {
                  setBranchId(id);
                  setStaffId(ANY);
                }}
                options={venue.branches
                  .filter((b) => service.branchIds.includes(b.id))
                  .map((b) => ({ value: b.id, label: b.name[state.locale] }))}
              />
            </>
          ) : null}
          {branch && location === 'venue' ? (
            <Body muted>{[branch.building, branch.street, branch.area].join(', ')}</Body>
          ) : null}
          <Text style={s.section} accessibilityRole="header">
            {tr('book.staff')}
          </Text>
          <Chips
            label={tr('book.staff')}
            value={staffId}
            onChange={setStaffId}
            options={[
              { value: ANY, label: tr('book.anyone') },
              ...staffOptions.map((p) => ({ value: p.id, label: p.displayName })),
            ]}
          />
          <Text style={s.section} accessibilityRole="header">
            {tr('book.date')}
          </Text>
          <Chips
            label={tr('book.date')}
            value={date}
            onChange={setDate}
            options={dates.map((d) => ({
              value: d,
              label: shortDate(`${d}T12:00:00Z`, state.locale, 'UTC'),
            }))}
          />
          <Text style={s.section} accessibilityRole="header">
            {tr('book.time')}
          </Text>
          {slots === 'loading' ? (
            <ActivityIndicator color={colors.accent} accessibilityLabel={tr('common.loading')} />
          ) : slots && slots.slots.length > 0 ? (
            <Chips
              label={tr('book.time')}
              value={slot}
              onChange={setSlot}
              options={slots.slots.map((x) => ({
                value: x.startAt,
                label: timeIn(x.startAt, state.locale, timeZone),
              }))}
            />
          ) : (
            <Body muted>{tr('book.noSlots')}</Body>
          )}
          <Body muted>{policy}</Body>
          <Button
            label={state.session ? tr('book.hold') : tr('book.signIn')}
            onPress={() => void hold()}
            disabled={!slot || (Boolean(state.session) && homeBlocked)}
            busy={busy}
          />
        </>
      ) : null}

      {step.name === 'pay' ? (
        <View style={s.card}>
          <Text style={s.text}>
            {tr('booking.at', {
              date: shortDate(step.booking.startAt, state.locale, step.booking.timeZone),
              time: timeIn(step.booking.startAt, state.locale, step.booking.timeZone),
            })}{' '}
            · {tr('booking.with', { name: step.booking.staff.displayName })}
          </Text>
          {step.booking.homeAddress ? (
            <Body>
              {tr('book.homeAt', {
                address: [
                  step.booking.homeAddress.building,
                  step.booking.homeAddress.street,
                  step.booking.homeAddress.area,
                ].join(', '),
              })}{' '}
              · {tr('book.travelFee', { amount: money(step.booking.travelFeeFils, state.locale) })}
            </Body>
          ) : null}
          <Body>
            {tr('book.held', {
              time: step.booking.holdExpiresAt
                ? timeIn(step.booking.holdExpiresAt, state.locale, step.booking.timeZone)
                : '',
            })}
          </Body>
          <Body muted>{policy}</Body>
          <Banner kind="info">{tr('checkout.mockNotice')}</Banner>
          {step.payment ? (
            <>
              <Button
                label={tr('book.pay', { amount: money(step.booking.priceFils, state.locale) })}
                onPress={() => step.payment && void pay(step.payment, 'success')}
                busy={busy}
              />
              <Button
                variant="ghost"
                label={tr('book.payFail')}
                onPress={() => step.payment && void pay(step.payment, 'fail')}
                disabled={busy}
              />
            </>
          ) : null}
        </View>
      ) : null}

      {step.name === 'waiting' ? (
        <View style={s.card}>
          <ActivityIndicator color={colors.accent} />
          <Body>{tr('book.waiting')}</Body>
        </View>
      ) : null}

      {step.name === 'done' ? (
        <View style={s.card}>
          <Banner kind={step.booking.status === 'confirmed' ? 'info' : 'error'}>
            {tr(step.booking.status === 'confirmed' ? 'book.confirmed' : 'book.failed')}
          </Banner>
          <Text style={s.text}>
            {tr('booking.at', {
              date: shortDate(step.booking.startAt, state.locale, step.booking.timeZone),
              time: timeIn(step.booking.startAt, state.locale, step.booking.timeZone),
            })}{' '}
            · {tr('booking.with', { name: step.booking.staff.displayName })}
          </Text>
          <Button
            label={tr('book.view')}
            onPress={() => dispatch({ type: 'openBooking', bookingId: step.booking.id })}
          />
        </View>
      ) : null}
    </Screen>
  );
}
