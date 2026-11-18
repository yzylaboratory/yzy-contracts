import { useMutation } from '@tanstack/react-query';
import { useRouter } from 'expo-router';
import { StyleSheet, View } from 'react-native';
import { api } from '../../../lib/api';
import { BrandMark } from '../../../shared/brand/brand-mark';
import { messageFor } from '../../../shared/errors/messages';
import { AppText } from '../../../shared/ui/AppText';
import { BrandFooter } from '../../../shared/ui/BrandFooter';
import { Button } from '../../../shared/ui/Button';
import { Notice } from '../../../shared/ui/Notice';
import { Screen } from '../../../shared/ui/Screen';
import { colors, space } from '../../../shared/theme/tokens';

// Login: Google OAuth and magic link, as the portal does (plan section 1 and 6).
export function LoginScreen() {
  const router = useRouter();
  // The session listener updates the gate when Google returns; closing the browser resolves without error.
  const google = useMutation({
    mutationFn: () => api.auth.signInWithGoogle(),
  });

  return (
    <Screen withTopInset scroll={false} footer={<BrandFooter />}>
      <View style={styles.hero}>
        <BrandMark size={88} />
        <AppText variant="display" style={styles.brand}>
          YZY Contracts
        </AppText>
        <AppText variant="title" style={styles.headline}>
          Tus contratos, listos desde el teléfono.
        </AppText>
        <AppText tone="secondary">Crea expedientes y genera los documentos de tus clientes en minutos.</AppText>
      </View>

      <View style={styles.actions}>
        {google.isError ? <Notice tone="danger" message={messageFor(google.error)} /> : null}
        <AppText variant="label" tone="secondary" style={styles.center}>
          Acceder con
        </AppText>
        <Button
          label="Continuar con Google"
          variant="secondary"
          loading={google.isPending}
          onPress={() => google.mutate()}
          hint="Inicia sesión con tu cuenta de Google"
        />
        <View style={styles.divider}>
          <View style={styles.line} />
          <AppText variant="caption" tone="muted">
            o
          </AppText>
          <View style={styles.line} />
        </View>
        <Button
          label="Continuar con correo"
          onPress={() => router.push('/email')}
          hint="Te enviaremos un enlace para entrar"
        />
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  hero: { flex: 1, justifyContent: 'center', gap: space.md, paddingTop: space.xxl },
  brand: { color: colors.ink, marginTop: space.sm },
  headline: { color: colors.ink },
  actions: { gap: space.md, paddingBottom: space.md },
  divider: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
  line: { flex: 1, height: StyleSheet.hairlineWidth, backgroundColor: colors.borderStrong },
  center: { textAlign: 'center' },
});
