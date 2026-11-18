import { Stack } from 'expo-router';
import { PreviewScreen } from '../src/features/documents';

export default function DocumentPreview() {
  return (
    <>
      <Stack.Screen options={{ headerShown: true, presentation: 'modal', title: 'Vista previa' }} />
      <PreviewScreen />
    </>
  );
}
