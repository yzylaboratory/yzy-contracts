"use client";

import { useEffect, useId, useRef, useState, type FormEvent } from "react";
import { Button } from "@/components/arc/button/button";
import { Input } from "@/components/arc/input/input";
import { useToastStack } from "@/components/arc/toast-stack/toast-stack";
import { formatCedula } from "../clientes/client-masks";
import { createProspectLink, formatProspectDate, prospectErrorMessage, prospectLinkUrl } from "./prospects-api";
import styles from "./prospects.module.css";

type ProspectLinkView = { url: string; expiresAt: string };

/** Shows the link only while the dialog is open. Nothing is stored: closing the dialog discards the token. */
export function ProspectLinkDialog({ accountId, companyId, onClose }: {
  accountId: string; companyId: string; onClose: () => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  const { toast } = useToastStack();
  const [identity, setIdentity] = useState("");
  const [link, setLink] = useState<ProspectLinkView>();
  const [generating, setGenerating] = useState(false);
  const [failure, setFailure] = useState("");
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

  async function generate(event: FormEvent) {
    event.preventDefault();
    if (generating) return;
    if (identity.replaceAll("-", "").length !== 11) {
      setFailure("Escribe los 11 dígitos de la cédula.");
      return;
    }
    setGenerating(true);
    setFailure("");
    try {
      const created = await createProspectLink(accountId, companyId, identity);
      setLink({ url: prospectLinkUrl(window.location.origin, created.token), expiresAt: created.expires_at });
      setIdentity("");
    } catch (error) {
      setFailure(prospectErrorMessage(error, "No se pudo crear el enlace. Intenta de nuevo."));
    } finally {
      setGenerating(false);
    }
  }

  async function copy() {
    if (!link) return;
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
        if (!generating) close();
      }}
    >
      <div className={styles.dialogHeader}>
        <h2 id={titleId}>Enlace para prospecto</h2>
        <p>{link
          ? `Vence el ${formatProspectDate(link.expiresAt)} · válido por 24 horas.`
          : "El cliente deberá escribir esta misma cédula para abrir el formulario."}</p>
      </div>
      {link ? (
        <>
          <div className={styles.dialogBody}>
            <div className={styles.copyRow}>
              <Input label="URL del prospecto" value={link.url} readOnly onFocus={event => event.currentTarget.select()} />
              <Button type="button" onClick={() => void copy()} loading={copying}>Copiar enlace</Button>
            </div>
            <p className={styles.muted}>El enlace admite un solo envío.</p>
          </div>
          <div className={styles.dialogActions}>
            <Button type="button" variant="secondary" onClick={close}>Cerrar</Button>
          </div>
        </>
      ) : (
        <form onSubmit={generate} noValidate>
          <div className={styles.dialogBody}>
            <Input label="Cédula del cliente" name="identity" inputMode="numeric" autoComplete="off"
              required value={identity} readOnly={generating} error={failure}
              onChange={event => { setIdentity(formatCedula(event.target.value)); setFailure(""); }} />
          </div>
          <div className={styles.dialogActions}>
            <Button type="button" variant="secondary" disabled={generating} onClick={close}>Cancelar</Button>
            <Button type="submit" loading={generating} disabled={generating}>Generar enlace</Button>
          </div>
        </form>
      )}
    </dialog>
  );
}
