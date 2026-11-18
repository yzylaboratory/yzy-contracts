import { StyleSheet, TextInput, View, type KeyboardTypeOptions } from 'react-native';
import { AppText } from './AppText';
import { colors, fonts, radius, touch } from '../theme/tokens';

type Props = {
  label: string;
  value: string;
  onChangeText: (value: string) => void;
  placeholder?: string;
  error?: string | null;
  hint?: string;
  keyboardType?: KeyboardTypeOptions;
  autoComplete?: 'email' | 'off' | 'name' | 'tel' | 'street-address';
  autoCapitalize?: 'none' | 'sentences' | 'words' | 'characters';
  editable?: boolean;
  onSubmitEditing?: () => void;
};

// The visible label is the accessible name. The placeholder never replaces it.
export function TextField({
  label,
  value,
  onChangeText,
  placeholder,
  error,
  hint,
  keyboardType,
  autoComplete = 'off',
  autoCapitalize = 'sentences',
  editable = true,
  onSubmitEditing,
}: Props) {
  const describedText = error ?? hint;
  return (
    <View style={styles.wrapper}>
      <AppText variant="label" tone="secondary">
        {label}
      </AppText>
      <TextInput
        accessibilityLabel={label}
        accessibilityHint={describedText ?? undefined}
        aria-invalid={Boolean(error)}
        value={value}
        onChangeText={onChangeText}
        placeholder={placeholder}
        placeholderTextColor={colors.textMuted}
        keyboardType={keyboardType}
        autoComplete={autoComplete}
        autoCapitalize={autoCapitalize}
        autoCorrect={false}
        editable={editable}
        onSubmitEditing={onSubmitEditing}
        style={[styles.input, error ? styles.inputError : null, !editable && styles.disabled]}
      />
      {describedText ? (
        <AppText variant="caption" tone={error ? 'danger' : 'muted'} accessibilityLiveRegion="polite">
          {describedText}
        </AppText>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrapper: { gap: 6 },
  input: {
    minHeight: touch.button,
    borderRadius: radius.control,
    borderWidth: 1,
    borderColor: colors.borderStrong,
    backgroundColor: colors.surfaceRaised,
    paddingHorizontal: 14,
    fontFamily: fonts.body,
    fontSize: 16,
    color: colors.ink,
  },
  inputError: { borderColor: colors.danger, borderWidth: 2 },
  disabled: { opacity: 0.6 },
});
