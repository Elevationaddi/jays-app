import type { PublicVenue } from '@jays/contracts';
import { View, Text } from 'react-native';
import { useApp } from '../context';
import { money } from '../format';
import { Button } from './ui';
import { cardStyles } from './Picker';

/** The bookable services of a venue, each with a Book button. */
export function VenueServices({ venue }: { venue: PublicVenue }) {
  const { state, dispatch, tr } = useApp();
  if (venue.services.length === 0) return null;
  return (
    <View style={{ gap: 12 }}>
      <Text style={cardStyles.section} accessibilityRole="header">
        {tr('venue.services')}
      </Text>
      {venue.services.map((s) => (
        <View key={s.id} style={cardStyles.card}>
          <View style={cardStyles.row}>
            <View style={{ flex: 1, gap: 4 }}>
              <Text style={cardStyles.text}>{s.title[state.locale]}</Text>
              <Text style={cardStyles.muted}>
                {tr('service.summary', {
                  duration: s.durationMin,
                  price: money(s.priceFils, state.locale),
                })}
              </Text>
              {s.locationMode !== 'in_venue' ? (
                <Text style={cardStyles.muted}>{tr(`venue.location.${s.locationMode}`)}</Text>
              ) : null}
            </View>
            <Button
              label={tr('venue.book')}
              onPress={() => dispatch({ type: 'startBooking', serviceId: s.id })}
            />
          </View>
          <Text style={cardStyles.muted}>{s.description[state.locale]}</Text>
        </View>
      ))}
    </View>
  );
}
