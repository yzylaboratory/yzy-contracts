import { Stack, useLocalSearchParams } from 'expo-router';
import { useActiveCompany } from '../../../src/features/companies';
import { GenerateScreen } from '../../../src/features/documents';
import { AccountChrome } from '../../../src/features/shell/AccountChrome';

export default function GenerateDocuments() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const active = useActiveCompany();
  return (
    <>
      <Stack.Screen options={{ headerShown: true, title: 'Generar' }} />
      <AccountChrome />
      {active ? <GenerateScreen caseId={id} companyId={active.companyId} /> : null}
    </>
  );
}
