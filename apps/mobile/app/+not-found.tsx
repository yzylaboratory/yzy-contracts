import { Stack, useRouter } from 'expo-router';
import { Button } from '../src/shared/ui/Button';
import { Screen } from '../src/shared/ui/Screen';
import { EmptyState } from '../src/shared/ui/StateViews';

export default function NotFound() {
  const router = useRouter();
  return (
    <>
      <Stack.Screen options={{ title: 'No encontrada', headerShown: true }} />
      <Screen withTopInset>
        <EmptyState
          title="Esta pantalla no existe"
          body="Puede que el enlace esté incompleto o que el expediente ya no esté disponible."
          action={<Button label="Ir al inicio" onPress={() => router.replace('/')} />}
        />
      </Screen>
    </>
  );
}
