import { StyleSheet, View } from 'react-native';
import { colors, radius } from '../theme/tokens';

type Props = { value: number; max: number; label: string };

export function ProgressBar({ value, max, label }: Props) {
  const ratio = max > 0 ? Math.min(1, Math.max(0, value / max)) : 0;
  return (
    <View
      accessibilityRole="progressbar"
      accessibilityLabel={label}
      accessibilityValue={{ min: 0, max, now: value }}
      style={styles.track}
    >
      <View style={[styles.fill, { width: `${Math.round(ratio * 100)}%` }]} />
    </View>
  );
}

const styles = StyleSheet.create({
  track: { height: 8, borderRadius: radius.pill, backgroundColor: colors.surfaceMuted, overflow: 'hidden' },
  fill: { height: 8, borderRadius: radius.pill, backgroundColor: colors.green },
});
