"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { AccessActionLink } from "@/components/access/access-links";
import { AccessScreen } from "@/components/access/access-screen";
import { supabase } from "@/lib/supabase";

export function AuthCallback() {
  const router = useRouter();
  const [failure, setFailure] = useState<"link" | "connection" | null>(null);

  const attempt = useRef<Promise<"success" | "link" | "connection"> | null>(null);

  useEffect(() => {
    let active = true;
    attempt.current ??= (async () => {
      const url = new URL(window.location.href);
      const fragment = new URLSearchParams(url.hash.slice(1));
      const tokenHash = fragment.get("token_hash");
      if (tokenHash !== null) {
        const validType = fragment.get("type") === "email";
        window.history.replaceState(window.history.state, "", url.pathname);
        if (!tokenHash || !validType) return "link";
        const { data, error } = await supabase.auth.verifyOtp({ type: "email", token_hash: tokenHash });
        if (!error && data.session) return "success";
        return error?.status === 429 || (error?.status ?? 0) >= 500 || error?.name === "AuthRetryableFetchError"
          ? "connection" : "link";
      }
      // The Supabase client completes the existing PKCE exchange before returning the session.
      const { data } = await supabase.auth.getSession();
      return data.session ? "success" : "link";
    })();
    void attempt.current.then(result => {
      if (!active) return;
      if (result === "success") router.replace("/preacceso");
      else setFailure(result);
    }).catch(() => { if (active) setFailure("connection"); });
    return () => { active = false; };
  }, [router]);

  return (
    <AccessScreen title={failure ? "No se pudo iniciar sesión" : "Confirmando tu acceso"} canSignOut={false}
      action={failure && <AccessActionLink href={failure === "link" ? "/login?acceso=correo" : "/login"}>
        {failure === "link" ? "Solicitar otro enlace" : "Volver al acceso"}
      </AccessActionLink>}>
      {failure ? (
        <p role="alert">{failure === "link" ? "El enlace no es válido o ya venció. Solicita uno nuevo con tu correo." : "El servicio no respondió. Vuelve a intentar en un momento."}</p>
      ) : (
        <p role="status">Iniciando sesión…</p>
      )}
    </AccessScreen>
  );
}
