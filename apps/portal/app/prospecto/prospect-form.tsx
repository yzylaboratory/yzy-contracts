"use client";

import { useEffect, useRef, useState } from "react";
import { AlertCircle, ArrowLeft, ArrowRight, CheckCircle2, Clock, Lock } from "lucide-react";
import { motion, useReducedMotion } from "motion/react";
import { Button } from "@/components/arc/button/button";
import { Input } from "@/components/arc/input/input";
import { Select } from "@/components/arc/select/select";
import { formatCedula } from "@/app/clientes/client-masks";
import ProspectoLoading from "./loading";
import {
  checkProspectLink,
  extractProspectTokenFromHash,
  submitProspectLink,
  type ProspectFormData,
} from "./prospect-api";
import styles from "./prospect-form.module.css";

type FormStatus = "checking" | "invalid" | "identity" | "form" | "success";

interface FormErrors {
  name?: string;
  phone?: string;
  email?: string;
  address?: string;
}

const EMPTY_FORM: ProspectFormData = {
  name: "",
  identity: "",
  phone: "",
  address: "",
};

function removeProspectFragment() {
  window.history.replaceState(window.history.state, "", window.location.pathname);
}

const MARITAL_STATUS_OPTIONS = [
  { value: "unspecified", label: "Prefiero no indicarlo" },
  { value: "Soltero(a)", label: "Soltero(a)" },
  { value: "Casado(a)", label: "Casado(a)" },
  { value: "Unión libre", label: "Unión libre" },
  { value: "Divorciado(a)", label: "Divorciado(a)" },
  { value: "Viudo(a)", label: "Viudo(a)" },
];

export function ProspectForm() {
  const reducedMotion = useReducedMotion();
  const [status, setStatus] = useState<FormStatus>("checking");
  const [validatingIdentity, setValidatingIdentity] = useState(false);
  const [identityError, setIdentityError] = useState("");
  const [step, setStep] = useState<1 | 2 | 3>(1);
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  const [formData, setFormData] = useState<ProspectFormData>(EMPTY_FORM);

  const [errors, setErrors] = useState<FormErrors>({});

  // Token is stored strictly in memory and never logged, reflected into URL, or persisted
  const tokenRef = useRef<string | null>(null);

  // Input refs for accessible focus management
  const nameInputRef = useRef<HTMLInputElement>(null);
  const identityInputRef = useRef<HTMLInputElement>(null);
  const phoneInputRef = useRef<HTMLInputElement>(null);
  const emailInputRef = useRef<HTMLInputElement>(null);
  const addressInputRef = useRef<HTMLInputElement>(null);
  const stepHeadingRef = useRef<HTMLHeadingElement>(null);
  const errorAlertRef = useRef<HTMLDivElement>(null);

  // Focus step heading on step change for screen readers
  useEffect(() => {
    if (status === "identity" || status === "form" || status === "success" || status === "invalid") {
      stepHeadingRef.current?.focus();
    }
  }, [step, status]);

  useEffect(() => {
    const token = extractProspectTokenFromHash(window.location.hash);
    tokenRef.current = token;
    const timer = setTimeout(() => setStatus(token ? "identity" : "invalid"), 0);
    return () => clearTimeout(timer);
  }, []);

  async function verifyIdentity(event: React.FormEvent) {
    event.preventDefault();
    const token = tokenRef.current;
    if (!token || validatingIdentity) return;
    if (formData.identity.replace(/-/g, "").length !== 11) {
      setIdentityError("Escribe los 11 dígitos de tu cédula.");
      identityInputRef.current?.focus();
      return;
    }
    setIdentityError("");
    setValidatingIdentity(true);
    try {
      const result = await checkProspectLink(token, formData.identity);
      if (result.kind === "valid") {
        setStatus("form");
      } else {
        setIdentityError(result.kind === "not_found"
          ? "No pudimos verificar el enlace con esa cédula. Revisa el número o pide un enlace nuevo."
          : "No pudimos conectar. Intenta de nuevo.");
      }
    } finally {
      setValidatingIdentity(false);
    }
  }

  const handleFieldChange = (field: keyof ProspectFormData, value: string) => {
    setFormData((prev) => ({ ...prev, [field]: value }));
    if (errors[field as keyof FormErrors]) {
      setErrors((prev) => ({ ...prev, [field]: undefined }));
    }
    if (submitError) {
      setSubmitError(null);
    }
  };

  const handleNextStep1 = (e: React.FormEvent) => {
    e.preventDefault();
    if (!formData.name.trim()) {
      setErrors({ name: "Por favor ingresa tu nombre completo." });
      nameInputRef.current?.focus();
      return;
    }
    setErrors({});

    setStep(2);
  };

  const handleNextStep2 = (e: React.FormEvent) => {
    e.preventDefault();
    const newErrors: FormErrors = {};
    let firstInvalid: "phone" | "address" | "email" | null = null;

    if (!formData.phone.trim()) {
      newErrors.phone = "Por favor ingresa un número de teléfono o celular.";
      firstInvalid = "phone";
    }
    if (formData.email?.trim() && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(formData.email.trim())) {
      newErrors.email = "Ingresa un correo electrónico válido o déjalo vacío.";
      if (!firstInvalid) firstInvalid = "email";
    }
    if (!formData.address.trim()) {
      newErrors.address = "Por favor ingresa tu dirección de residencia.";
      if (!firstInvalid) firstInvalid = "address";
    }

    setErrors(newErrors);

    if (firstInvalid) {
      if (firstInvalid === "phone") phoneInputRef.current?.focus();
      else if (firstInvalid === "email") emailInputRef.current?.focus();
      else addressInputRef.current?.focus();
      return;
    }

    setStep(3);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (submitting) return;
    if (!tokenRef.current) {
      setStatus("invalid");
      return;
    }

    setSubmitting(true);
    setSubmitError(null);

    const controller = new AbortController();
    try {
      const result = await submitProspectLink(tokenRef.current, formData, controller.signal);
      if (result.kind === "success") {
        tokenRef.current = null;
        removeProspectFragment();
        setFormData(EMPTY_FORM);
        setStatus("success");
      } else if (result.kind === "not_found") {
        tokenRef.current = null;
        removeProspectFragment();
        setFormData(EMPTY_FORM);
        setStatus("invalid");
      } else {
        setSubmitError(result.message);
        setTimeout(() => {
          errorAlertRef.current?.focus();
        }, 50);
      }
    } catch {
      setSubmitError("No pudimos enviar tus datos por un problema de red. Por favor intenta de nuevo.");
      setTimeout(() => {
        errorAlertRef.current?.focus();
      }, 50);
    } finally {
      setSubmitting(false);
    }
  };

  if (status === "checking") return <ProspectoLoading />;

  // State: Invalid / Expired / Already Used Link
  if (status === "invalid") {
    return (
      <section className={styles.mainCard} role="region" aria-label="Enlace no disponible">
        <div className={styles.statusCard}>
          <div className={`${styles.statusIconWrapper} ${styles.statusIconWarning}`}>
            <Clock className={styles.statusIcon} aria-hidden="true" size={32} />
          </div>
          <h2 ref={stepHeadingRef} tabIndex={-1} className={styles.statusTitle}>Este enlace ya no está disponible</h2>
          <p className={styles.statusMessage}>
            Los enlaces duran 24 horas y se desactivan después del primer envío.
          </p>
          <p className={styles.statusMessage}>
            Pide un nuevo enlace a la persona que te contactó.
          </p>
        </div>
      </section>
    );
  }

  if (status === "identity") {
    return (
      <section className={styles.mainCard} aria-labelledby="prospect-identity-title">
        <div className={styles.stepIntro}>
          <h2 id="prospect-identity-title" ref={stepHeadingRef} tabIndex={-1} className={styles.stepHeading}>
            Confirma tu cédula
          </h2>
          <p className={styles.stepSubheading}>Escribe la cédula que le diste a la persona que te envió el enlace.</p>
        </div>
        <form className={styles.fieldsContainer} onSubmit={verifyIdentity} noValidate>
          <Input ref={identityInputRef} name="identity" label="Número de cédula" inputMode="numeric"
            autoComplete="off" value={formData.identity} required error={identityError}
            readOnly={validatingIdentity} onChange={event => {
              setFormData(previous => ({ ...previous, identity: formatCedula(event.target.value) }));
              setIdentityError("");
            }} />
          <Button type="submit" loading={validatingIdentity} disabled={validatingIdentity}>Continuar</Button>
        </form>
      </section>
    );
  }

  // State: Success Confirmation
  if (status === "success") {
    return (
      <section className={styles.mainCard} role="region" aria-label="Confirmación de envío">
        <div className={styles.statusCard}>
          <div className={`${styles.statusIconWrapper} ${styles.statusIconSuccess}`}>
            <CheckCircle2 className={styles.statusIcon} aria-hidden="true" size={36} />
          </div>
          <h2 ref={stepHeadingRef} tabIndex={-1} className={styles.statusTitle}>Recibimos tus datos</h2>
          <p className={styles.statusMessage}>
            Gracias. El equipo revisará tu información antes de continuar. Ya puedes cerrar esta página.
          </p>
        </div>
      </section>
    );
  }

  // State: Form (Steps 1, 2, 3)
  return (
    <motion.section
      initial={reducedMotion ? false : { opacity: 0.65, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={reducedMotion ? { duration: 0 } : { duration: 0.32, ease: [0.22, 1, 0.36, 1] }}
      className={styles.mainCard}
      id="formulario-prospecto"
      aria-label="Formulario de datos personales"
    >
      {/* Real Progress Indicator */}
      <nav aria-label="Progreso del formulario" className={styles.progressSection}>
        <div className={styles.progressHeader}>
          <span>Paso {step} de 3</span>
          <span aria-hidden="true">
            {step === 1 && "Identidad"}
            {step === 2 && "Contacto"}
            {step === 3 && "Confirmación"}
          </span>
        </div>

        <ol className={styles.stepIndicatorList}>
          <li className={styles.stepIndicatorItem}>
            <div
              className={`${styles.stepBar} ${
                step === 1 ? styles.stepBarActive : styles.stepBarCompleted
              }`}
            />
            <span
              className={`${styles.stepTitle} ${step === 1 ? styles.stepTitleActive : ""}`}
              aria-current={step === 1 ? "step" : undefined}
            >
              1. Identidad
            </span>
          </li>
          <li className={styles.stepIndicatorItem}>
            <div
              className={`${styles.stepBar} ${
                step === 2
                  ? styles.stepBarActive
                  : step > 2
                  ? styles.stepBarCompleted
                  : ""
              }`}
            />
            <span
              className={`${styles.stepTitle} ${step === 2 ? styles.stepTitleActive : ""}`}
              aria-current={step === 2 ? "step" : undefined}
            >
              2. Contacto
            </span>
          </li>
          <li className={styles.stepIndicatorItem}>
            <div
              className={`${styles.stepBar} ${
                step === 3 ? styles.stepBarActive : ""
              }`}
            />
            <span
              className={`${styles.stepTitle} ${step === 3 ? styles.stepTitleActive : ""}`}
              aria-current={step === 3 ? "step" : undefined}
            >
              3. Revisión
            </span>
          </li>
        </ol>
      </nav>

      {/* Step 1: Datos personales */}
      {step === 1 && (
        <form onSubmit={handleNextStep1} noValidate>
          <div className={styles.stepIntro}>
            <h2
              ref={stepHeadingRef}
              tabIndex={-1}
              className={styles.stepHeading}
            >
              Datos personales
            </h2>
            <p className={styles.stepSubheading}>
              Ingresa tu nombre tal como aparece en tu cédula.
            </p>
          </div>

          <div className={styles.fieldsContainer} style={{ marginTop: "1.25rem" }}>
            <Input
              ref={nameInputRef}
              id="prospect-name"
              name="name"
              maxLength={200}
              label="Nombre completo"
              placeholder="Ej. Juan Pérez Santana"
              required
              value={formData.name}
              error={errors.name}
              onChange={(e) => handleFieldChange("name", e.target.value)}
              autoComplete="name"
            />

            <Input
              ref={identityInputRef}
              id="prospect-identity"
              name="identity"
              maxLength={64}
              label="Cédula verificada"
              readOnly
              required
              value={formData.identity}
            />

            <Input
              id="prospect-nationality"
              name="nationality"
              maxLength={120}
              label="Nacionalidad (opcional)"
              placeholder="Ej. Dominicana"
              value={formData.nationality ?? ""}
              onChange={(e) => handleFieldChange("nationality", e.target.value)}
              autoComplete="country-name"
            />
          </div>

          <div className={styles.actionsRow}>
            <div className={styles.primaryButtonWrapper}>
              <Button type="submit" variant="primary" size="md" style={{ width: "100%" }}>
                Continuar a contacto
                <ArrowRight size={16} aria-hidden="true" style={{ marginLeft: 6 }} />
              </Button>
            </div>
          </div>
        </form>
      )}

      {/* Step 2: Contacto y dirección */}
      {step === 2 && (
        <form onSubmit={handleNextStep2} noValidate>
          <div className={styles.stepIntro}>
            <h2
              ref={stepHeadingRef}
              tabIndex={-1}
              className={styles.stepHeading}
            >
              Contacto y ubicación
            </h2>
            <p className={styles.stepSubheading}>
              Indícanos cómo contactarte y dónde vives.
            </p>
          </div>

          <div className={styles.fieldsContainer} style={{ marginTop: "1.25rem" }}>
            <Input
              ref={phoneInputRef}
              id="prospect-phone"
              name="phone"
              maxLength={80}
              type="tel"
              label="Teléfono o celular"
              placeholder="Ej. 809-555-0123"
              required
              value={formData.phone}
              error={errors.phone}
              onChange={(e) => handleFieldChange("phone", e.target.value)}
              autoComplete="tel"
            />

            <Input
              ref={emailInputRef}
              id="prospect-email"
              name="email"
              maxLength={254}
              type="email"
              label="Correo electrónico (opcional)"
              placeholder="ejemplo@correo.com"
              value={formData.email ?? ""}
              error={errors.email}
              onChange={(e) => handleFieldChange("email", e.target.value)}
              autoComplete="email"
            />

            <Input
              ref={addressInputRef}
              id="prospect-address"
              name="address"
              maxLength={1000}
              label="Dirección de residencia"
              placeholder="Calle, número, sector y ciudad"
              required
              value={formData.address}
              error={errors.address}
              onChange={(e) => handleFieldChange("address", e.target.value)}
              autoComplete="street-address"
            />
          </div>

          <div className={styles.actionsRow}>
            <Button
              type="button"
              variant="secondary"
              size="md"
              onClick={() => setStep(1)}
            >
              <ArrowLeft size={16} aria-hidden="true" style={{ marginRight: 6 }} />
              Atrás
            </Button>
            <div className={styles.primaryButtonWrapper}>
              <Button type="submit" variant="primary" size="md" style={{ width: "100%" }}>
                Continuar a revisión
                <ArrowRight size={16} aria-hidden="true" style={{ marginLeft: 6 }} />
              </Button>
            </div>
          </div>
        </form>
      )}

      {/* Step 3: Ocupación, revisión y confirmación */}
      {step === 3 && (
        <form onSubmit={handleSubmit} noValidate>
          <div className={styles.stepIntro}>
            <h2
              ref={stepHeadingRef}
              tabIndex={-1}
              className={styles.stepHeading}
            >
              Revisa tus datos
            </h2>
            <p className={styles.stepSubheading}>
              Confirma que los datos están correctos antes de enviarlos.
            </p>
          </div>

          <div className={styles.fieldsContainer} style={{ marginTop: "1.25rem" }}>
            <Select
              id="prospect-marital-status"
              label="Estado civil (opcional)"
              placeholder="Selecciona una opción"
              value={formData.marital_status || "unspecified"}
              onValueChange={(val) => handleFieldChange("marital_status", val === "unspecified" ? "" : val)}
              options={MARITAL_STATUS_OPTIONS}
            />

            <Input
              id="prospect-position"
              name="position"
              maxLength={200}
              label="Ocupación o profesión (opcional)"
              placeholder="Ej. Ingeniero, Comerciante, Docente"
              value={formData.position ?? ""}
              onChange={(e) => handleFieldChange("position", e.target.value)}
            />

            {/* Review summary box */}
            <div className={styles.reviewBox}>
              <div className={styles.reviewTitle}>
                <span>Resumen de tus datos</span>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  disabled={submitting}
                  onClick={() => setStep(1)}
                >
                  Editar
                </Button>
              </div>

              <div className={styles.reviewList}>
                <div className={styles.reviewItem}>
                  <span className={styles.reviewLabel}>Nombre:</span>
                  <span className={styles.reviewValue}>{formData.name}</span>
                </div>
                <div className={styles.reviewItem}>
                  <span className={styles.reviewLabel}>Documento:</span>
                  <span className={styles.reviewValue}>{formData.identity}</span>
                </div>
                <div className={styles.reviewItem}>
                  <span className={styles.reviewLabel}>Teléfono:</span>
                  <span className={styles.reviewValue}>{formData.phone}</span>
                </div>
                {formData.email?.trim() ? (
                  <div className={styles.reviewItem}>
                    <span className={styles.reviewLabel}>Correo:</span>
                    <span className={styles.reviewValue}>{formData.email.trim()}</span>
                  </div>
                ) : null}
                <div className={styles.reviewItemFull}>
                  <span className={styles.reviewLabel}>Dirección:</span>
                  <span className={styles.reviewValue}>{formData.address}</span>
                </div>
                {formData.nationality?.trim() ? (
                  <div className={styles.reviewItem}>
                    <span className={styles.reviewLabel}>Nacionalidad:</span>
                    <span className={styles.reviewValue}>{formData.nationality.trim()}</span>
                  </div>
                ) : null}
                {formData.marital_status?.trim() ? (
                  <div className={styles.reviewItem}>
                    <span className={styles.reviewLabel}>Estado civil:</span>
                    <span className={styles.reviewValue}>{formData.marital_status.trim()}</span>
                  </div>
                ) : null}
                {formData.position?.trim() ? (
                  <div className={styles.reviewItem}>
                    <span className={styles.reviewLabel}>Ocupación:</span>
                    <span className={styles.reviewValue}>{formData.position.trim()}</span>
                  </div>
                ) : null}
              </div>
            </div>

            {/* Security and 24h expiration badge */}
            <div className={styles.noticeBadge}>
              <Lock className={styles.noticeIcon} aria-hidden="true" />
              <span>
                El enlace se desactiva cuando envías tus datos.
              </span>
            </div>

            {/* Submit error alert with retry */}
            {submitError && (
              <div
                ref={errorAlertRef}
                tabIndex={-1}
                className={styles.alertBox}
                role="alert"
              >
                <AlertCircle className={styles.alertIcon} aria-hidden="true" />
                <div>
                  <strong>No pudimos enviar la información.</strong>
                  <div>{submitError}</div>
                </div>
              </div>
            )}
          </div>

          <div className={styles.actionsRow}>
            <Button
              type="button"
              variant="secondary"
              size="md"
              disabled={submitting}
              onClick={() => setStep(2)}
            >
              <ArrowLeft size={16} aria-hidden="true" style={{ marginRight: 6 }} />
              Atrás
            </Button>
            <div className={styles.primaryButtonWrapper}>
              <Button
                type="submit"
                variant="primary"
                size="md"
                loading={submitting}
                disabled={submitting}
                style={{ width: "100%" }}
              >
                Enviar datos
                <CheckCircle2 size={16} aria-hidden="true" style={{ marginLeft: 6 }} />
              </Button>
            </div>
          </div>
        </form>
      )}
    </motion.section>
  );
}
