"use client";

import { useEffect, useId, useRef, useState } from "react";
import { Button } from "@/components/arc/button/button";
import { Input } from "@/components/arc/input/input";
import { useToastStack } from "@/components/arc/toast-stack/toast-stack";
import { formatProspectDate } from "./prospects-api";
import styles from "./prospects.module.css";

export type ProspectLinkView = { url: string; expiresAt: string };

/** Shows the link only while the dialog is open. Nothing is stored: closing the dialog discards the token. */
export function ProspectLinkDialog({ link, onClose }: { link: ProspectLinkView; onClose: () => void }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  const { toast } = useToastStack();
  const [copying, setCopying] = useState(false);

  useEffect(() => {
    const element = dialog.current;
    if (!element || element.open) return;
    element.showModal();
  }, []);

  function close() {
    dialog.current?.close();
    onClose();
  }

  async function copy() {
    setCopying(true);
    try {
      await navigator.clipboard.writeText(link.url);
      toast({ type: "success", title: "Enlace copiado" });
    } catch {
      toast({ type: "error", title: "No se pudo copiar", description: "Selecciona el enlace y cópialo manualmente." });
    } finally {
      setCopying(false);
    }
  }

  return (
    <dialog
      ref={dialog}
      className={styles.dialog}
      aria-labelledby={titleId}
      onCancel={event => {
        event.preventDefault();
        close();
      }}
    >
      <div className={styles.dialogHeader}>
        <h2 id={titleId}>Enlace para prospecto</h2>
        <p>Vence el {formatProspectDate(link.expiresAt)} · válido por 24 horas.</p>
      </div>
      <div className={styles.dialogBody}>
        <div className={styles.copyRow}>
          <Input label="URL del prospecto" value={link.url} readOnly onFocus={event => event.currentTarget.select()} />
          <Button type="button" onClick={() => void copy()} loading={copying}>Copiar enlace</Button>
        </div>
        <p className={styles.muted}>
          Copia el enlace antes de cerrar y compártelo con el cliente. Solo podrá enviar sus datos una vez.
        </p>
      </div>
      <div className={styles.dialogActions}>
        <Button type="button" variant="secondary" onClick={close}>Cerrar</Button>
      </div>
    </dialog>
  );
}
