"use client";

import type { User } from "@supabase/supabase-js";
import { useRef, useState, type FormEvent } from "react";
import { Avatar } from "@/components/arc/avatar/avatar";
import { Button } from "@/components/arc/button/button";
import { Input } from "@/components/arc/input/input";
import { useToastStack } from "@/components/arc/toast-stack/toast-stack";
import { LoadingContent } from "@/components/loading/loading-ui";
import { useAccountProfile } from "@/lib/account-profile";
import { useSession } from "@/lib/session";
import { useNavigationDraft } from "@/lib/use-navigation-draft";
import { SettingsActions, type SettingsNotice } from "../settings";
import styles from "../settings.module.css";
import { ProfileSkeleton, profileLoadingLabel } from "./profile-skeleton";

export function ProfileSettings() {
  const session = useSession();

  if (!session) {
    return (
      <LoadingContent label={profileLoadingLabel}>
        <ProfileSkeleton />
      </LoadingContent>
    );
  }

  return <ProfileForm key={session.user.id} user={session.user} />;
}

function ProfileForm({ user }: { user: User }) {
  const { name: savedName, accountName, hasCustomName, email, saveName } = useAccountProfile(user);
  const { toast } = useToastStack();
  const [draftName, setDraftName] = useNavigationDraft<string | null>(user.id, "profile-name", null);
  const [nameError, setNameError] = useState("");
  const [saveError, setSaveError] = useState("");
  const [notice, setNotice] = useState<SettingsNotice | null>(null);
  const nameInput = useRef<HTMLInputElement>(null);
  const name = draftName ?? savedName;

  function cancel() {
    setDraftName(null);
    setNameError("");
    setSaveError("");
    setNotice({ kind: "restored", text: "Se restauró el nombre guardado." });
  }

  function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const cleanName = name.trim();
    setNameError("");
    setSaveError("");
    setNotice(null);

    if (!cleanName) {
      setNameError("Escribe un nombre para el perfil.");
      nameInput.current?.focus();
      return;
    }

    if (!saveName(cleanName)) {
      setSaveError("Ocurrió un problema al guardar el perfil. Vuelve a intentarlo.");
      return;
    }

    setDraftName(null);
    setNotice({ kind: "saved", text: "Perfil guardado para esta sesión." });
    toast({ type: "success", title: "Perfil guardado para esta sesión" });
  }

  function restoreAccountName() {
    if (!saveName("")) {
      setSaveError("No se pudo restaurar el nombre de la cuenta. Vuelve a intentarlo.");
      return;
    }
    setDraftName(null);
    setNameError("");
    setSaveError("");
    setNotice({ kind: "restored", text: accountName ? "Se restauró el nombre de la cuenta." : "Se quitó el nombre personalizado." });
    nameInput.current?.focus();
  }

  return (
    <form className={styles.settings} onSubmit={save} noValidate>
      <section className={styles.panel} aria-labelledby="profile-title">
        <h2 id="profile-title">Datos del perfil</h2>
        <Avatar name={name.trim() || email || "?"} size="xl" className={styles.avatar} />

        <div className={styles.fields}>
          <Input
            ref={nameInput}
            className={styles.control}
            label="Nombre"
            name="nombre"
            description="Los cambios de nombre se guardan en esta pestaña del navegador."
            autoComplete="name"
            placeholder="Nombre completo…"
            maxLength={100}
            value={name}
            error={nameError}
            onChange={event => {
              setDraftName(event.target.value);
              setNameError("");
              setSaveError("");
              setNotice(null);
            }}
          />
          <Input
            className={styles.control}
            label="Correo electrónico"
            name="email"
            autoComplete="email"
            value={email || "Correo de cuenta no disponible"}
            readOnly
          />
        </div>
        {hasCustomName && <Button type="button" variant="secondary" onClick={restoreAccountName}>
          {accountName ? "Restaurar nombre de la cuenta" : "Quitar nombre personalizado"}
        </Button>}
      </section>

      <SettingsActions ready notice={notice} error={saveError} onCancel={cancel} />
    </form>
  );
}
