import { ChevronRight } from "lucide-react";
import { LoadingBlock, PortalLoading } from "@/components/loading/loading-ui";
import styles from "./settings-navigation.module.css";

const labelWidths = [38, 86, 164, 159];

export default function SettingsLoading() {
  return (
    <PortalLoading
      currentPage="/configuracion"
      title="Configuración"
      description="Gestiona tu perfil y consulta los documentos legales."
    >
      <ul className={styles.links}>
        {labelWidths.map(width => (
          <li className={styles.link} key={width}>
            <div className={styles.icon}>
              <LoadingBlock width={20} height={20} />
            </div>
            <LoadingBlock width={width} height={14} />
            <ChevronRight className={styles.chevron} size={20} aria-hidden="true" />
          </li>
        ))}
      </ul>
    </PortalLoading>
  );
}
