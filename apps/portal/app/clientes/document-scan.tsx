"use client";

import { useEffect, useRef, useState } from "react";
import { ScanText } from "lucide-react";
import { Alert } from "@/components/arc/alert/alert";
import { Button } from "@/components/arc/button/button";
import { FileDropzone } from "@/components/arc/file-dropzone/file-dropzone";
import SegmentedControl from "@/components/arc/segmented-control/segmented-control";
import { documentAccept, documentMaxBytes, documentMaxFiles, documentReadingErrorMessage, type DocumentCategory } from "./document-readings-api";
import styles from "./document-scan.module.css";

/** What the form did with a reading: the labels it filled and what to double-check. */
export type ScanOutcome = { filled: string[]; warnings: string[] } | { mismatch: string };

type ScanOption = { value: DocumentCategory; label: string; uploadLabel: string; hint: string };

type Result = { tone: "success" | "warning" | "danger"; title: string; detail?: string; warnings?: string[] };

export function DocumentScan({ title, options, disabled = false, onRead }: {
  title: string;
  options: readonly ScanOption[];
  disabled?: boolean;
  onRead: (category: DocumentCategory, files: File[], signal: AbortSignal) => Promise<ScanOutcome>;
}) {
  const [category, setCategory] = useState<DocumentCategory>(options[0]!.value);
  const [files, setFiles] = useState<File[]>([]);
  const [dropzoneKey, setDropzoneKey] = useState(0);
  const [reading, setReading] = useState(false);
  const [result, setResult] = useState<Result | null>(null);
  const controller = useRef<AbortController | null>(null);
  const option = options.find(item => item.value === category) ?? options[0]!;
  const oversized = files.some(file => file.size > documentMaxBytes);

  useEffect(() => () => controller.current?.abort(), []);

  async function read() {
    if (reading || files.length === 0 || oversized) return;
    controller.current?.abort();
    const current = new AbortController();
    controller.current = current;
    setReading(true);
    setResult(null);
    try {
      const outcome = await onRead(category, files, current.signal);
      if (current.signal.aborted) return;
      if ("mismatch" in outcome) {
        setResult({ tone: "warning", title: outcome.mismatch, detail: "No se cambió ningún campo. Revisa el archivo o elige otro tipo de documento." });
        return;
      }
      setFiles([]);
      setDropzoneKey(key => key + 1);
      setResult(outcome.filled.length === 0
        ? { tone: "warning", title: "No se encontraron datos para rellenar", detail: "Prueba con una foto más nítida y completa.", warnings: outcome.warnings }
        : {
          tone: outcome.warnings.length ? "warning" : "success",
          title: `Se rellenaron ${outcome.filled.length} ${outcome.filled.length === 1 ? "campo" : "campos"}`,
          detail: `${outcome.filled.join(", ")}. Revísalos antes de guardar.`,
          warnings: outcome.warnings,
        });
    } catch (error) {
      if (current.signal.aborted) return;
      setResult({ tone: "danger", title: "No se pudo leer el documento", detail: documentReadingErrorMessage(error) });
    } finally {
      if (controller.current === current) {
        controller.current = null;
        setReading(false);
      }
    }
  }

  return <section className={styles.scan} aria-label={title}>
    <div className={styles.heading}>
      <ScanText size={18} aria-hidden="true" />
      <h3>{title}</h3>
    </div>
    {options.length > 1 && <SegmentedControl label="Tipo de documento" value={category}
      options={options.map(({ value, label }) => ({ value, label }))}
      onValueChange={value => { if (!reading) { setCategory(value as DocumentCategory); setResult(null); } }} />}
    <FileDropzone key={dropzoneKey} accept={documentAccept} maxFiles={documentMaxFiles} maxSize={documentMaxBytes}
      label={option.uploadLabel} description={option.hint}
      note="Foto JPEG, PNG o WebP, o PDF. Hasta 10 MB por archivo." compactAt={1}
      onFilesChange={next => { setFiles(next); setResult(null); }} />
    <div className={styles.actions}>
      <Button type="button" variant="secondary" loading={reading} disabled={disabled || files.length === 0 || oversized} onClick={() => void read()}>
        {reading ? "Leyendo documento…" : "Leer y rellenar campos"}
      </Button>
      <p className={styles.muted} role="status">
        {reading ? "Puede tardar hasta un minuto." : oversized ? "Quita los archivos de más de 10 MB para continuar." : ""}
      </p>
    </div>
    <Alert open={result !== null} tone={result?.tone ?? "info"} title={result?.title ?? ""}>
      {result?.detail}
      {result?.warnings && result.warnings.length > 0 && <ul className={styles.warnings}>
        {result.warnings.map(warning => <li key={warning}>{warning}</li>)}
      </ul>}
    </Alert>
  </section>;
}
