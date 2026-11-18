import { Stack } from 'expo-router';
import { colors } from '../../../src/shared/theme/tokens';

export default function InicioLayout() {
  return <Stack screenOptions={{ title: 'Dashboard', headerShown: true, headerTintColor: colors.green }} />;
}