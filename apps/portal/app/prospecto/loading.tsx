import { BrandMark } from "@/components/brand/brand-mark";
import { Skeleton } from "@/components/arc/skeleton/skeleton";
import styles from "./prospect-form.module.css";

export default function ProspectoLoading() {
  return (
    <main className={styles.page}>
      <header className={styles.header}>
        <div className={styles.brand} translate="no">
          <BrandMark className={styles.brandMark} variant="stone" />
          YZY Contracts
        </div>
      </header>

      <section
        className={styles.mainCard}
        aria-busy="true"
        aria-live="polite"
      >
        <span className={styles.srOnly} role="status">
          Cargando formulario de prospecto...
        </span>

        <div className={styles.stepIntro}>
          <Skeleton lines={1} />
          <Skeleton lines={2} />
        </div>

        <div className={styles.fieldsContainer}>
          <Skeleton lines={2} />
          <Skeleton lines={2} />
          <Skeleton lines={2} />
        </div>

        <div className={styles.actionsRow}>
          <Skeleton lines={1} />
        </div>
      </section>
    </main>
  );
}
