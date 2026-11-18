import type { ReactNode } from 'react';
import { useRouter } from 'expo-router';
import { Pressable, StyleSheet } from 'react-native';
import { AppText } from '../../../shared/ui/AppText';
import { colors, space } from '../../../shared/theme/tokens';

function Section({ title, children }: { title: string; children: string }) {
  return (
    <ViewSection title={title}>
      <AppText tone="secondary">{children}</AppText>
    </ViewSection>
  );
}

function ViewSection({ title, children }: { title: string; children: ReactNode }) {
  return (
    <>
      <AppText variant="subheading">{title}</AppText>
      {children}
    </>
  );
}

export function TermsContent() {
  const router = useRouter();

  return (
    <>
      <AppText variant="caption" tone="secondary">
        Versión 1
      </AppText>
      <Section title="Alcance del portal">
        YZY LABS opera YZY Contracts. El portal te permite crear y editar contratos, descargar documentos en PDF o Word (DOCX) y preparar borradores de correo en formato EML. Tú decides si abres y envías esos borradores desde tu aplicación de correo.
      </Section>
      <Section title="Uso permitido y acceso">
        {`Usa el portal para fines lícitos. Abstente de suplantar a otras personas, intentar acceder a sistemas o datos sin autorización o interferir con el funcionamiento del portal.

Puedes acceder con Google o un enlace enviado al correo de tu cuenta. Controla quién puede acceder a tu dispositivo y a la pestaña donde trabajas.`}
      </Section>
      <Section title="Contenido que incorporas">
        Conservas los derechos que tengas sobre los textos y archivos que incorporas al portal. Si utilizas contenido de terceros o datos de otras personas, asegúrate de contar con la autorización necesaria y de respetar tus obligaciones de confidencialidad.
      </Section>
      <Section title="Revisión de los documentos">
        Las plantillas y los documentos generados son borradores para revisión. Antes de firmar, enviar o utilizar un documento, verifica los datos de las partes, las fechas, las cláusulas y los campos pendientes. Si necesitas asesoría jurídica, consulta a un profesional cualificado.
      </Section>
      <Section title="Almacenamiento y descargas">
        El portal guarda los contratos y el historial de documentos generados en tu cuenta. Puedes volver a descargar un documento desde el historial al iniciar sesión. Guarda tus copias descargadas en un lugar al que solo tengan acceso las personas autorizadas.
      </Section>
      <Section title="Disponibilidad y cambios">
        Algunas funciones pueden quedar temporalmente indisponibles por mantenimiento, fallos técnicos o restricciones del navegador. Si cambian estos términos, podrás consultar la versión actualizada en esta página.
      </Section>
      <ViewSection title="Privacidad y contacto">
        <AppText tone="secondary">
          Consulta las{' '}
          <Pressable accessibilityRole="link" onPress={() => router.push('/politica-de-privacidad')}>
            <AppText tone="secondary" style={styles.link}>
              políticas de privacidad
            </AppText>
          </Pressable>{' '}
          para conocer cómo se usan y almacenan los datos.
        </AppText>
      </ViewSection>
    </>
  );
}

const styles = StyleSheet.create({
  link: { color: colors.greenStrong, textDecorationLine: 'underline', marginBottom: -space.xs },
});