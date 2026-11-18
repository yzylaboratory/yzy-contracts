import { Stack } from 'expo-router';
import { EmailScreen } from '../../src/features/auth';

export default function Email() {
  return (
    <>
      <Stack.Screen options={{ headerShown: true, title: '' }} />
      <EmailScreen />
    </>
  );
}
