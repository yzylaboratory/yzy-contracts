"use client";

import { useState, type FormEvent } from "react";
import { Select } from "@/components/arc/select/select";
import { useToastStack } from "@/components/arc/toast-stack/toast-stack";
import { LoadingContent } from "@/components/loading/loading-ui";
import { useSession } from "@/lib/session";
import { useNavigationDraft } from "@/lib/use-navigation-draft";
import { usePortalPreferences, type PortalPreferences } from "../preferences-store";
import { SettingsActions, type SettingsNotice } from "../settings";
import styles from "../settings.module.css";
import { PreferencesSkeleton, preferencesLoadingLabel } from "./preferences-skeleton";

type PreferencesDraft = Pick<PortalPreferences, "defaultFormat" | "sendCopy">;
const emptyDraft: Partial<PreferencesDraft> = {};

const formats = [
  { value: "pdf", label: "PDF" },
  { value: "docx", label: "Word" },
  { value: "email", label: "Correo" },
];

export function DocumentPreferences() {
  const accountId = useSession()?.user.id;
  return accountId ? <DocumentPreferencesForm key={accountId} accountId={accountId} /> : (
    <LoadingContent label={preferencesLoadingLabel}><PreferencesSkeleton /></LoadingContent>
  );
}

function DocumentPreferencesForm({ accountId }: { accountId: string }) {
  const { preferences, ready, savePreferences } = usePortalPreferences();
  const { toast } = useToastStack();
  const [draft, setDraft] = useNavigationDraft(accountId, "document-preferences", emptyDraft);
  const [notice, setNotice] = useState<SettingsNotice | null>(null);
  const [saveError, setSaveError] = useState("");
  const current = { ...preferences, ...draft };

  function update<Key extends keyof PreferencesDraft>(key: Key, value: PreferencesDraft[Key]) {
    setDraft({ ...draft, [key]: value });
    setNotice(null);
    setSaveError("");
  }

  function cancel() {
    setDraft(emptyDraft);
    setSaveError("");
    setNotice({ kind: "restored", text: "Se restauraron las preferencias guardadas." });
  }

  function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!ready) return;

    setNotice(null);
    setSaveError("");
    if (!savePreferences(draft)) {
      setSaveError("Ocurrió un problema al guardar las preferencias. Vuelve a intentarlo.");
      return;
    }

    setDraft(emptyDraft);
    setNotice({ kind: "saved", text: "Preferencias guardadas para esta sesión." });
    toast({ type: "success", title: "Preferencias guardadas para esta sesión" });
  }

  if (!ready) {
    return (
      <LoadingContent label={preferencesLoadingLabel}>
        <PreferencesSkeleton />
      </LoadingContent>
    );
  }

  return (
    <form className={styles.settings} onSubmit={save}>
      <section className={styles.panel} aria-labelledby="preferences-title">
        <h2 id="preferences-title">Documentos y correo</h2>
        <div className={styles.fields}>
          <Select
            className={styles.control}
            label="Formato predeterminado"
            name="formato"
            options={formats}
            value={current.defaultFormat}
            onValueChange={value => {
              if (value === "pdf" || value === "docx" || value === "email") update("defaultFormat", value);
            }}
          />
        </div>

        <div className={styles.copyField}>
          <label className={styles.checkbox}>
            <input
              name="copia"
              type="checkbox"
              checked={current.sendCopy}
              onChange={event => update("sendCopy", event.target.checked)}
              aria-describedby="preferences-hint"
            />
            Incluirme en copia al preparar correos
          </label>
          <p id="preferences-hint" className={styles.hint}>El formato se aplica al abrir el generador. Si hay un correo de cuenta disponible, la copia se añade a los borradores.</p>
        </div>
      </section>

      <SettingsActions ready={ready} notice={notice} error={saveError} onCancel={cancel} />
    </form>
  );
}
