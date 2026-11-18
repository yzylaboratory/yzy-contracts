import { Stack, useLocalSearchParams } from 'expo-router';
import { CaseDetailScreen } from '../../../src/features/cases';
import { AccountChrome } from '../../../src/features/shell/AccountChrome';

export default function CaseDetail() {
  const { id } = useLocalSearchParams<{ id: string }>();
  return (
    <>
      <Stack.Screen options={{ headerShown: true, title: 'Expediente' }} />
      <AccountChrome />
      <CaseDetailScreen caseId={id} />
    </>
  );
}
