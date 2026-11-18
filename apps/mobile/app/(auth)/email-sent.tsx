import { Stack } from 'expo-router';
import { EmailSentScreen } from '../../src/features/auth';

export default function EmailSent() {
  return (
    <>
      <Stack.Screen options={{ headerShown: true, title: '' }} />
      <EmailSentScreen />
    </>
  );
}
