import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { Button } from "@/components/arc/button/button";
import navigationStyles from "./settings-navigation.module.css";
import styles from "./settings.module.css";

export function SettingsBackLink({ confirmNavigation }: { confirmNavigation?: () => boolean } = {}) {
  return (
    <Link className={navigationStyles.back} href="/configuracion" onNavigate={confirmNavigation && (event => {
      if (!confirmNavigation()) event.preventDefault();
    })}>
      <ArrowLeft size={18} aria-hidden="true" />
      Volver a Configuración
    </Link>
  );
}

export type SettingsNotice = { kind: "saved" | "restored"; text: string };

export function SettingsActions({
  ready,
  notice,
  error,
  onCancel,
}: {
  ready: boolean;
  notice: SettingsNotice | null;
  error: string;
  onCancel: () => void;
}) {
  return (
    <div className={styles.actions}>
      <p className={styles.notice} role="status">{notice?.kind === "restored" ? notice.text : ""}</p>
      {notice?.kind === "saved" && <p className={styles.notice}>{notice.text}</p>}
      {error && <p className={styles.error} role="alert">{error}</p>}
      <div className={styles.buttons}>
        <Button type="button" variant="secondary" className={styles.secondary} onClick={onCancel}>Cancelar</Button>
        <Button type="submit" className={styles.primary} disabled={!ready}>Guardar cambios</Button>
      </div>
    </div>
  );
}
