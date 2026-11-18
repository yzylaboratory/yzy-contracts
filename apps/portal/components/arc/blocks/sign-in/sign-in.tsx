"use client";

import { useEffect, useRef, useState, useSyncExternalStore, type FormEvent } from "react";
import { ChevronLeft } from "lucide-react";
import Image from "next/image";
import { useRouter } from "next/navigation";
import { AccessLegalLinks } from "@/components/access/access-links";
import { usePortalAccess } from "@/lib/portal-access";
import { useSession } from "@/lib/session";
import { supabase } from "@/lib/supabase";
import { Button } from "../../button/button";
import { Input } from "../../input/input";
import styles from "./sign-in.module.css";

type Step = "options" | "email" | "sent";
const stepChanged = "yzy:sign-in-step";

function getStep(): Step {
  const value = new URLSearchParams(window.location.search).get("acceso");
  return value === "correo" ? "email" : value === "enlace-enviado" ? "sent" : "options";
}

function subscribeStep(listener: () => void) {
  window.addEventListener("popstate", listener);
  window.addEventListener(stepChanged, listener);
  return () => {
    window.removeEventListener("popstate", listener);
    window.removeEventListener(stepChanged, listener);
  };
}

function navigateStep(step: Step, back = false) {
  const previous = getStep();
  if (back && window.history.state?.yzySignInPrevious === step) {
    window.history.back();
    return;
  }
  const url = new URL(window.location.href);
  if (step === "options") url.searchParams.delete("acceso");
  else url.searchParams.set("acceso", step === "email" ? "correo" : "enlace-enviado");
  if (back) window.history.replaceState(null, "", url);
  else window.history.pushState({ yzySignInPrevious: previous }, "", url);
  window.dispatchEvent(new Event(stepChanged));
}

export function SignIn() {
  return process.env.NEXT_PUBLIC_SITE_URL === "https://yzycontracts.yzylabs.dev"
    ? <DevelopmentSignIn />
    : <ProductionSignIn />;
}

function DevelopmentSignIn() {
  const router = useRouter();
  const accountId = useSession()?.user.id;
  const { rememberRedirect } = usePortalAccess();
  const [pending, setPending] = useState(false);
  const [notice, setNotice] = useState("");
  const requestInFlight = useRef(false);

  useEffect(() => {
    if (!accountId) return;
    rememberRedirect(accountId, "/preacceso");
    router.replace("/preacceso");
  }, [accountId, rememberRedirect, router]);

  async function signIn(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (requestInFlight.current) return;
    requestInFlight.current = true;
    setPending(true);
    setNotice("");
    const form = new FormData(event.currentTarget);

    try {
      const { error } = await supabase.auth.signInWithPassword({
        email: String(form.get("email") ?? "").trim(),
        password: String(form.get("password") ?? ""),
      });
      if (error) throw error;
    } catch {
      setNotice("No se pudo iniciar sesión. Revisa tus credenciales de DEV.");
    } finally {
      requestInFlight.current = false;
      setPending(false);
    }
  }

  return (
    <div className={styles.signIn}>
      <div className={styles.heading}>
        <h1>Accede al entorno de pruebas</h1>
        <p>Inicia sesión con tu cuenta de YZY Contracts DEV.</p>
      </div>
      <form className={styles.card} onSubmit={signIn}>
        <Input label="Correo electrónico" name="email" type="email" autoComplete="username" required />
        <Input label="Contraseña" name="password" type="password" autoComplete="current-password" required />
        <Button type="submit" size="lg" className={styles.primary} loading={pending}>Iniciar sesión</Button>
      </form>
      <p className={styles.notice} role="status">{notice}</p>
      <AccessLegalLinks />
    </div>
  );
}

function ProductionSignIn() {
  const router = useRouter();
  const session = useSession();
  const { rememberRedirect } = usePortalAccess();
  const accountId = session?.user.id;
  const historyStep = useSyncExternalStore(subscribeStep, getStep, (): Step => "options");
  const [pending, setPending] = useState<"google" | "email" | null>(null);
  const [email, setEmail] = useState("");
  const [sentEmail, setSentEmail] = useState("");
  const step = historyStep === "sent" && !sentEmail ? "email" : historyStep;
  const [emailError, setEmailError] = useState("");
  const [notice, setNotice] = useState("");
  const requestInFlight = useRef(false);
  const emailOptionRef = useRef<HTMLButtonElement>(null);
  const emailRef = useRef<HTMLInputElement>(null);
  const sentHeadingRef = useRef<HTMLHeadingElement>(null);
  const previousStep = useRef<Step>("options");

  useEffect(() => {
    if (!accountId) return;
    rememberRedirect(accountId, "/preacceso");
    router.replace("/preacceso");
  }, [accountId, rememberRedirect, router]);

  useEffect(() => {
    if (step === "email") emailRef.current?.focus();
    if (step === "sent") sentHeadingRef.current?.focus();
    if (step === "options" && previousStep.current !== "options") emailOptionRef.current?.focus();
    previousStep.current = step;
  }, [step]);

  useEffect(() => {
    function restoreAfterOAuth(event: PageTransitionEvent) {
      if (!event.persisted) return;
      requestInFlight.current = false;
      setPending(null);
    }

    window.addEventListener("pageshow", restoreAfterOAuth);
    return () => window.removeEventListener("pageshow", restoreAfterOAuth);
  }, []);

  function openEmail() {
    setNotice("");
    setEmailError("");
    navigateStep("email", step === "sent");
  }

  function openOptions() {
    setNotice("");
    navigateStep("options", true);
  }

  async function signInWithGoogle() {
    if (requestInFlight.current) return;
    requestInFlight.current = true;
    setNotice("");
    setPending("google");

    try {
      const { error } = await supabase.auth.signInWithOAuth({
        provider: "google",
        options: { redirectTo: `${window.location.origin}/auth/callback` },
      });
      if (error) throw error;
    } catch {
      requestInFlight.current = false;
      setPending(null);
      setNotice("No se pudo abrir el acceso con Google. Vuelve a intentarlo.");
    }
  }

  async function submitEmail(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (requestInFlight.current) return;

    setNotice("");
    const address = email.trim();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(address)) {
      setEmailError(address ? "Escribe un correo válido." : "Escribe tu correo electrónico.");
      emailRef.current?.focus();
      return;
    }

    requestInFlight.current = true;
    setPending("email");
    setEmailError("");

    try {
      const { error } = await supabase.auth.signInWithOtp({
        email: address,
        options: {
          shouldCreateUser: false,
          emailRedirectTo: `${window.location.origin}/auth/callback`,
        },
      });

      if (error?.status === 429) {
        setNotice("Espera un momento antes de volver a solicitar el enlace.");
        return;
      }
      // Supabase may return either code for a missing account when signup is disabled.
      // Keep the confirmation the same so the screen doesn't reveal registered addresses.
      if (error && error.code !== "otp_disabled" && error.code !== "user_not_found") throw error;

      if (!["/", "/login"].includes(window.location.pathname) || getStep() === "options") return;
      setEmail(address);
      setSentEmail(address);
      navigateStep("sent", getStep() === "sent");
    } catch {
      setNotice("No se pudo solicitar el enlace. Vuelve a intentarlo.");
    } finally {
      requestInFlight.current = false;
      setPending(null);
    }
  }

  if (step === "email" || step === "sent") {
    return (
      <div className={styles.signIn}>
        <Button
          type="button"
          variant="ghost"
          className={styles.back}
          disabled={pending !== null}
          onClick={step === "sent" ? openEmail : openOptions}
        >
          <ChevronLeft size={18} aria-hidden="true" />
          {step === "sent" ? "Cambiar correo o solicitar otro enlace" : "Volver"}
        </Button>

        {step === "sent" ? (
          <div className={styles.heading}>
            <h1 ref={sentHeadingRef} tabIndex={-1}>Revisa tu correo</h1>
            <p>Si <strong>{sentEmail}</strong> tiene una cuenta, recibirás un enlace de acceso. Ábrelo en este mismo navegador.</p>
          </div>
        ) : (
          <>
            <div className={styles.heading}>
              <h1>Ingresa con tu correo</h1>
              <p>Solicita un enlace de acceso con el correo de tu cuenta.</p>
            </div>
            <form className={styles.card} onSubmit={submitEmail} noValidate>
              <Input
                ref={emailRef}
                className={styles.emailInput}
                label="Correo electrónico"
                name="email"
                type="email"
                inputMode="email"
                autoComplete="email"
                autoCapitalize="none"
                spellCheck={false}
                placeholder="nombre@correo.com…"
                required
                readOnly={pending !== null}
                value={email}
                error={emailError}
                onChange={event => {
                  setEmail(event.target.value);
                  setEmailError("");
                  setNotice("");
                }}
              />
              <Button type="submit" size="lg" className={styles.primary} loading={pending === "email"}>
                Enviar enlace de acceso
              </Button>
            </form>
          </>
        )}
        <p className={styles.notice} role="status">{notice}</p>
        <AccessLegalLinks />
      </div>
    );
  }

  return (
    <div className={styles.signIn}>
      <div className={styles.heading}>
        <h1>Accede a tu espacio</h1>
        <p>Inicia sesión en YZY Contracts con la cuenta de superadministrador.</p>
      </div>
      <div className={`${styles.card} ${styles.options}`} role="group" aria-label="Métodos de acceso">
        <p className={styles.cardTitle}>Acceder con</p>
        <Button
          type="button"
          variant="secondary"
          size="lg"
          className={`${styles.provider} ${styles.google}`}
          loading={pending === "google"}
          onClick={() => void signInWithGoogle()}
        >
          <Image src="/google-g.png" alt="" width={20} height={20} unoptimized />
          Google
        </Button>
        <div className={styles.divider} aria-hidden="true">o</div>
        <Button
          ref={emailOptionRef}
          type="button"
          size="lg"
          className={styles.primary}
          disabled={pending !== null}
          onClick={openEmail}
        >
          Correo electrónico
        </Button>
      </div>
      <p className={styles.notice} role="status">{notice}</p>
      <AccessLegalLinks />
    </div>
  );
}
