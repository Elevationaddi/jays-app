import type { TaxDocumentSummary } from '@jays/contracts';
import { useEffect, useState } from 'react';
import { Text, View } from 'react-native';
import { cardStyles as s } from './Picker';
import { Button } from './ui';
import { useApp } from '../context';
import { money } from '../format';
import type { Route } from '../state';

/** The invoices and credit notes the sellers issued for an order or appointment (D3). */
export function Invoices({
  orderId,
  bookingId,
  back,
}: {
  orderId?: string;
  bookingId?: string;
  back: Route;
}) {
  const { state, api, dispatch, tr } = useApp();
  const [docs, setDocs] = useState<TaxDocumentSummary[] | null>(null);
  useEffect(() => {
    api
      .myDocuments({ ...(orderId ? { orderId } : {}), ...(bookingId ? { bookingId } : {}) })
      .then((p) => setDocs(p.items))
      .catch(() => setDocs([]));
  }, [api, orderId, bookingId]);
  if (!docs || docs.length === 0) return null;
  return (
    <View style={s.card}>
      <Text style={s.section}>{tr('tax.documents')}</Text>
      {docs.map((d) => (
        <Button
          key={d.id}
          variant="secondary"
          label={`${tr(d.kind === 'customer_credit_note' ? 'tax.title.creditNote' : 'tax.title.invoice')} ${d.number} · ${money(d.totalFils, state.locale)}`}
          onPress={() => dispatch({ type: 'openDocument', documentId: d.id, back })}
        />
      ))}
    </View>
  );
}
