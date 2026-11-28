import type { TaxDocument } from '@jays/contracts';
import { colors } from '@jays/ui';
import { useEffect, useState } from 'react';
import { ActivityIndicator, Text, View } from 'react-native';
import { cardStyles as s } from '../components/Picker';
import { Tabs } from '../components/Tabs';
import { Banner, Body, Button, Screen, Title } from '../components/ui';
import { useApp } from '../context';
import { money } from '../format';

/** /documents/detail: one invoice or credit note from a seller, with its VAT. */
export function DocumentScreen() {
  const { state, api, dispatch, tr } = useApp();
  const L = state.locale;
  const [doc, setDoc] = useState<TaxDocument | 'error' | null>(null);
  useEffect(() => {
    if (!state.documentId) return;
    api
      .myDocument(state.documentId)
      .then(setDoc)
      .catch(() => setDoc('error'));
  }, [api, state.documentId]);

  const title = (d: TaxDocument) => {
    const credit = d.kind === 'customer_credit_note';
    if (d.taxDocument) return tr(credit ? 'tax.title.taxCreditNote' : 'tax.title.taxInvoice');
    return tr(credit ? 'tax.title.creditNote' : 'tax.title.invoice');
  };
  const date = (iso: string) =>
    new Intl.DateTimeFormat(L === 'ar' ? 'ar-AE' : 'en-AE', {
      dateStyle: 'long',
      timeZone: 'Asia/Dubai',
    }).format(new Date(iso));

  return (
    <Screen footer={<Tabs />}>
      <View style={{ alignItems: 'flex-start' }}>
        <Button
          variant="ghost"
          label={`${L === 'ar' ? '→' : '←'} ${tr('common.back')}`}
          onPress={() => dispatch({ type: 'navigate', route: state.documentBack })}
        />
      </View>
      {doc === null ? (
        <ActivityIndicator color={colors.accent} accessibilityLabel={tr('common.loading')} />
      ) : doc === 'error' ? (
        <Banner kind="error">{tr('common.error')}</Banner>
      ) : (
        <>
          <Title>{title(doc)}</Title>
          {!doc.rulesApproved ? <Banner kind="info">{tr('tax.draftBanner')}</Banner> : null}
          <Body muted>
            {doc.number} · {date(doc.issuedAt)}
          </Body>
          {doc.credits ? (
            <Body muted>{tr('tax.credits', { number: doc.credits.number })}</Body>
          ) : null}
          <View style={s.card}>
            <Text style={s.section}>{tr('tax.from')}</Text>
            <Text style={s.text}>{doc.seller.name[L]}</Text>
            {doc.seller.address ? <Text style={s.muted}>{doc.seller.address}</Text> : null}
            {doc.seller.trn ? (
              <Text style={s.muted}>{tr('tax.trn', { trn: doc.seller.trn })}</Text>
            ) : null}
            <Text style={s.section}>{tr('tax.to')}</Text>
            <Text style={s.text}>{doc.buyer.name[L]}</Text>
          </View>
          <View style={s.card}>
            {doc.lines.map((l, i) => (
              <View key={i} style={{ gap: 2 }}>
                <Text style={s.text}>
                  {l.qty} × {l.description[L]}
                </Text>
                <Text style={s.muted}>
                  {money(l.totalFils, L)} · {tr('tax.vat')} {(l.vatRateBps / 100).toFixed(0)}%{' '}
                  {money(l.vatFils, L)}
                </Text>
              </View>
            ))}
          </View>
          <View style={s.card}>
            <Text style={s.muted}>
              {tr('tax.net')}: {money(doc.netFils, L)}
            </Text>
            <Text style={s.muted}>
              {tr('tax.vat')}: {money(doc.vatFils, L)}
            </Text>
            <Text style={s.text}>
              {tr('tax.total')}: {money(doc.totalFils, L)}
            </Text>
          </View>
          <Body muted>{tr('tax.intermediaryNote')}</Body>
        </>
      )}
    </Screen>
  );
}
