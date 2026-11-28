import { colors, minTouchTarget } from '@jays/ui';
import { useState } from 'react';
import { Pressable, StyleSheet, Text } from 'react-native';
import { useApp } from '../context';
import { errorKey } from '../errors';

/**
 * Saves or removes a product from the wishlist. Signed-out customers are sent to sign in and
 * come back to where they were.
 */
export function Heart({
  productId,
  title,
  onError,
  size = 'small',
}: {
  productId: string;
  title: string;
  onError?: (message: string) => void;
  size?: 'small' | 'large';
}) {
  const { state, api, dispatch, tr } = useApp();
  const [busy, setBusy] = useState(false);
  const saved = state.wishlist?.includes(productId) ?? false;

  async function toggle() {
    if (!state.session) {
      dispatch({ type: 'requireSignIn', returnTo: state.route });
      return;
    }
    setBusy(true);
    try {
      const list = saved
        ? await api.removeFromWishlist(productId)
        : await api.addToWishlist(productId);
      dispatch({ type: 'wishlist', productIds: list.items.map((i) => i.productId) });
    } catch (error) {
      onError?.(tr(errorKey(error).key));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={tr(saved ? 'wishlist.remove' : 'wishlist.add', { product: title })}
      accessibilityState={{ selected: saved, busy }}
      disabled={busy}
      onPress={() => void toggle()}
      hitSlop={6}
      style={({ pressed }) => [
        styles.button,
        size === 'large' && styles.large,
        (pressed || busy) && { opacity: 0.6 },
      ]}
    >
      <Text style={[styles.icon, { color: saved ? colors.accent : colors.textMuted }]}>
        {saved ? '♥' : '♡'}
      </Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  button: {
    width: minTouchTarget,
    height: minTouchTarget,
    borderRadius: 999,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(255,255,255,0.92)',
  },
  large: { borderWidth: 1, borderColor: colors.border },
  icon: { fontSize: 24, lineHeight: 28 },
});
