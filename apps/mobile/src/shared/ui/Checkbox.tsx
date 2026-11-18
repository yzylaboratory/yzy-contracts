import { Pressable, StyleSheet, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { AppText } from './AppText';
import { colors, radius, touch } from '../theme/tokens';

type Props = {
  label: string;
  sublabel?: string;
  checked: boolean;
  disabled?: boolean;
  onChange: (checked: boolean) => void;
};

export function Checkbox({ label, sublabel, checked, disabled = false, onChange }: Props) {
  return (
    <Pressable
      accessibilityRole="checkbox"
      accessibilityLabel={sublabel ? `${label}. ${sublabel}` : label}
      accessibilityState={{ checked, disabled }}
      disabled={disabled}
      onPress={() => onChange(!checked)}
      style={({ pressed }) => [styles.row, disabled && styles.disabled, pressed && !disabled && styles.pressed]}
    >
      <View style={[styles.box, checked && styles.boxChecked]}>
        {checked ? <Ionicons name="checkmark" size={16} color={colors.onAccent} /> : null}
      </View>
      <View style={styles.text}>
        <AppText variant="bodyStrong">{label}</AppText>
        {sublabel ? (
          <AppText variant="caption" tone="secondary">
            {sublabel}
          </AppText>
        ) : null}
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: 12, minHeight: touch.button, paddingVertical: 8 },
  box: {
    width: 24,
    height: 24,
    borderRadius: radius.tiny,
    borderWidth: 2,
    borderColor: colors.borderStrong,
    backgroundColor: colors.surfaceRaised,
    alignItems: 'center',
    justifyContent: 'center',
  },
  boxChecked: { backgroundColor: colors.green, borderColor: colors.green },
  text: { flex: 1, gap: 2 },
  disabled: { opacity: 0.5 },
  pressed: { opacity: 0.8 },
});
