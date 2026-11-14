import type { Metadata } from "next";
import { LegalPage } from "../legal-page";
import styles from "../legal-document.module.css";

export const metadata: Metadata = {
  title: "Políticas de privacidad | YZY Contracts",
  description: "Cómo YZY Contracts utiliza los datos y qué puedes hacer para gestionarlos.",
};

export default function PrivacyPolicyPage() {
  return (
    <LegalPage
      title="Políticas de privacidad"
      description="Cómo YZY Contracts utiliza los datos y qué puedes hacer para gestionarlos."
    >
      <article className={styles.document}>
        <p className={styles.copy}>
          YZY LABS opera YZY Contracts. Esta política describe cómo el portal utiliza la información que introduces al preparar contratos, generar documentos y configurar tu espacio de trabajo.
        </p>

        <section className={styles.section}>
          <h2>Qué datos utiliza el portal</h2>
          <ul className={styles.copy}>
            <li><strong>Perfil y preferencias.</strong> El portal guarda tu nombre de perfil y tus ajustes de formato de exportación y copia de correo para conservar tu configuración en el navegador.</li>
            <li><strong>Contratos.</strong> El portal usa el nombre, la categoría, el nombre del archivo seleccionado y el texto que escribes o importas para editar contratos y preparar documentos.</li>
            <li><strong>Historial de documentos.</strong> El historial guarda el contrato asociado, la fecha, el nombre y el formato del archivo y el contenido generado. En los borradores de correo también puede guardar las direcciones de destino y copia, el asunto, el mensaje y el formato del adjunto.</li>
            <li><strong>Acceso a tu cuenta.</strong> Usamos Supabase Auth para iniciar sesión con Google o un enlace enviado al correo de tu cuenta.</li>
          </ul>
        </section>

        <section className={styles.section}>
          <h2>Archivos, exportaciones y correo</h2>
          <p className={styles.copy}>
            El editor lee los archivos Markdown en el navegador. Para usar el contenido de un PDF o un documento de Word, puedes pegarlo o escribirlo en el editor. El navegador genera y descarga los documentos en PDF o Word.
          </p>
          <p className={styles.copy}>
            Si eliges preparar un correo, el portal descarga un archivo EML con el borrador y el documento adjunto. Tú decides si lo abres en tu aplicación de correo y lo envías. Revisa los destinatarios, el mensaje y el adjunto antes de compartirlos.
          </p>
        </section>

        <section className={styles.section}>
          <h2>Almacenamiento y eliminación</h2>
          <p className={styles.copy}>
            Los contratos y el historial de documentos generados se guardan en el servidor, asociados a tu cuenta. Puedes consultarlos al iniciar sesión desde otro navegador o equipo. Las preferencias del portal se guardan en el navegador.
          </p>
          <p className={styles.copy}>
            Puedes borrar los datos locales del sitio desde la configuración del navegador. Para solicitar la eliminación de datos guardados en tu cuenta, usa la sección <a href="#contacto">Solicitudes y contacto</a>. Gestiona los archivos descargados y las copias compartidas desde el dispositivo, la aplicación de correo o el servicio que hayas utilizado.
          </p>
        </section>

        <section className={styles.section}>
          <h2>Datos de otras personas y equipos compartidos</h2>
          <p className={styles.copy}>
            Incluye únicamente los datos de otras personas que tengas autorización para usar y que sean necesarios para el documento. En un dispositivo compartido, cierra el portal al terminar y retira las descargas que otras personas puedan abrir.
          </p>
        </section>

        <section className={styles.section}>
          <h2 id="contacto" tabIndex={-1}>Solicitudes y contacto</h2>
          <p className={styles.copy}>
            Para consultar sobre el uso de tus datos, pedir acceso, corrección o eliminación, u oponerte a su tratamiento cuando corresponda, {process.env.NEXT_PUBLIC_SUPPORT_EMAIL
              ? <>escribe a <a href={`mailto:${process.env.NEXT_PUBLIC_SUPPORT_EMAIL}`}>{process.env.NEXT_PUBLIC_SUPPORT_EMAIL}</a></>
              : "contacta con el administrador de tu cuenta"}. Describe qué información te interesa y qué acción solicitas. Evita adjuntar contratos completos o documentos de identidad en el primer mensaje.
          </p>
        </section>
      </article>
    </LegalPage>
  );
}
