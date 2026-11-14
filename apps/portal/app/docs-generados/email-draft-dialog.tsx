"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import { Button } from "@/components/arc/button/button";
import { Input } from "@/components/arc/input/input";
import { Textarea } from "@/components/arc/textarea/textarea";
import { usePortalPreferences } from "@/app/configuracion/preferences-store";
import { getGeneratedArtifact, type GeneratedDocument } from "@/app/contratos/generated-documents-api";
import { createDocumentBlob, createEmailDraftBlob, downloadBlob, isEmailAddress } from "@/app/contratos/document-export";
import { isActiveAccount } from "@/lib/api";
import shared from "../contratos/contracts.module.css";
import styles from "./generated-documents.module.css";

export function EmailDraftDialog({ record, accountId, accountEmail, onClose, onDownload }: {
  record: GeneratedDocument;
  accountId: string;
  accountEmail: string;
  onClose: () => void;
  onDownload: () => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const { preferences } = usePortalPreferences();
  const [to, setTo] = useState(record.email?.to ?? "");
  const ownEmail = accountEmail.trim();
  const cc = preferences.sendCopy && isEmailAddress(ownEmail) && ownEmail.toLowerCase() !== to.trim().toLowerCase() ? ownEmail : undefined;
  const [subject, setSubject] = useState(record.email?.subject ?? record.contractName);
  const [message, setMessage] = useState(record.email?.message ?? "");
  const [attachmentFormat, setAttachmentFormat] = useState<"pdf" | "docx">(record.email?.attachmentFormat ?? "pdf");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [fieldErrors, setFieldErrors] = useState<Partial<Record<"to" | "subject" | "message", string>>>({});
  const attachmentName = record.filename.replace(/\.[^.]+$/, "") + `.${attachmentFormat}`;

  useEffect(() => {
    const element = dialog.current;
    if (element && !element.open) element.showModal();
  }, []);

  async function prepare(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;

    const form = event.currentTarget;
    const errors = {
      to: !isEmailAddress(to.trim()) ? "Escribe un correo electrónico válido." : undefined,
      subject: !subject.trim() ? "Escribe el asunto del correo." : undefined,
      message: !message.trim() ? "Escribe el mensaje del correo." : undefined,
    };
    const firstInvalid = Object.entries(errors).find(([, message]) => message)?.[0];
    setFieldErrors(errors);
    setError("");
    if (firstInvalid) {
      const control = form.elements.namedItem(firstInvalid);
      if (control instanceof HTMLElement) control.focus();
      return;
    }

    setBusy(true);
    try {
      const attachment = record.hasArtifact
        ? await getGeneratedArtifact(accountId, record.id)
        : await createDocumentBlob(attachmentFormat, record.contractName, record.markdown);
      const draft = await createEmailDraftBlob({ to: to.trim(), cc, subject: subject.trim(), message: message.trim(), attachment, attachmentName });
      if (!await isActiveAccount(accountId) || !dialog.current?.open) return;
      downloadBlob(draft, record.filename);
      onDownload();
      dialog.current?.close();
    } catch {
      setError("No se pudo preparar el correo. Inténtalo de nuevo.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <dialog
      ref={dialog}
      className={styles.dialog}
      aria-labelledby="email-draft-title"
      onClose={onClose}
      onCancel={event => { if (busy) event.preventDefault(); }}
    >
      <div className={styles.dialogHeader}>
        <h2 id="email-draft-title">Preparar reenvío</h2>
        <p>{record.contractName}</p>
      </div>
      <form className={styles.dialogForm} onSubmit={prepare} noValidate>
        <Input label="Para" name="to" type="email" autoComplete="email" required readOnly={busy} value={to} error={fieldErrors.to}
          onChange={event => { setTo(event.target.value); setFieldErrors(current => ({ ...current, to: undefined })); }} />
        <Input label="Asunto" name="subject" required readOnly={busy} value={subject} error={fieldErrors.subject}
          onChange={event => { setSubject(event.target.value); setFieldErrors(current => ({ ...current, subject: undefined })); }} />
        <Textarea label="Mensaje" name="message" rows={4} required readOnly={busy} value={message} error={fieldErrors.message}
          onChange={event => { setMessage(event.target.value); setFieldErrors(current => ({ ...current, message: undefined })); }} />
        <label className={styles.attachmentPicker}>
          Adjuntar como
          <select disabled={busy || record.hasArtifact} value={attachmentFormat} onChange={event => setAttachmentFormat(event.target.value === "docx" ? "docx" : "pdf")}>
            <option value="pdf">PDF</option>
            <option value="docx">Word</option>
          </select>
        </label>
        {!record.hasArtifact && <p>El adjunto será una copia reconstruida y su diseño puede variar.</p>}
        <section className={styles.emailPreview} aria-labelledby="email-preview-title">
          <h3 id="email-preview-title">Vista previa del correo</h3>
          <dl>
            <div><dt>Para</dt><dd>{to || "—"}</dd></div>
            {cc && <div><dt>Copia</dt><dd>{cc}</dd></div>}
            <div><dt>Asunto</dt><dd>{subject || "—"}</dd></div>
          </dl>
          <p className={styles.message}>{message || "—"}</p>
          <p>{attachmentName}</p>
        </section>
        {error && <p className={styles.error} role="alert">{error}</p>}
        <div className={styles.dialogActions}>
          <Button type="button" variant="secondary" disabled={busy} onClick={() => dialog.current?.close()}>Cancelar</Button>
          <Button type="submit" className={shared.primary} loading={busy}>Descargar borrador</Button>
        </div>
      </form>
    </dialog>
  );
}
