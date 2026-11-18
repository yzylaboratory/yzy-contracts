import { Stack } from 'expo-router';
import { colors } from '../../../src/shared/theme/tokens';

export default function ClientesLayout() {
  return <Stack screenOptions={{ title: 'Clientes', headerShown: true, headerTintColor: colors.green }} />;
}