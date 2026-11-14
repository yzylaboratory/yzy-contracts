import Link from "next/link";
import styles from "./contract-editor.module.css";

export function ContractEditorBreadcrumb({
  title,
  confirmNavigation,
}: {
  title: string;
  confirmNavigation?: () => boolean;
}) {
  return (
    <nav className={styles.breadcrumb} aria-label="Ruta del contrato">
      <Link
        href="/contratos"
        onNavigate={confirmNavigation && (event => {
          if (!confirmNavigation()) event.preventDefault();
        })}
      >
        Contratos
      </Link>
      <span aria-hidden="true"> / </span>
      <span aria-current="page">{title}</span>
    </nav>
  );
}
