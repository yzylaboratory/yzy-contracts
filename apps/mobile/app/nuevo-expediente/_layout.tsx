import { Stack, useRouter } from 'expo-router';
import { Pressable, Text } from 'react-native';
import { useCaseDraft } from '../../src/features/case-intake';
import { colors } from '../../src/shared/theme/tokens';

// Wizard stack. Cancelling discards the draft (plan section 8, item 5).
export default function NuevoExpedienteLayout() {
  const router = useRouter();
  const reset = useCaseDraft((state) => state.reset);
  return (
    <Stack
      screenOptions={{
        headerShown: true,
        headerTintColor: colors.ink,
        headerStyle: { backgroundColor: colors.background },
        contentStyle: { backgroundColor: colors.background },
        headerTitle: 'Nuevo expediente',
        headerRight: () => (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Cancelar nuevo expediente"
            onPress={() => {
              reset();
              router.dismissAll();
            }}
            hitSlop={12}
          >
            <Text style={{ color: colors.greenStrong, fontSize: 16 }}>Cancelar</Text>
          </Pressable>
        ),
      }}
    />
  );
}
