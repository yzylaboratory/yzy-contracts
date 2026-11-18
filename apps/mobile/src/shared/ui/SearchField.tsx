import { Ionicons } from '@expo/vector-icons';
import { StyleSheet, TextInput, View } from 'react-native';
import { colors, fonts, radius, touch } from '../theme/tokens';

type Props = { label: string; value: string; placeholder: string; onChangeText: (value: string) => void };

export function SearchField({ label, value, placeholder, onChangeText }: Props) {
  return (
    <View style={styles.wrap}>
      <Ionicons name="search" size={18} color={colors.textSecondary} />
      <TextInput
        accessibilityRole="search"
        accessibilityLabel={label}
        value={value}
        onChangeText={onChangeText}
        placeholder={placeholder}
        placeholderTextColor={colors.textMuted}
        autoCapitalize="none"
        autoCorrect={false}
        clearButtonMode="while-editing"
        returnKeyType="search"
        style={styles.input}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    minHeight: touch.button,
    borderRadius: radius.control,
    borderWidth: 1,
    borderColor: colors.borderStrong,
    backgroundColor: colors.surfaceRaised,
    paddingHorizontal: 14,
  },
  input: { flex: 1, fontFamily: fonts.body, fontSize: 16, color: colors.ink, paddingVertical: 10 },
});
