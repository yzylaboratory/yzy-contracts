import type { ReactNode } from 'react';
import { StyleSheet, View } from 'react-native';
import { AppText } from '../../../shared/ui/AppText';
import { space } from '../../../shared/theme/tokens';

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <>
      <AppText variant="subheading">{title}</AppText>
      {children}
    </>
  );
}

function Bullet({ children }: { children: string }) {
  return (
    <View style={styles.bulletRow}>
      <AppText tone="secondary">•</AppText>
      <AppText tone="secondary" style={styles.bulletText}>
        {children}
      </AppText>
    </View>
  );
}

export function PrivacyContent() {
  return (
    <>
      <AppText tone="secondary">
        YZY LABS opera YZY Contracts. Esta política describe cómo el portal utiliza la información que introduces al preparar contratos, generar documentos y configurar tu espacio de trabajo.
      </AppText>
      <Section title="Qué datos utiliza el portal">
        <View style={styles.list}>
          <Bullet>
            Perfil y preferencias. El portal guarda tu nombre de perfil y tus ajustes de formato de exportación y copia de correo para conservar tu configuración en el navegador.
          </Bullet>
          <Bullet>
            Contratos. El portal usa el nombre, la categoría, el nombre del archivo seleccionado y el texto que escribes o importas para editar contratos y preparar documentos.
          </Bullet>
          <Bullet>
            Historial de documentos. El historial guarda el contrato asociado, la fecha, el nombre y el formato del archivo y el contenido generado. En los borradores de correo también puede guardar las direcciones de destino y copia, el asunto, el mensaje y el formato del adjunto.
          </Bullet>
          <Bullet>
            Acceso a tu cuenta. Usamos Supabase Auth para iniciar sesión con Google o un enlace enviado al correo de tu cuenta.
          </Bullet>
        </View>
      </Section>
      <Section title="Archivos, exportaciones y correo">
        <AppText tone="secondary">
          El editor lee los archivos Markdown en el navegador. Para usar el contenido de un PDF o un documento de Word, puedes pegarlo o escribirlo en el editor. El navegador genera y descarga los documentos en PDF o Word.
          {'\n\n'}
          Si eliges preparar un correo, el portal descarga un archivo EML con el borrador y el documento adjunto. Tú decides si lo abres en tu aplicación de correo y lo envías. Revisa los destinatarios, el mensaje y el adjunto antes de compartirlos.
        </AppText>
      </Section>
      <Section title="Almacenamiento y eliminación">
        <AppText tone="secondary">
          Los contratos y el historial de documentos generados se guardan en el servidor, asociados a tu cuenta. Puedes consultarlos al iniciar sesión desde otro navegador o equipo. Las preferencias del portal se guardan en el navegador.
          {'\n\n'}
          Puedes borrar los datos locales del sitio desde la configuración del navegador. Para solicitar la eliminación de datos guardados en tu cuenta, usa la sección Solicitudes y contacto. Gestiona los archivos descargados y las copias compartidas desde el dispositivo, la aplicación de correo o el servicio que hayas utilizado.
        </AppText>
      </Section>
      <Section title="Datos de otras personas y equipos compartidos">
        <AppText tone="secondary">
          Incluye únicamente los datos de otras personas que tengas autorización para usar y que sean necesarios para el documento. En un dispositivo compartido, cierra el portal al terminar y retira las descargas que otras personas puedan abrir.
        </AppText>
      </Section>
      <Section title="Solicitudes y contacto">
        <AppText tone="secondary">
          Para consultar sobre el uso de tus datos, pedir acceso, corrección o eliminación, u oponerte a su tratamiento cuando corresponda, contacta con el administrador de tu cuenta. Describe qué información te interesa y qué acción solicitas. Evita adjuntar contratos completos o documentos de identidad en el primer mensaje.
        </AppText>
      </Section>
    </>
  );
}

const styles = StyleSheet.create({
  list: { gap: space.xs },
  bulletRow: { flexDirection: 'row', gap: space.xs },
  bulletText: { flex: 1 },
});