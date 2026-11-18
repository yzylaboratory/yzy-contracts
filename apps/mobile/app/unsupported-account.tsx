import { Stack } from 'expo-router';
import { AppText } from '../src/shared/ui/AppText';
import { AccessScreen } from '../src/features/access/ui/AccessScreen';

export default function UnsupportedAccount() {
  return (
    <>
      <Stack.Screen options={{ headerShown: false }} />
      <AccessScreen title="Acceso restringido" canSignOut>
        <AppText tone="secondary" accessibilityRole="alert">
          Esta cuenta no puede entrar a YZY Contracts. Inicia sesión con tu cuenta habilitada.
        </AppText>
      </AccessScreen>
    </>
  );
}