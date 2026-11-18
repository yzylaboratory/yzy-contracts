import { Stack } from 'expo-router';
import { colors } from '../../src/shared/theme/tokens';

export default function AuthLayout() {
  return (
    <Stack
      screenOptions={{
        headerShown: false,
        headerTransparent: true,
        headerTintColor: colors.ink,
        headerTitle: '',
        contentStyle: { backgroundColor: colors.background },
      }}
    />
  );
}
