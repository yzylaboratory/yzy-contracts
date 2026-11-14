"use client";

import { useEffect, useId, useRef } from "react";
import { Button } from "@/components/arc/button/button";
import styles from "./document-preview-dialog.module.css";

type PreviewProps = {
  onClose: () => void;
  onOpen?: () => void;
  documentName?: string;
  pdfUrl: string;
};

export function DocumentPreviewDialog({ pdfUrl, onClose, onOpen, documentName }: PreviewProps) {
  const dialog = useRef<HTMLDialogElement>(null);
  const titleId = useId();

  useEffect(() => {
    const element = dialog.current;
    if (!element || element.open) return;
    element.showModal();
    if (element.open) onOpen?.();
  }, [onOpen]);

  function close() {
    dialog.current?.close();
    onClose();
  }

  return (
    <dialog
      ref={dialog}
      className={styles.dialog}
      data-format="pdf"
      aria-labelledby={titleId}
      onCancel={event => {
        event.preventDefault();
        close();
      }}
      onKeyDown={event => {
        if (event.key !== "Escape") return;
        event.preventDefault();
        event.stopPropagation();
        close();
      }}
    >
      <div className={styles.header}>
        <div>
          <h2 id={titleId}>Vista previa del PDF</h2>
          {documentName && <p>{documentName}</p>}
        </div>
        <Button type="button" variant="secondary" onClick={close}>
          Cerrar
        </Button>
      </div>
      {navigator.pdfViewerEnabled === false ? (
        <p className={styles.pdfLink}>Abre el PDF en una pestaña nueva para verlo en este navegador.</p>
      ) : (
        <iframe className={styles.pdfFrame} src={pdfUrl} title="Documento PDF" />
      )}
      <div className={styles.pdfLink}>
        <a href={pdfUrl} target="_blank" rel="noreferrer">Abrir PDF en otra pestaña</a>
      </div>
    </dialog>
  );
}
