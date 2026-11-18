import { Stack, useLocalSearchParams } from 'expo-router';
import { EmptyState } from '../../../src/shared/ui/StateViews';
import { ReadyScreen, readyParamsSchema } from '../../../src/features/documents';
import { Screen } from '../../../src/shared/ui/Screen';
import { AccountChrome } from '../../../src/features/shell/AccountChrome';

export default function Ready() {
  const params = useLocalSearchParams<{ id?: string; ids?: string }>();
  const parsed = readyParamsSchema.safeParse({ id: params.id ?? '', ids: params.ids ?? '' });

  return (
    <>
      <Stack.Screen options={{ headerShown: true, title: 'Documentos listos', headerBackVisible: false }} />
      <AccountChrome />
      {parsed.success ? (
        <ReadyScreen caseId={parsed.data.id} ids={parsed.data.ids} />
      ) : (
        <Screen withTopInset>
          <EmptyState title="Enlace incompleto" body="No pudimos abrir los documentos de este expediente." />
        </Screen>
      )}
    </>
  );
}
