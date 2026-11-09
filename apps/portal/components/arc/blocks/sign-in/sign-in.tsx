"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import { ChevronLeft } from "lucide-react";
import { useRouter } from "next/navigation";
import { Button } from "../../button/button";
import { Input } from "../../input/input";
import { OtpInput } from "../../otp-input/otp-input";
import styles from "./sign-in.module.css";

type Step = "options" | "email" | "code";

const RESET_DELAY = 45;
const CODE_LENGTH = 6;

export function SignIn({ demoCode = "123456" }: { demoCode?: string }) {
  const router = useRouter();
  const [step, setStep] = useState<Step>("options");
  const [email, setEmail] = useState("");
  const [emailError, setEmailError] = useState("");
  const [code, setCode] = useState("");
  const [codeError, setCodeError] = useState("");
  const [resetIn, setResetIn] = useState(RESET_DELAY);
  const [notice, setNotice] = useState("");
  const emailRef = useRef<HTMLInputElement>(null);
  const codeRef = useRef<HTMLDivElement>(null);
  const emailOptionRef = useRef<HTMLButtonElement>(null);
  const returningToOptions = useRef(false);

  useEffect(() => {
    if (step === "email") emailRef.current?.focus();
    if (step === "options" && returningToOptions.current) {
      returningToOptions.current = false;
      emailOptionRef.current?.focus();
    }
  }, [step]);

  useEffect(() => {
    if (step !== "code" || resetIn <= 0) return;
    const timer = window.setTimeout(() => setResetIn(seconds => seconds - 1), 1000);
    return () => window.clearTimeout(timer);
  }, [step, resetIn]);

  function openEmail() {
    setNotice("");
    setEmailError("");
    setStep("email");
  }

  function openOptions() {
    returningToOptions.current = true;
    setNotice("");
    setStep("options");
  }

  function submitEmail(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const address = email.trim();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(address)) {
      setEmailError(address ? "Escribe un correo válido, como nombre@ejemplo.test." : "Escribe tu correo electrónico.");
      emailRef.current?.focus();
      return;
    }

    setEmail(address);
    setCode("");
    setCodeError("");
    setResetIn(RESET_DELAY);
    setNotice("");
    setStep("code");
  }

  function verifyCode(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (code.length !== CODE_LENGTH) {
      setCodeError("Introduce los seis dígitos.");
      codeRef.current?.querySelectorAll("input")[code.length]?.focus();
      return;
    }
    if (code !== demoCode) {
      setCode("");
      setCodeError("El código no coincide. Escribe el código de prueba indicado.");
      codeRef.current?.querySelector("input")?.focus();
      return;
    }

    router.push("/dashboard");
  }

  function resetCode() {
    if (resetIn > 0) return;
    setCode("");
    setCodeError("");
    setResetIn(RESET_DELAY);
    setNotice("Código de prueba reiniciado.");
    codeRef.current?.querySelector("input")?.focus();
  }

  return (
    <div className={styles.signIn}>
      {step === "options" && (
        <>
          <div className={styles.heading}>
            <h1>Accede a tu espacio</h1>
            <p>Elige cómo quieres acceder a YZY Contracts.</p>
          </div>
          <div className={`${styles.card} ${styles.options}`} role="group" aria-label="Métodos de acceso">
            <p className={styles.cardTitle}>Acceder con</p>
            <Button type="button" variant="secondary" size="lg" className={styles.provider} onClick={() => router.push("/dashboard")}>Google</Button>
            <Button type="button" variant="secondary" size="lg" className={styles.provider} onClick={() => setNotice("El acceso con Apple requiere integración.")}>Apple</Button>
            <div className={styles.divider} aria-hidden="true">o</div>
            <Button ref={emailOptionRef} type="button" size="lg" className={styles.primary} onClick={openEmail}>Correo electrónico</Button>
          </div>
        </>
      )}

      {step === "email" && (
        <>
          <Button type="button" variant="ghost" className={styles.back} onClick={openOptions}>
            <ChevronLeft size={18} aria-hidden="true" />Volver
          </Button>
          <div className={styles.heading}>
            <h1>Ingresa con tu correo</h1>
            <p>Escribe tu correo para continuar con un código de seis dígitos.</p>
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
              value={email}
              error={emailError}
              onChange={event => {
                setEmail(event.target.value);
                setEmailError("");
              }}
            />
            <Button type="submit" size="lg" className={styles.primary}>Continuar</Button>
          </form>
          <p className={styles.hint}>El código de prueba aparece en la pantalla siguiente.</p>
        </>
      )}

      {step === "code" && (
        <>
          <Button type="button" variant="ghost" className={styles.back} onClick={openEmail}>
            <ChevronLeft size={18} aria-hidden="true" />Cambiar correo
          </Button>
          <div className={styles.heading}>
            <h1>Código de verificación</h1>
            <p>Completa la prueba de acceso para <strong>{email}</strong>.</p>
          </div>
          <form className={styles.card} onSubmit={verifyCode} noValidate>
            <div ref={codeRef}>
              <OtpInput
                label="Código de verificación"
                length={CODE_LENGTH}
                className={styles.otp}
                value={code}
                onChange={value => {
                  setCode(value);
                  setCodeError("");
                }}
                error={codeError}
                autoFocus
              />
            </div>
            <div className={styles.codeInfo}>
              <span>Código de prueba <strong className={styles.digits}>{demoCode}</strong></span>
              <Button type="button" variant="ghost" className={styles.reset} aria-disabled={resetIn > 0 || undefined} onClick={resetCode}>
                {resetIn > 0 ? <>Reiniciar en <span className={styles.digits}>0:{String(resetIn).padStart(2, "0")}</span></> : "Reiniciar código"}
              </Button>
            </div>
            <Button type="submit" size="lg" className={styles.primary}>Verificar y entrar</Button>
          </form>
        </>
      )}

      <p className={styles.notice} role="status">{notice}</p>
    </div>
  );
}
