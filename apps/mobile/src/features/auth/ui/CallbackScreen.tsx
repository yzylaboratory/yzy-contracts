import { useMutation } from '@tanstack/react-query';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useRef } from 'react';
import { StyleSheet, View } from 'react-native';
import { api, authCallbackParamsSchema, type AuthCallbackParams } from '../../../lib/api';
import { messageFor } from '../../../shared/errors/messages';
import { AppText } from '../../../shared/ui/AppText';
import { Button } from '../../../shared/ui/Button';
import { Screen } from '../../../shared/ui/Screen';
import { ErrorState } from '../../../shared/ui/StateViews';
import { space } from '../../../shared/theme/tokens';

// Deep link handler for yzycontracts://auth/callback. The code is single-use, so it is exchanged once.
// On success the session listener updates the gate and RouteGuard leaves this screen.
export function CallbackScreen() {
  const router = useRouter();
  const params = useLocalSearchParams<Record<string, string>>();
  const parsed = authCallbackParamsSchema.safeParse(params);
  const started = useRef(false);

  const complete = useMutation({
    mutationFn: (value: AuthCallbackParams) => api.auth.completeCallback(value),
  });

  useEffect(() => {
    if (!parsed.success || started.current) return;
    started.current = true;
    complete.mutate(parsed.data);
    // Runs once per link opened; the parsed value is fixed for this mount.
  }, [parsed.success]);

  if (!parsed.success) {
    return (
      <Screen withTopInset scroll={false}>
        <View style={styles.body}>
          <ErrorState title="Este enlace no es válido" body="Pide un enlace nuevo desde la pantalla de acceso." />
          <Button label="Volver a iniciar sesión" onPress={() => router.replace('/login')} />
        </View>
      </Screen>
    );
  }

  if (complete.isError) {
    return (
      <Screen withTopInset scroll={false}>
        <View style={styles.body}>
          <ErrorState title="No pudimos iniciar tu sesión" body={messageFor(complete.error)} />
          <Button label="Volver a iniciar sesión" onPress={() => router.replace('/login')} />
        </View>
      </Screen>
    );
  }

  return (
    <Screen withTopInset scroll={false}>
      <View style={styles.body}>
        <AppText variant="title">Entrando…</AppText>
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  body: { flex: 1, justifyContent: 'center', gap: space.md, padding: space.lg },
});
