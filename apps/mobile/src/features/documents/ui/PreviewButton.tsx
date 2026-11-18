import { Ionicons } from '@expo/vector-icons';
import { ActivityIndicator, Pressable, StyleSheet } from 'react-native';
import { colors, radius, touch } from '../../../shared/theme/tokens';

type Props = { name: string; busy: boolean; disabled: boolean; onPress: () => void };

// "Vista previa" action of a generated-document row.
export function PreviewButton({ name, busy, disabled, onPress }: Props) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`Vista previa de ${name}`}
      accessibilityState={{ busy, disabled }}
      disabled={disabled}
      onPress={onPress}
      style={styles.action}
    >
      {busy ? (
        <ActivityIndicator color={colors.ink} />
      ) : (
        <Ionicons name="eye-outline" size={22} color={colors.ink} />
      )}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  action: {
    width: touch.minTarget,
    height: touch.minTarget,
    borderRadius: radius.small,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
