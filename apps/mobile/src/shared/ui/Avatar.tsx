import { StyleSheet, View } from 'react-native';
import { AppText } from './AppText';
import { colors } from '../theme/tokens';

// Initials avatar. Decorative: the surrounding text carries the name.
export function Avatar({ name, size = 40 }: { name: string; size?: number }) {
  const initials = name
    .split(' ')
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? '')
    .join('');
  return (
    <View
      accessible={false}
      importantForAccessibility="no"
      style={[styles.circle, { width: size, height: size, borderRadius: size / 2 }]}
    >
      <AppText variant="label" style={{ color: colors.ink }}>
        {initials}
      </AppText>
    </View>
  );
}

const styles = StyleSheet.create({
  circle: { backgroundColor: colors.avatarSurface, alignItems: 'center', justifyContent: 'center' },
});
