import { Stack } from 'expo-router';
import { BillingScreen } from '../src/features/billing';
import { AccountChrome } from '../src/features/shell/AccountChrome';

export default function Membresia() {
  return (
    <>
      <Stack.Screen options={{ headerShown: true, title: 'Membresía' }} />
      <AccountChrome />
      <BillingScreen />
    </>
  );
}
