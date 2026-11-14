import type { Metadata } from "next";
import Link from "next/link";
import { LegalPage } from "../legal-page";
import styles from "../legal-document.module.css";

export const metadata: Metadata = {
  title: "Términos y condiciones | YZY Contracts",
  description: "Conoce las condiciones de uso de YZY Contracts y cómo manejar los documentos que generas.",
};

export default function TermsPage() {
  return (
    <LegalPage
      title="Términos y condiciones"
      description="Condiciones de uso del portal y de los documentos que generas."
    >
      <article className={styles.document} aria-label="Términos de uso">
        <p className={styles.copy}>Versión 1</p>
        <section className={styles.section}>
          <h2>Alcance del portal</h2>
          <p className={styles.copy}>
            <span translate="no">YZY LABS</span> opera <span translate="no">YZY Contracts</span>. El portal te permite crear y editar contratos, descargar documentos en PDF o Word (DOCX) y preparar borradores de correo en formato EML. Tú decides si abres y envías esos borradores desde tu aplicación de correo.
          </p>
        </section>

        <section className={styles.section}>
          <h2>Uso permitido y acceso</h2>
          <p className={styles.copy}>
            Usa el portal para fines lícitos. Abstente de suplantar a otras personas, intentar acceder a sistemas o datos sin autorización o interferir con el funcionamiento del portal.
          </p>
          <p className={styles.copy}>
            Puedes acceder con Google o un enlace enviado al correo de tu cuenta. Controla quién puede acceder a tu dispositivo y a la pestaña donde trabajas.
          </p>
        </section>

        <section className={styles.section}>
          <h2>Contenido que incorporas</h2>
          <p className={styles.copy}>
            Conservas los derechos que tengas sobre los textos y archivos que incorporas al portal. Si utilizas contenido de terceros o datos de otras personas, asegúrate de contar con la autorización necesaria y de respetar tus obligaciones de confidencialidad.
          </p>
        </section>

        <section className={styles.section}>
          <h2>Revisión de los documentos</h2>
          <p className={styles.copy}>
            Las plantillas y los documentos generados son borradores para revisión. Antes de firmar, enviar o utilizar un documento, verifica los datos de las partes, las fechas, las cláusulas y los campos pendientes. Si necesitas asesoría jurídica, consulta a un profesional cualificado.
          </p>
        </section>

        <section className={styles.section}>
          <h2>Almacenamiento y descargas</h2>
          <p className={styles.copy}>
            El portal guarda los contratos y el historial de documentos generados en tu cuenta. Puedes volver a descargar un documento desde el historial al iniciar sesión. Guarda tus copias descargadas en un lugar al que solo tengan acceso las personas autorizadas.
          </p>
        </section>

        <section className={styles.section}>
          <h2>Disponibilidad y cambios</h2>
          <p className={styles.copy}>
            Algunas funciones pueden quedar temporalmente indisponibles por mantenimiento, fallos técnicos o restricciones del navegador. Si cambian estos términos, podrás consultar la versión actualizada en esta página.
          </p>
        </section>

        <section className={styles.section}>
          <h2>Privacidad y contacto</h2>
          <p className={styles.copy}>
            Consulta las <Link href="/configuracion/politica-de-privacidad">políticas de privacidad</Link> para conocer cómo se usan y almacenan los datos. Si tienes preguntas sobre estos términos, consulta los <Link href="/configuracion/politica-de-privacidad#contacto">datos de contacto</Link>.
          </p>
        </section>
      </article>
    </LegalPage>
  );
}
