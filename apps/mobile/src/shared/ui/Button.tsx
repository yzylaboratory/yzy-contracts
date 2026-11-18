import { ActivityIndicator, Pressable, StyleSheet, Text, View, type ViewStyle } from 'react-native';
import { colors, fonts, radius, touch } from '../theme/tokens';

type Variant = 'primary' | 'secondary' | 'ghost' | 'danger';

type Props = {
  label: string;
  onPress: () => void;
  variant?: Variant;
  loading?: boolean;
  disabled?: boolean;
  hint?: string;
  fullWidth?: boolean;
  accessibilityLabel?: string;
  style?: ViewStyle;
};

const variants: Record<Variant, { container: ViewStyle; text: { color: string } }> = {
  primary: { container: { backgroundColor: colors.green }, text: { color: colors.onAccent } },
  secondary: {
    container: { backgroundColor: colors.surfaceRaised, borderWidth: 1, borderColor: colors.borderStrong },
    text: { color: colors.ink },
  },
  ghost: { container: { backgroundColor: 'transparent' }, text: { color: colors.greenStrong } },
  danger: { container: { backgroundColor: colors.danger }, text: { color: colors.onAccent } },
};

export function Button({
  label,
  onPress,
  variant = 'primary',
  loading = false,
  disabled = false,
  hint,
  fullWidth = true,
  accessibilityLabel = label,
  style,
}: Props) {
  const inactive = disabled || loading;
  const variantStyle = variants[variant];
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      accessibilityHint={hint}
      accessibilityState={{ disabled: inactive, busy: loading }}
      disabled={inactive}
      onPress={onPress}
      style={({ pressed }) => [
        styles.base,
        variantStyle.container,
        fullWidth && styles.fullWidth,
        pressed && !inactive && styles.pressed,
        inactive && styles.inactive,
        style,
      ]}
    >
      <View style={styles.row}>
        {loading ? <ActivityIndicator color={variantStyle.text.color} /> : null}
        <Text style={[styles.label, variantStyle.text]}>{label}</Text>
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  base: {
    minHeight: touch.button,
    borderRadius: radius.control,
    paddingHorizontal: 20,
    alignItems: 'center',
    justifyContent: 'center',
  },
  fullWidth: { alignSelf: 'stretch' },
  row: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  label: { fontFamily: fonts.bodySemibold, fontSize: 16 },
  pressed: { opacity: 0.85 },
  inactive: { opacity: 0.45 },
});
