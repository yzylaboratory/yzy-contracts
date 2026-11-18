import { Ionicons } from '@expo/vector-icons';
import { StyleSheet, View } from 'react-native';
import { AppText } from './AppText';
import { colors, radius } from '../theme/tokens';

type Tone = 'danger' | 'warning' | 'info';
type Props = { tone: Tone; message: string };

const palette: Record<Tone, { bg: string; fg: string; icon: keyof typeof Ionicons.glyphMap }> = {
  danger: { bg: '#f6dedc', fg: colors.danger, icon: 'alert-circle' },
  warning: { bg: '#f3e6d0', fg: colors.warning, icon: 'warning' },
  info: { bg: colors.wordSurface, fg: colors.navy, icon: 'information-circle' },
};

// Inline notice. Danger notices are announced immediately.
export function Notice({ tone, message }: Props) {
  const p = palette[tone];
  return (
    <View
      accessibilityRole={tone === 'danger' ? 'alert' : 'text'}
      style={[styles.box, { backgroundColor: p.bg }]}
    >
      <Ionicons name={p.icon} size={18} color={p.fg} />
      <AppText variant="body" style={[styles.text, { color: p.fg }]}>
        {message}
      </AppText>
    </View>
  );
}

const styles = StyleSheet.create({
  box: { flexDirection: 'row', gap: 10, padding: 12, borderRadius: radius.small, alignItems: 'flex-start' },
  text: { flex: 1 },
});
