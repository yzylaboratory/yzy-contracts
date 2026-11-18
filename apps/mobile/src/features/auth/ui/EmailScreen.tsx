import { useMutation } from '@tanstack/react-query';
import { useRouter } from 'expo-router';
import { useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { api } from '../../../lib/api';
import { messageFor } from '../../../shared/errors/messages';
import { AppText } from '../../../shared/ui/AppText';
import { Button } from '../../../shared/ui/Button';
import { Notice } from '../../../shared/ui/Notice';
import { Screen } from '../../../shared/ui/Screen';
import { TextField } from '../../../shared/ui/TextField';
import { emailFormSchema } from '../schemas';
import { space } from '../../../shared/theme/tokens';

// Ingresa con tu correo: magic link only. No 6-digit code, no Apple (plan decision 1).
export function EmailScreen() {
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [error, setError] = useState<string | null>(null);

  const send = useMutation({
    mutationFn: async (value: string) => {
      await api.auth.sendMagicLink(value);
    },
    onSuccess: (_data, value) => {
      router.push({ pathname: '/email-sent', params: { email: value } });
    },
  });

  const submit = () => {
    const parsed = emailFormSchema.safeParse({ email });
    if (!parsed.success) {
      setError(parsed.error.issues[0]?.message ?? 'Escribe un correo válido.');
      return;
    }
    setError(null);
    send.mutate(parsed.data.email);
  };

  return (
    <Screen
      scroll={false}
      footer={<Button label="Enviar enlace" loading={send.isPending} onPress={submit} hint="Te enviaremos un enlace al correo" />}
    >
      <View style={styles.body}>
        <AppText variant="title">Ingresa con tu correo</AppText>
        <AppText tone="secondary">Te enviaremos un enlace para entrar. No necesitas contraseña.</AppText>
        <TextField
          label="Correo electrónico"
          value={email}
          onChangeText={(value) => {
            setEmail(value);
            if (error) setError(null);
          }}
          placeholder="nombre@empresa.com"
          keyboardType="email-address"
          autoComplete="email"
          autoCapitalize="none"
          error={error}
          onSubmitEditing={submit}
        />
        {send.isError ? <Notice tone="danger" message={messageFor(send.error)} /> : null}
        <AppText variant="caption" tone="muted">
          Al continuar aceptas los términos de uso y la política de privacidad.
        </AppText>
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  body: { flex: 1, gap: space.md, paddingTop: space.lg },
});
