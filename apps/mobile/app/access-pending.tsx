import { Stack } from 'expo-router';
import { useQueryClient } from '@tanstack/react-query';
import { useEffect } from 'react';
import { AppState } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { StyleSheet, View } from 'react-native';
import { queryKeys } from '../src/lib/query/keys';
import { AppText } from '../src/shared/ui/AppText';
import { Button } from '../src/shared/ui/Button';
import { AccessScreen } from '../src/features/access/ui/AccessScreen';
import { useGate } from '../src/features/access';
import { colors, space } from '../src/shared/theme/tokens';

export default function AccessPending() {
  const queryClient = useQueryClient();
  const { me } = useGate();

  useEffect(() => {
    const sub = AppState.addEventListener('change', (state) => {
      if (state === 'active') void queryClient.invalidateQueries({ queryKey: queryKeys.me });
    });
    return () => sub.remove();
  }, [queryClient]);

  return (
    <>
      <Stack.Screen options={{ headerShown: false }} />
      <AccessScreen
        title="Acceso pendiente"
        action={
          <Button
            label="Comprobar de nuevo"
            variant="secondary"
            onPress={() => void queryClient.invalidateQueries({ queryKey: queryKeys.me })}
          />
        }
      >
        <View style={styles.row}>
          <Ionicons name="time-outline" size={24} color={colors.textSecondary} accessibilityElementsHidden importantForAccessibility="no" />
          <AppText tone="secondary" style={styles.body}>
            El superadministrador debe habilitar tu cuenta
            {me?.email ? ` (${me.email})` : ''} para que puedas entrar a YZY Contracts.
          </AppText>
        </View>
      </AccessScreen>
    </>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', gap: space.sm, alignItems: 'flex-start' },
  body: { flex: 1 },
});