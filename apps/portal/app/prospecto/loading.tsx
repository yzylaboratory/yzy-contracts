import { Skeleton } from "@/components/arc/skeleton/skeleton";
import styles from "./prospect-form.module.css";

export default function ProspectoLoading() {
  return (
    <section className={styles.mainCard} aria-busy="true">
      <span className={styles.srOnly} role="status">Verificando tu enlace…</span>
      <div aria-hidden="true" className={styles.fieldsContainer}>
        <Skeleton lines={2} />
        <Skeleton lines={2} />
        <Skeleton lines={2} />
        <Skeleton lines={1} />
      </div>
    </section>
  );
}
