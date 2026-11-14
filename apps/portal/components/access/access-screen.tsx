"use client";

import { useRouter } from "next/navigation";
import { useState, type ReactNode } from "react";
import { CircleAlert, Clock3, LockKeyhole } from "lucide-react";
import { Button } from "@/components/arc/button/button";
import { signOut } from "@/lib/session";
import styles from "./access-screen.module.css";

export function AccessScreen({ title = "Comprobando tu acceso…", children, action, pending = false, status, canSignOut = true }: {
  title?: string;
  children?: ReactNode;
  action?: ReactNode;
  pending?: boolean;
  status?: "checking" | "error";
  canSignOut?: boolean;
}) {
  const router = useRouter();
  const [leaving, setLeaving] = useState(false);
  const [failure, setFailure] = useState("");

  async function leave() {
    if (leaving) return;
    setLeaving(true);
    setFailure("");
    try {
      const { error } = await signOut();
      if (error) throw error;
      router.replace("/login");
    } catch {
      setFailure("No pudimos cerrar la sesión. Intenta de nuevo.");
      setLeaving(false);
    }
  }

  return (
    <main className={styles.page} data-status={status}>
      <section className={styles.card} aria-labelledby="access-title">
        <div className={styles.brand} translate="no"><span className={styles.mark} aria-hidden="true">Y</span>YZY Contracts</div>
        {pending && <Clock3 className={styles.icon} aria-hidden="true" size={24} />}
        <div className={styles.content}>
          {status && (
            <span className={styles.statusIcon} aria-hidden="true">
              {status === "checking" ? <LockKeyhole size={26} /> : <CircleAlert size={26} />}
            </span>
          )}
          <h1 id="access-title">{title}</h1>
          {status === "checking" ? (
            <>
              <p role="status">Estamos verificando los permisos de tu cuenta.</p>
              <span className={styles.progress} aria-hidden="true" />
            </>
          ) : children}
        </div>
        {(action || canSignOut) && (
          <div className={styles.actions}>
            {action}
            {canSignOut && <Button type="button" variant={status ? "ghost" : "secondary"} loading={leaving} disabled={leaving} onClick={() => void leave()}>Cerrar sesión</Button>}
          </div>
        )}
        {failure && <p className={styles.failure} role="alert">{failure}</p>}
      </section>
    </main>
  );
}
