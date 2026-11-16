import { Button } from "@/components/arc/button/button";
import styles from "./settings.module.css";

/** Header back control for settings subpages (replaces the default “Mis empresas” link). */
export const settingsBackLink = { href: "/configuracion", label: "Volver a Configuración" } as const;

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
