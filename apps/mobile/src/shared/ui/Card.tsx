import type { ReactNode } from 'react';
import { StyleSheet, View, type ViewStyle } from 'react-native';
import { colors, radius } from '../theme/tokens';

type Props = { children: ReactNode; tone?: 'surface' | 'ink'; style?: ViewStyle };

export function Card({ children, tone = 'surface', style }: Props) {
  return <View style={[styles.card, tone === 'ink' && styles.ink, style]}>{children}</View>;
}

const styles = StyleSheet.create({
  card: {
    borderRadius: radius.card,
    borderWidth: 1,
    borderColor: colors.borderSubtle,
    backgroundColor: colors.surfaceRaised,
    padding: 16,
    gap: 12,
  },
  ink: { backgroundColor: colors.ink, borderColor: colors.ink },
});
