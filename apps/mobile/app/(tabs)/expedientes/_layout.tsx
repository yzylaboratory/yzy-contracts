import { Stack } from 'expo-router';
import { colors } from '../../../src/shared/theme/tokens';

// Native navigation bar for the Expedientes tab. Case detail routes live outside the tabs.
export default function ExpedientesLayout() {
  return <Stack screenOptions={{ title: 'Expedientes', headerTintColor: colors.green }} />;
}
