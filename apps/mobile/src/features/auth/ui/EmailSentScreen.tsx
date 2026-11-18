import { useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { api } from '../../../lib/api';
import { AppText } from '../../../shared/ui/AppText';
import { Button } from '../../../shared/ui/Button';
import { Notice } from '../../../shared/ui/Notice';
import { Screen } from '../../../shared/ui/Screen';
import { emailParamSchema } from '../schemas';
import { messageFor } from '../../../shared/errors/messages';
import { space } from '../../../shared/theme/tokens';
import { useMutation } from '@tanstack/react-query';

const RESEND_SECONDS = 60;

// Revisa tu correo. The link must be opened on this same phone (PKCE; plan RISK-06).
export function EmailSentScreen() {
  const router = useRouter();
  const params = useLocalSearchParams<{ email?: string }>();
  const parsed = emailParamSchema.safeParse({ email: params.email ?? '' });
  const email = parsed.success ? parsed.data.email : null;
  const [seconds, setSeconds] = useState(RESEND_SECONDS);

  useEffect(() => {
    if (seconds <= 0) return;
    const timer = setTimeout(() => setSeconds((value) => value - 1), 1000);
    return () => clearTimeout(timer);
  }, [seconds]);

  const resend = useMutation({
    mutationFn: async () => {
      if (email) await api.auth.sendMagicLink(email);
    },
    onSuccess: () => setSeconds(RESEND_SECONDS),
  });

  if (!email) {
    return (
      <Screen withTopInset>
        <Notice tone="danger" message="No sabemos a qué correo enviar el enlace. Vuelve a escribirlo." />
        <Button label="Cambiar correo" variant="secondary" onPress={() => router.replace('/email')} />
      </Screen>
    );
  }

  return (
    <Screen
      withTopInset
      scroll={false}
      footer={
        <View style={styles.footer}>
          <Button
            label={seconds > 0 ? `Reenviar enlace en ${seconds} s` : 'Reenviar enlace'}
            variant="secondary"
            disabled={seconds > 0}
            loading={resend.isPending}
            onPress={() => resend.mutate()}
          />
          <Button label="Cambiar correo" variant="ghost" onPress={() => router.back()} />
        </View>
      }
    >
      <View style={styles.body}>
        <AppText variant="title">Revisa tu correo</AppText>
        <AppText tone="secondary">
          Enviamos un enlace a <AppText variant="bodyStrong">{email}</AppText>. Ábrelo en este mismo teléfono para entrar.
        </AppText>
        {resend.isError ? <Notice tone="danger" message={messageFor(resend.error)} /> : null}
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  body: { flex: 1, gap: space.md, paddingTop: space.lg },
  footer: { gap: space.sm },
});
