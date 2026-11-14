import { LoadingBlock, PortalLoading } from "@/components/loading/loading-ui";
import { SettingsBackLink } from "../settings";
import styles from "../legal-document.module.css";

const headingWidths = [218, 240, 216, 310, 180];

export default function PrivacyPolicyLoading() {
  return (
    <PortalLoading
      currentPage="/configuracion"
      title="Políticas de privacidad"
      description="Cómo YZY Contracts utiliza los datos y qué puedes hacer para gestionarlos."
      breadcrumb={<SettingsBackLink />}
      label="Cargando las políticas de privacidad…"
    >
      <div className={styles.document}>
        <div className={`${styles.copy} ${styles.placeholder}`}>
          <LoadingBlock />
          <LoadingBlock width="74%" />
        </div>
        {headingWidths.map(width => (
          <div className={styles.section} key={width}>
            <div className={styles.placeholder}>
              <LoadingBlock width={width} />
            </div>
            <div className={`${styles.copy} ${styles.placeholder}`}>
              <LoadingBlock />
              <LoadingBlock width="82%" />
              <LoadingBlock width="64%" />
            </div>
          </div>
        ))}
      </div>
    </PortalLoading>
  );
}
