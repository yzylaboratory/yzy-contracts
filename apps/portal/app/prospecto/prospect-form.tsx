"use client";

import { useEffect, useRef, useState } from "react";
import {
  AlertCircle,
  ArrowLeft,
  ArrowRight,
  Briefcase,
  Building2,
  CheckCircle2,
  Clock,
  FileText,
  HeartHandshake,
  Lock,
  UserCheck,
  Users,
} from "lucide-react";
import { motion, useReducedMotion } from "motion/react";
import { Button } from "@/components/arc/button/button";
import { Input } from "@/components/arc/input/input";
import { Select } from "@/components/arc/select/select";
import { formatCedula, formatPhone, handleMaskedBackspace } from "@/app/clientes/client-masks";
import { MoneyField } from "@/app/contratos/money-field";
import { familyRelationships, personalRelationships, type ClientProfile } from "@/components/case-application/case-application";
import ProspectoLoading from "./loading";
import {
  checkProspectLink,
  extractProspectTokenFromHash,
  submitProspectLink,
  type ProspectFormData,
} from "./prospect-api";
import styles from "./prospect-form.module.css";

type FormStatus = "checking" | "invalid" | "identity" | "form" | "success";
type StepNumber = 1 | 2 | 3 | 4 | 5 | 6;

interface FormErrors {
  [key: string]: string | undefined;
}

const STEPS = [
  { id: 1 as StepNumber, title: "Identidad", label: "1. Identidad" },
  { id: 2 as StepNumber, title: "Contacto", label: "2. Contacto" },
  { id: 3 as StepNumber, title: "Ingresos", label: "3. Ingresos" },
  { id: 4 as StepNumber, title: "Cónyuge", label: "4. Cónyuge" },
  { id: 5 as StepNumber, title: "Referencias", label: "5. Referencias" },
  { id: 6 as StepNumber, title: "Revisión", label: "6. Revisión" },
] as const;

const TREATMENT_OPTIONS = [
  { value: "Sr.", label: "Sr." },
  { value: "Sra.", label: "Sra." },
  { value: "Srta.", label: "Srta." },
];

const MARITAL_STATUS_OPTIONS = [
  { value: "Soltero(a)", label: "Soltero(a)" },
  { value: "Casado(a)", label: "Casado(a)" },
  { value: "Unión libre", label: "Unión libre" },
  { value: "Divorciado(a)", label: "Divorciado(a)" },
  { value: "Viudo(a)", label: "Viudo(a)" },
];

const INCOME_SOURCE_OPTIONS = [
  { value: "Empleado privado", label: "Empleado/a privado" },
  { value: "Empleado público", label: "Empleado/a público" },
  { value: "Negocio propio / Independiente", label: "Negocio propio / Independiente" },
  { value: "Servicios profesionales", label: "Servicios profesionales" },
  { value: "Remesas del exterior", label: "Remesas del exterior" },
  { value: "Rentas / Inversiones", label: "Rentas / Inversiones" },
  { value: "Otro", label: "Otro origen de ingresos" },
];

const FAMILY_OPTIONS = familyRelationships.map((r) => ({ value: r.toLocaleUpperCase("es"), label: r }));
const PERSONAL_OPTIONS = personalRelationships.map((r) => ({ value: r.toLocaleUpperCase("es"), label: r }));

function createEmptyForm(): ProspectFormData {
  return {
    name: "",
    identity: "",
    phone: "",
    address: "",
    email: "",
    treatment: "",
    nationality: "",
    marital_status: "",
    position: "",
    income_source: "",
    profile: {
      treatment: "",
      nationality: "",
      marital_status: "",
      owns_home: null,
      rents_home: null,
      owns_vehicle: null,
      employer: "",
      work_address: "",
      work_phone: "",
      position: "",
      employment_duration: "",
      fixed_income: "",
      other_income: "",
      other_income_source: "",
      pay_days: "",
      spouse_not_applicable: false,
      spouse: null,
      family_references: [
        { name: "", relationship: "", phone: "", address: "" },
        { name: "", relationship: "", phone: "", address: "" },
        { name: "", relationship: "", phone: "", address: "" },
      ],
      personal_references: [
        { name: "", relationship: "", phone: "" },
        { name: "", relationship: "", phone: "" },
      ],
    },
  };
}

function removeProspectFragment() {
  if (typeof window !== "undefined") {
    window.history.replaceState(window.history.state, "", window.location.pathname);
  }
}

export function ProspectForm() {
  const reducedMotion = useReducedMotion();
  const [status, setStatus] = useState<FormStatus>("checking");
  const [validatingIdentity, setValidatingIdentity] = useState(false);
  const [identityError, setIdentityError] = useState("");
  const [step, setStep] = useState<StepNumber>(1);
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  const [formData, setFormData] = useState<ProspectFormData>(createEmptyForm);
  const [errors, setErrors] = useState<FormErrors>({});

  // Toggles locales para agilizar el llenado de "No aplica"
  const [noFormalEmployment, setNoFormalEmployment] = useState(false);
  const [noOtherIncome, setNoOtherIncome] = useState(false);

  // El token vive estrictamente en memoria y no se expone ni persiste
  const tokenRef = useRef<string | null>(null);

  // Focus management accesible
  const stepHeadingRef = useRef<HTMLHeadingElement>(null);
  const errorAlertRef = useRef<HTMLDivElement>(null);
  const identityInputRef = useRef<HTMLInputElement>(null);
  const firstInputRef = useRef<HTMLInputElement>(null);

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

  const handleFieldChange = (field: keyof ProspectFormData, value: unknown) => {
    setFormData((prev) => ({ ...prev, [field]: value }));
    if (errors[field as string]) {
      setErrors((prev) => ({ ...prev, [field as string]: undefined }));
    }
    if (submitError) setSubmitError(null);
  };

  const handleProfileChange = <K extends keyof ClientProfile>(field: K, value: ClientProfile[K]) => {
    setFormData((prev) => {
      const updatedProfile = { ...prev.profile, [field]: value };
      if (field === "owns_home") {
        updatedProfile.rents_home = typeof value === "boolean" ? !value : null;
      }
      return {
        ...prev,
        profile: updatedProfile,
      };
    });
    if (errors[field as string]) {
      setErrors((prev) => ({ ...prev, [field as string]: undefined }));
    }
  };

  const handleMaritalStatusChange = (val: string) => {
    const isUnmarried = val === "Soltero(a)" || val === "Divorciado(a)" || val === "Viudo(a)";
    setFormData((prev) => ({
      ...prev,
      marital_status: val,
      profile: {
        ...prev.profile,
        marital_status: val,
        spouse_not_applicable: isUnmarried,
        spouse: isUnmarried
          ? null
          : prev.profile.spouse ?? {
              name: "",
              identity: "",
              phone: "",
              employer: "",
              employment_duration: "",
              position: "",
              address: "",
              work_phone: "",
            },
      },
    }));
  };

  const handleToggleNoFormalEmployment = (checked: boolean) => {
    setNoFormalEmployment(checked);
    setFormData((prev) => ({
      ...prev,
      profile: {
        ...prev.profile,
        employer: checked ? "No aplica" : "",
        work_address: checked ? "No aplica" : "",
        work_phone: checked ? "No aplica" : "",
        position: checked ? (prev.position || "Independiente") : "",
        employment_duration: checked ? "No aplica" : "",
      },
      position: checked ? (prev.position || "Independiente") : prev.position,
    }));
  };

  const handleToggleNoOtherIncome = (checked: boolean) => {
    setNoOtherIncome(checked);
    setFormData((prev) => ({
      ...prev,
      profile: {
        ...prev.profile,
        other_income: checked ? "RD$0.00" : "",
        other_income_source: checked ? "No aplica" : "",
      },
    }));
  };

  const handleSpouseChange = (field: string, value: string) => {
    setFormData((prev) => ({
      ...prev,
      profile: {
        ...prev.profile,
        spouse: {
          ...prev.profile.spouse,
          [field]: value,
        },
      },
    }));
    if (errors[`spouse_${field}`]) {
      setErrors((prev) => ({ ...prev, [`spouse_${field}`]: undefined }));
    }
  };

  const handleFamilyReferenceChange = (index: number, field: string, value: string) => {
    setFormData((prev) => {
      const nextRefs = [...(prev.profile.family_references ?? [])];
      nextRefs[index] = { ...nextRefs[index], [field]: value };
      return {
        ...prev,
        profile: { ...prev.profile, family_references: nextRefs },
      };
    });
    if (errors[`family_${index}_${field}`]) {
      setErrors((prev) => ({ ...prev, [`family_${index}_${field}`]: undefined }));
    }
  };

  const handlePersonalReferenceChange = (index: number, field: string, value: string) => {
    setFormData((prev) => {
      const nextRefs = [...(prev.profile.personal_references ?? [])];
      nextRefs[index] = { ...nextRefs[index], [field]: value };
      return {
        ...prev,
        profile: { ...prev.profile, personal_references: nextRefs },
      };
    });
    if (errors[`personal_${index}_${field}`]) {
      setErrors((prev) => ({ ...prev, [`personal_${index}_${field}`]: undefined }));
    }
  };

  // Validaciones por paso
  const handleNextStep1 = (e: React.FormEvent) => {
    e.preventDefault();
    const newErrors: FormErrors = {};
    if (!formData.name.trim()) newErrors.name = "Por favor ingresa tu nombre completo.";
    if (!formData.treatment?.trim()) newErrors.treatment = "Selecciona cómo prefieres que te tratemos.";
    if (!formData.nationality?.trim()) newErrors.nationality = "Por favor indica tu nacionalidad.";
    if (!formData.marital_status?.trim()) newErrors.marital_status = "Selecciona tu estado civil.";

    if (Object.keys(newErrors).length > 0) {
      setErrors(newErrors);
      return;
    }
    setErrors({});
    setStep(2);
  };

  const handleNextStep2 = (e: React.FormEvent) => {
    e.preventDefault();
    const newErrors: FormErrors = {};
    if (!formData.phone.trim()) {
      newErrors.phone = "Por favor ingresa tu número de teléfono o celular.";
    }
    if (!formData.email?.trim()) {
      newErrors.email = "El correo electrónico es requerido para la ficha del cliente.";
    } else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(formData.email.trim())) {
      newErrors.email = "Ingresa un correo electrónico válido.";
    }
    if (!formData.address.trim()) {
      newErrors.address = "Por favor ingresa tu dirección de residencia.";
    }
    if (typeof formData.profile.owns_home !== "boolean") {
      newErrors.owns_home = "Indica si vives en casa propia.";
    }
    if (typeof formData.profile.owns_vehicle !== "boolean") {
      newErrors.owns_vehicle = "Indica si posees vehículo propio.";
    }

    if (Object.keys(newErrors).length > 0) {
      setErrors(newErrors);
      return;
    }
    setErrors({});
    setStep(3);
  };

  const handleNextStep3 = (e: React.FormEvent) => {
    e.preventDefault();
    const newErrors: FormErrors = {};
    if (!formData.income_source.trim()) newErrors.income_source = "Selecciona el origen de tus ingresos.";

    const p = formData.profile;
    if (!noFormalEmployment) {
      if (!p.employer?.trim()) newErrors.employer = "Indica dónde trabajas o el nombre de tu empresa.";
      if (!p.position?.trim()) newErrors.position = "Indica tu cargo u ocupación.";
      if (!p.employment_duration?.trim()) newErrors.employment_duration = "Indica el tiempo que llevas laborando.";
      if (!p.work_address?.trim()) newErrors.work_address = "Indica la dirección de tu trabajo.";
      if (!p.work_phone?.trim()) newErrors.work_phone = "Indica el teléfono de tu trabajo.";
    } else {
      if (!p.position?.trim()) newErrors.position = "Indica tu actividad u ocupación independiente.";
    }

    if (!p.fixed_income?.trim()) {
      newErrors.fixed_income = "Por favor ingresa tu sueldo o ingresos fijos mensuales.";
    }

    if (!noOtherIncome) {
      if (!p.other_income?.trim()) newErrors.other_income = "Indica el monto aproximado de otros ingresos.";
      if (!p.other_income_source?.trim()) newErrors.other_income_source = "Indica el concepto de tus otros ingresos.";
    }

    if (!p.pay_days?.trim()) newErrors.pay_days = "Indica tus días o periodicidad de cobro (ej. 15 y 30).";

    if (Object.keys(newErrors).length > 0) {
      setErrors(newErrors);
      return;
    }
    setErrors({});
    setStep(4);
  };

  const handleNextStep4 = (e: React.FormEvent) => {
    e.preventDefault();
    const newErrors: FormErrors = {};
    const notApp = formData.profile.spouse_not_applicable;
    if (!notApp) {
      const s = formData.profile.spouse ?? {};
      if (!s.name?.trim()) newErrors.spouse_name = "Indica el nombre de tu cónyuge.";
      if (!s.identity?.trim()) newErrors.spouse_identity = "Indica la cédula de tu cónyuge.";
      if (!s.phone?.trim()) newErrors.spouse_phone = "Indica el teléfono de tu cónyuge.";
      if (!s.employer?.trim()) newErrors.spouse_employer = "Indica dónde trabaja tu cónyuge o «No aplica».";
      if (!s.position?.trim()) newErrors.spouse_position = "Indica el cargo de tu cónyuge o «No aplica».";
      if (!s.employment_duration?.trim()) newErrors.spouse_employment_duration = "Indica el tiempo trabajando o «No aplica».";
      if (!s.address?.trim()) newErrors.spouse_address = "Indica la dirección del cónyuge.";
      if (!s.work_phone?.trim()) newErrors.spouse_work_phone = "Indica el teléfono de trabajo o «No aplica».";
    }

    if (Object.keys(newErrors).length > 0) {
      setErrors(newErrors);
      return;
    }
    setErrors({});
    setStep(5);
  };

  const handleNextStep5 = (e: React.FormEvent) => {
    e.preventDefault();
    const newErrors: FormErrors = {};
    const familyRefs = formData.profile.family_references ?? [];
    for (let i = 0; i < 3; i++) {
      const ref = familyRefs[i] ?? {};
      if (!ref.name?.trim()) newErrors[`family_${i}_name`] = `Nombre requerido para referencia familiar ${i + 1}.`;
      if (!ref.relationship?.trim()) newErrors[`family_${i}_relationship`] = `Parentesco requerido.`;
      if (!ref.phone?.trim()) newErrors[`family_${i}_phone`] = `Teléfono requerido.`;
      if (!ref.address?.trim()) newErrors[`family_${i}_address`] = `Dirección requerida.`;
    }

    const personalRefs = formData.profile.personal_references ?? [];
    for (let i = 0; i < 2; i++) {
      const ref = personalRefs[i] ?? {};
      if (!ref.name?.trim()) newErrors[`personal_${i}_name`] = `Nombre requerido para referencia personal ${i + 1}.`;
      if (!ref.relationship?.trim()) newErrors[`personal_${i}_relationship`] = `Relación requerida.`;
      if (!ref.phone?.trim()) newErrors[`personal_${i}_phone`] = `Teléfono requerido.`;
    }

    if (Object.keys(newErrors).length > 0) {
      setErrors(newErrors);
      return;
    }
    setErrors({});
    setStep(6);
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
        setFormData(createEmptyForm());
        setStatus("success");
      } else if (result.kind === "not_found") {
        tokenRef.current = null;
        removeProspectFragment();
        setStatus("invalid");
      } else {
        setSubmitError(result.message);
        setTimeout(() => errorAlertRef.current?.focus(), 50);
      }
    } catch {
      setSubmitError("No pudimos enviar tus datos por un problema de red. Por favor intenta de nuevo.");
      setTimeout(() => errorAlertRef.current?.focus(), 50);
    } finally {
      setSubmitting(false);
    }
  };

  if (status === "checking") return <ProspectoLoading />;

  if (status === "invalid") {
    return (
      <section className={styles.mainCard} role="region" aria-label="Enlace no disponible">
        <div className={styles.statusCard}>
          <div className={`${styles.statusIconWrapper} ${styles.statusIconWarning}`}>
            <Clock className={styles.statusIcon} aria-hidden="true" size={32} />
          </div>
          <h2 ref={stepHeadingRef} tabIndex={-1} className={styles.statusTitle}>
            Este enlace ya no está disponible
          </h2>
          <p className={styles.statusMessage}>
            Los enlaces duran 24 horas y se desactivan automáticamente después del primer envío.
          </p>
          <p className={styles.statusMessage}>
            Solicita un nuevo enlace seguro a la persona de YZY Contracts que te contactó.
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

  if (submitting) {
    return (
      <section className={`${styles.mainCard} ${styles.sendingCard}`} aria-label="Envío de la ficha">
        <div className={styles.statusCard} role="status">
          <motion.div
            className={styles.sendingIllustration}
            aria-hidden="true"
            initial={reducedMotion ? false : { opacity: 0, scale: 0.85 }}
            animate={{ opacity: 1, scale: 1 }}
            transition={{ duration: reducedMotion ? 0 : 0.28 }}
          >
            <FileText size={36} />
            <span className={styles.sendingLock}><Lock size={15} /></span>
          </motion.div>
          <h2 className={styles.statusTitle}>Enviando tu información</h2>
          <p className={styles.statusMessage}>Estamos enviando tu ficha al equipo por una conexión cifrada.</p>
          <div className={styles.sendingProgress} aria-hidden="true" />
        </div>
      </section>
    );
  }

  if (status === "success") {
    return (
      <motion.section
        className={styles.mainCard}
        aria-label="Confirmación de envío"
        initial={reducedMotion ? false : { opacity: 0.6, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: reducedMotion ? 0 : 0.28 }}
      >
        <div className={styles.statusCard}>
          <div className={`${styles.statusIconWrapper} ${styles.statusIconSuccess}`}>
            <CheckCircle2 className={styles.statusIcon} aria-hidden="true" size={36} />
          </div>
          <h2 ref={stepHeadingRef} tabIndex={-1} className={styles.statusTitle}>
            ¡Recibimos tus datos con éxito!
          </h2>
          <p className={styles.statusMessage}>
            Gracias por completar tu información. El equipo de YZY Contracts revisará tu ficha para continuar con tu proceso.
          </p>
          <p className={styles.statusMessage}>
            Por seguridad, este enlace ha sido desactivado. Ya puedes cerrar esta ventana.
          </p>
        </div>
      </motion.section>
    );
  }

  return (
    <motion.section
      initial={reducedMotion ? false : { opacity: 0.65, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={reducedMotion ? { duration: 0 } : { duration: 0.32, ease: [0.22, 1, 0.36, 1] }}
      className={styles.mainCard}
      id="formulario-prospecto"
      aria-label="Formulario de ficha de prospecto"
    >
      {/* Barra de progreso de etapas cortas */}
      <nav aria-label="Progreso del formulario" className={styles.progressSection}>
        <div className={styles.progressHeader}>
          <span>Paso {step} de 6</span>
          <span aria-hidden="true">{STEPS[step - 1].title}</span>
        </div>

        <ol className={styles.stepIndicatorList}>
          {STEPS.map((s) => (
            <li key={s.id} className={styles.stepIndicatorItem}>
              <div
                className={`${styles.stepBar} ${
                  step === s.id
                    ? styles.stepBarActive
                    : step > s.id
                    ? styles.stepBarCompleted
                    : ""
                }`}
              />
              <span
                className={`${styles.stepTitle} ${step === s.id ? styles.stepTitleActive : ""}`}
                aria-current={step === s.id ? "step" : undefined}
              >
                {s.label}
              </span>
            </li>
          ))}
        </ol>
      </nav>

      {/* ETAPA 1: Identidad y datos personales */}
      {step === 1 && (
        <form onSubmit={handleNextStep1} noValidate>
          <div className={styles.stepIntro}>
            <h2 ref={stepHeadingRef} tabIndex={-1} className={styles.stepHeading}>
              Datos de identidad
            </h2>
            <p className={styles.stepSubheading}>
              Ingresa tus datos personales tal como figuran en tu documento oficial.
            </p>
          </div>

          <div className={styles.fieldsContainer} style={{ marginTop: "1.25rem" }}>
            <div className={styles.fieldsGrid2}>
              <Select
                id="prospect-treatment"
                label="Tratamiento"
                value={formData.treatment ?? ""}
                placeholder="Selecciona una opción"
                error={errors.treatment}
                options={TREATMENT_OPTIONS}
                onValueChange={(val) => {
                  handleFieldChange("treatment", val);
                  handleProfileChange("treatment", val);
                }}
              />

              <Input
                ref={firstInputRef}
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
            </div>

            <Input
              id="prospect-identity"
              name="identity"
              maxLength={64}
              label="Cédula verificada"
              readOnly
              value={formData.identity}
            />

            <div className={styles.fieldsGrid2}>
              <Input
                id="prospect-nationality"
                name="nationality"
                maxLength={120}
                label="Nacionalidad"
                placeholder="Dominicana"
                required
                value={formData.nationality ?? ""}
                error={errors.nationality}
                onChange={(e) => {
                  handleFieldChange("nationality", e.target.value);
                  handleProfileChange("nationality", e.target.value);
                }}
                autoComplete="country-name"
              />

              <Select
                id="prospect-marital-status"
                label="Estado civil"
                value={formData.marital_status ?? ""}
                placeholder="Selecciona una opción"
                options={MARITAL_STATUS_OPTIONS}
                error={errors.marital_status}
                onValueChange={handleMaritalStatusChange}
              />
            </div>
          </div>

          <div className={styles.actionsRow}>
            <div className={styles.primaryButtonWrapper}>
              <Button type="submit" variant="primary" size="md" style={{ width: "100%" }}>
                Continuar a contacto y vivienda
                <ArrowRight size={16} aria-hidden="true" style={{ marginLeft: 6 }} />
              </Button>
            </div>
          </div>
        </form>
      )}

      {/* ETAPA 2: Contacto y vivienda */}
      {step === 2 && (
        <form onSubmit={handleNextStep2} noValidate>
          <div className={styles.stepIntro}>
            <h2 ref={stepHeadingRef} tabIndex={-1} className={styles.stepHeading}>
              Contacto y vivienda
            </h2>
            <p className={styles.stepSubheading}>
              Indícanos dónde resides y cómo comunicarnos contigo.
            </p>
          </div>

          <div className={styles.fieldsContainer} style={{ marginTop: "1.25rem" }}>
            <div className={styles.fieldsGrid2}>
              <Input
                id="prospect-phone"
                name="phone"
                maxLength={80}
                type="tel"
                label="Teléfono o celular"
                placeholder="809-000-0000"
                required
                value={formData.phone}
                error={errors.phone}
                onChange={(e) => handleFieldChange("phone", formatPhone(e.target.value))}
                onKeyDown={(e) => handleMaskedBackspace(e, formatPhone, (val) => handleFieldChange("phone", val))}
                autoComplete="tel"
              />

              <Input
                id="prospect-email"
                name="email"
                maxLength={254}
                type="email"
                label="Correo electrónico"
                placeholder="ejemplo@correo.com"
                required
                value={formData.email}
                error={errors.email}
                onChange={(e) => handleFieldChange("email", e.target.value)}
                autoComplete="email"
              />
            </div>

            <Input
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

            <h3 className={styles.subsectionTitle}>
              <Building2 size={16} aria-hidden="true" /> Vivienda y vehículos
            </h3>

            <div className={styles.fieldsGrid2}>
              <div className={styles.segmentedField}>
                <span className={styles.segmentedLabel}>¿Vive en casa propia?</span>
                <div className={styles.choiceGroup}>
                  <button
                    type="button"
                    className={`${styles.choiceButton} ${formData.profile.owns_home === true ? styles.choiceButtonActive : ""}`}
                    aria-pressed={formData.profile.owns_home === true}
                    onClick={() => handleProfileChange("owns_home", true)}
                  >
                    Sí
                  </button>
                  <button
                    type="button"
                    className={`${styles.choiceButton} ${formData.profile.owns_home === false ? styles.choiceButtonActive : ""}`}
                    aria-pressed={formData.profile.owns_home === false}
                    onClick={() => handleProfileChange("owns_home", false)}
                  >
                    No (alquila)
                  </button>
                </div>
                {errors.owns_home && <p className={styles.selectionError} role="alert">{errors.owns_home}</p>}
              </div>

              <div className={styles.segmentedField}>
                <span className={styles.segmentedLabel}>¿Posee vehículo propio?</span>
                <div className={styles.choiceGroup}>
                  <button
                    type="button"
                    className={`${styles.choiceButton} ${formData.profile.owns_vehicle === true ? styles.choiceButtonActive : ""}`}
                    aria-pressed={formData.profile.owns_vehicle === true}
                    onClick={() => handleProfileChange("owns_vehicle", true)}
                  >
                    Sí
                  </button>
                  <button
                    type="button"
                    className={`${styles.choiceButton} ${formData.profile.owns_vehicle === false ? styles.choiceButtonActive : ""}`}
                    aria-pressed={formData.profile.owns_vehicle === false}
                    onClick={() => handleProfileChange("owns_vehicle", false)}
                  >
                    No
                  </button>
                </div>
                {errors.owns_vehicle && <p className={styles.selectionError} role="alert">{errors.owns_vehicle}</p>}
              </div>
            </div>
          </div>

          <div className={styles.actionsRow}>
            <Button type="button" variant="secondary" size="md" onClick={() => setStep(1)}>
              <ArrowLeft size={16} aria-hidden="true" style={{ marginRight: 6 }} />
              Atrás
            </Button>
            <div className={styles.primaryButtonWrapper}>
              <Button type="submit" variant="primary" size="md" style={{ width: "100%" }}>
                Continuar a empleo e ingresos
                <ArrowRight size={16} aria-hidden="true" style={{ marginLeft: 6 }} />
              </Button>
            </div>
          </div>
        </form>
      )}

      {/* ETAPA 3: Ingresos y empleo */}
      {step === 3 && (
        <form onSubmit={handleNextStep3} noValidate>
          <div className={styles.stepIntro}>
            <h2 ref={stepHeadingRef} tabIndex={-1} className={styles.stepHeading}>
              Empleo e ingresos
            </h2>
            <p className={styles.stepSubheading}>
              Indica tus fuentes de ingresos. Si trabajas de forma independiente, puedes marcar «No aplica empleo en empresa».
            </p>
          </div>

          <div className={styles.fieldsContainer} style={{ marginTop: "1.25rem" }}>
            <Select
              id="prospect-income-source"
              label="Origen principal de ingresos"
              value={formData.income_source}
              placeholder="Selecciona una opción"
              options={INCOME_SOURCE_OPTIONS}
              error={errors.income_source}
              onValueChange={(val) => handleFieldChange("income_source", val)}
            />

            <h3 className={styles.subsectionTitle}>
              <Briefcase size={16} aria-hidden="true" /> Datos laborales
            </h3>

            <label className={styles.toggleCard}>
              <input
                type="checkbox"
                checked={noFormalEmployment}
                onChange={(e) => handleToggleNoFormalEmployment(e.target.checked)}
              />
              <span>Trabajo por cuenta propia o no aplica empleo en empresa</span>
            </label>

            {!noFormalEmployment ? (
              <>
                <div className={styles.fieldsGrid2}>
                  <Input
                    id="prospect-employer"
                    name="employer"
                    maxLength={200}
                    label="Dónde trabaja / Empresa"
                    placeholder="Nombre de la empresa o negocio"
                    required
                    value={formData.profile.employer ?? ""}
                    error={errors.employer}
                    onChange={(e) => handleProfileChange("employer", e.target.value)}
                  />

                  <Input
                    id="prospect-position"
                    name="position"
                    maxLength={200}
                    label="Cargo o puesto"
                    placeholder="Ej. Gerente, Analista, Técnico"
                    required
                    value={formData.profile.position ?? ""}
                    error={errors.position}
                    onChange={(e) => {
                      handleProfileChange("position", e.target.value);
                      handleFieldChange("position", e.target.value);
                    }}
                  />
                </div>

                <div className={styles.fieldsGrid2}>
                  <Input
                    id="prospect-employment-duration"
                    name="employment_duration"
                    maxLength={100}
                    label="Tiempo laborando"
                    placeholder="Ej. 2 años y 6 meses"
                    required
                    value={formData.profile.employment_duration ?? ""}
                    error={errors.employment_duration}
                    onChange={(e) => handleProfileChange("employment_duration", e.target.value)}
                  />

                  <Input
                    id="prospect-work-phone"
                    name="work_phone"
                    maxLength={80}
                    type="tel"
                    label="Teléfono de trabajo"
                    placeholder="809-000-0000"
                    required
                    value={formData.profile.work_phone ?? ""}
                    error={errors.work_phone}
                    onChange={(e) => handleProfileChange("work_phone", formatPhone(e.target.value))}
                    onKeyDown={(e) => handleMaskedBackspace(e, formatPhone, (val) => handleProfileChange("work_phone", val))}
                  />
                </div>

                <Input
                  id="prospect-work-address"
                  name="work_address"
                  maxLength={1000}
                  label="Dirección del trabajo"
                  placeholder="Calle, número, edificio, sector y ciudad"
                  required
                  value={formData.profile.work_address ?? ""}
                  error={errors.work_address}
                  onChange={(e) => handleProfileChange("work_address", e.target.value)}
                />
              </>
            ) : (
              <Input
                id="prospect-indep-position"
                name="position"
                maxLength={200}
                label="Ocupación o actividad independiente"
                placeholder="Ej. Comerciante, Asesor, Chofer"
                required
                value={formData.profile.position ?? ""}
                error={errors.position}
                onChange={(e) => {
                  handleProfileChange("position", e.target.value);
                  handleFieldChange("position", e.target.value);
                }}
              />
            )}

            <h3 className={styles.subsectionTitle}>
              <UserCheck size={16} aria-hidden="true" /> Ingresos mensuales
            </h3>

            <div className={styles.fieldsGrid2}>
              <MoneyField
                id="prospect-fixed-income"
                name="fixed_income"
                label="Sueldo o ingresos fijos"
                placeholder="RD$0.00"
                required
                value={formData.profile.fixed_income ?? ""}
                error={errors.fixed_income}
                onValueChange={(val) => handleProfileChange("fixed_income", val)}
              />

              <Input
                id="prospect-pay-days"
                name="pay_days"
                maxLength={100}
                label="Días o ciclo de cobro"
                placeholder="Ej. Quincenal (15 y 30), o mensual"
                required
                value={formData.profile.pay_days ?? ""}
                error={errors.pay_days}
                onChange={(e) => handleProfileChange("pay_days", e.target.value)}
              />
            </div>

            <label className={styles.toggleCard}>
              <input
                type="checkbox"
                checked={noOtherIncome}
                onChange={(e) => handleToggleNoOtherIncome(e.target.checked)}
              />
              <span>No percibo otros ingresos adicionales</span>
            </label>

            {!noOtherIncome && (
              <div className={styles.fieldsGrid2}>
                <MoneyField
                  id="prospect-other-income"
                  name="other_income"
                  label="Monto otros ingresos"
                  placeholder="RD$0.00"
                  required
                  value={formData.profile.other_income ?? ""}
                  error={errors.other_income}
                  onValueChange={(val) => handleProfileChange("other_income", val)}
                />

                <Input
                  id="prospect-other-income-source"
                  name="other_income_source"
                  maxLength={200}
                  label="Concepto de otros ingresos"
                  placeholder="Ej. Remesas, alquiler, ventas"
                  required
                  value={formData.profile.other_income_source ?? ""}
                  error={errors.other_income_source}
                  onChange={(e) => handleProfileChange("other_income_source", e.target.value)}
                />
              </div>
            )}
          </div>

          <div className={styles.actionsRow}>
            <Button type="button" variant="secondary" size="md" onClick={() => setStep(2)}>
              <ArrowLeft size={16} aria-hidden="true" style={{ marginRight: 6 }} />
              Atrás
            </Button>
            <div className={styles.primaryButtonWrapper}>
              <Button type="submit" variant="primary" size="md" style={{ width: "100%" }}>
                Continuar a cónyuge
                <ArrowRight size={16} aria-hidden="true" style={{ marginLeft: 6 }} />
              </Button>
            </div>
          </div>
        </form>
      )}

      {/* ETAPA 4: Cónyuge condicional */}
      {step === 4 && (
        <form onSubmit={handleNextStep4} noValidate>
          <div className={styles.stepIntro}>
            <h2 ref={stepHeadingRef} tabIndex={-1} className={styles.stepHeading}>
              Datos del cónyuge
            </h2>
            <p className={styles.stepSubheading}>
              Si estás casado(a) o en unión libre, completa los datos de tu pareja.
            </p>
          </div>

          <div className={styles.fieldsContainer} style={{ marginTop: "1.25rem" }}>
            <label className={styles.toggleCard}>
              <input
                type="checkbox"
                checked={formData.profile.spouse_not_applicable === true}
                onChange={(e) => {
                  const notApp = e.target.checked;
                  handleProfileChange("spouse_not_applicable", notApp);
                  if (notApp) {
                    handleProfileChange("spouse", null);
                  } else {
                    handleProfileChange("spouse", {
                      name: "",
                      identity: "",
                      phone: "",
                      employer: "",
                      employment_duration: "",
                      position: "",
                      address: formData.address,
                      work_phone: "",
                    });
                  }
                }}
              />
              <span>No aplica cónyuge (soltero/a o sin pareja actual)</span>
            </label>

            {formData.profile.spouse_not_applicable ? (
              <div className={styles.noticeBadge}>
                <HeartHandshake className={styles.noticeIcon} aria-hidden="true" />
                <span>
                  Has indicado que no aplica cónyuge. Puedes continuar directamente a las referencias.
                </span>
              </div>
            ) : (
              <>
                <div className={styles.fieldsGrid2}>
                  <Input
                    id="spouse-name"
                    name="spouse_name"
                    maxLength={200}
                    label="Nombre completo del cónyuge"
                    placeholder="Ej. María Rodríguez"
                    required
                    value={formData.profile.spouse?.name ?? ""}
                    error={errors.spouse_name}
                    onChange={(e) => handleSpouseChange("name", e.target.value)}
                  />

                  <Input
                    id="spouse-identity"
                    name="spouse_identity"
                    maxLength={64}
                    label="Cédula del cónyuge"
                    placeholder="000-0000000-0"
                    required
                    value={formData.profile.spouse?.identity ?? ""}
                    error={errors.spouse_identity}
                    onChange={(e) => handleSpouseChange("identity", formatCedula(e.target.value))}
                    onKeyDown={(e) => handleMaskedBackspace(e, formatCedula, (val) => handleSpouseChange("identity", val))}
                  />
                </div>

                <div className={styles.fieldsGrid2}>
                  <Input
                    id="spouse-phone"
                    name="spouse_phone"
                    maxLength={80}
                    type="tel"
                    label="Teléfono del cónyuge"
                    placeholder="809-000-0000"
                    required
                    value={formData.profile.spouse?.phone ?? ""}
                    error={errors.spouse_phone}
                    onChange={(e) => handleSpouseChange("phone", formatPhone(e.target.value))}
                    onKeyDown={(e) => handleMaskedBackspace(e, formatPhone, (val) => handleSpouseChange("phone", val))}
                  />

                  <Input
                    id="spouse-employer"
                    name="spouse_employer"
                    maxLength={200}
                    label="Dónde trabaja"
                    placeholder="Empresa o «No aplica»"
                    required
                    value={formData.profile.spouse?.employer ?? ""}
                    error={errors.spouse_employer}
                    onChange={(e) => handleSpouseChange("employer", e.target.value)}
                  />
                </div>

                <div className={styles.fieldsGrid2}>
                  <Input
                    id="spouse-position"
                    name="spouse_position"
                    maxLength={200}
                    label="Cargo"
                    placeholder="Cargo o «No aplica»"
                    required
                    value={formData.profile.spouse?.position ?? ""}
                    error={errors.spouse_position}
                    onChange={(e) => handleSpouseChange("position", e.target.value)}
                  />

                  <Input
                    id="spouse-duration"
                    name="spouse_duration"
                    maxLength={100}
                    label="Tiempo trabajando"
                    placeholder="Ej. 1 año o «No aplica»"
                    required
                    value={formData.profile.spouse?.employment_duration ?? ""}
                    error={errors.spouse_employment_duration}
                    onChange={(e) => handleSpouseChange("employment_duration", e.target.value)}
                  />
                </div>

                <div className={styles.fieldsGrid2}>
                  <Input
                    id="spouse-work-phone"
                    name="spouse_work_phone"
                    maxLength={80}
                    type="tel"
                    label="Teléfono de trabajo"
                    placeholder="809-000-0000 o «No aplica»"
                    required
                    value={formData.profile.spouse?.work_phone ?? ""}
                    error={errors.spouse_work_phone}
                    onChange={(e) => handleSpouseChange("work_phone", e.target.value)}
                  />

                  <Input
                    id="spouse-address"
                    name="spouse_address"
                    maxLength={1000}
                    label="Dirección del cónyuge"
                    placeholder="Dirección completa"
                    required
                    value={formData.profile.spouse?.address ?? ""}
                    error={errors.spouse_address}
                    onChange={(e) => handleSpouseChange("address", e.target.value)}
                  />
                </div>

                <div className={styles.helperActionRow}>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    onClick={() => handleSpouseChange("address", formData.address)}
                  >
                    Usar mi misma dirección
                  </Button>
                </div>
              </>
            )}
          </div>

          <div className={styles.actionsRow}>
            <Button type="button" variant="secondary" size="md" onClick={() => setStep(3)}>
              <ArrowLeft size={16} aria-hidden="true" style={{ marginRight: 6 }} />
              Atrás
            </Button>
            <div className={styles.primaryButtonWrapper}>
              <Button type="submit" variant="primary" size="md" style={{ width: "100%" }}>
                Continuar a referencias
                <ArrowRight size={16} aria-hidden="true" style={{ marginLeft: 6 }} />
              </Button>
            </div>
          </div>
        </form>
      )}

      {/* ETAPA 5: Referencias (3 familiares + 2 personales en tarjetas móviles) */}
      {step === 5 && (
        <form onSubmit={handleNextStep5} noValidate>
          <div className={styles.stepIntro}>
            <h2 ref={stepHeadingRef} tabIndex={-1} className={styles.stepHeading}>
              Referencias
            </h2>
            <p className={styles.stepSubheading}>
              La ficha de crédito exige 3 referencias familiares y 2 personales para verificar los datos.
            </p>
          </div>

          <div className={styles.fieldsContainer} style={{ marginTop: "1.25rem" }}>
            <h3 className={styles.subsectionTitle}>
              <Users size={16} aria-hidden="true" /> 3 Referencias familiares
            </h3>

            {(formData.profile.family_references ?? []).map((ref, idx) => (
              <div key={idx} className={styles.referenceCard}>
                <div className={styles.referenceCardHeader}>
                  <span className={styles.referenceCardTitle}>
                    <span className={styles.referenceBadge}>{idx + 1}</span> Referencia familiar
                  </span>
                </div>

                <div className={styles.fieldsGrid2}>
                  <Input
                    id={`family-name-${idx}`}
                    label="Nombre completo"
                    placeholder="Ej. Pedro Pérez"
                    required
                    value={ref.name ?? ""}
                    error={errors[`family_${idx}_name`]}
                    onChange={(e) => handleFamilyReferenceChange(idx, "name", e.target.value)}
                  />

                  <Select
                    id={`family-rel-${idx}`}
                    label="Parentesco / Relación"
                    value={ref.relationship ?? ""}
                    options={FAMILY_OPTIONS}
                    error={errors[`family_${idx}_relationship`]}
                    onValueChange={(val) => handleFamilyReferenceChange(idx, "relationship", val)}
                  />
                </div>

                <div className={styles.fieldsGrid2}>
                  <Input
                    id={`family-phone-${idx}`}
                    type="tel"
                    label="Teléfono o celular"
                    placeholder="809-000-0000"
                    required
                    value={ref.phone ?? ""}
                    error={errors[`family_${idx}_phone`]}
                    onChange={(e) => handleFamilyReferenceChange(idx, "phone", formatPhone(e.target.value))}
                    onKeyDown={(e) => handleMaskedBackspace(e, formatPhone, (val) => handleFamilyReferenceChange(idx, "phone", val))}
                  />

                  <Input
                    id={`family-addr-${idx}`}
                    label="Dirección o sector"
                    placeholder="Sector, calle o ciudad"
                    required
                    value={ref.address ?? ""}
                    error={errors[`family_${idx}_address`]}
                    onChange={(e) => handleFamilyReferenceChange(idx, "address", e.target.value)}
                  />
                </div>
              </div>
            ))}

            <h3 className={styles.subsectionTitle} style={{ marginTop: "1rem" }}>
              <UserCheck size={16} aria-hidden="true" /> 2 Referencias personales
            </h3>

            {(formData.profile.personal_references ?? []).map((ref, idx) => (
              <div key={idx} className={styles.referenceCard}>
                <div className={styles.referenceCardHeader}>
                  <span className={styles.referenceCardTitle}>
                    <span className={styles.referenceBadge}>{idx + 1}</span> Referencia personal
                  </span>
                </div>

                <div className={styles.fieldsGrid2}>
                  <Input
                    id={`personal-name-${idx}`}
                    label="Nombre completo"
                    placeholder="Ej. Luis Santana"
                    required
                    value={ref.name ?? ""}
                    error={errors[`personal_${idx}_name`]}
                    onChange={(e) => handlePersonalReferenceChange(idx, "name", e.target.value)}
                  />

                  <Select
                    id={`personal-rel-${idx}`}
                    label="Relación"
                    value={ref.relationship ?? ""}
                    options={PERSONAL_OPTIONS}
                    error={errors[`personal_${idx}_relationship`]}
                    onValueChange={(val) => handlePersonalReferenceChange(idx, "relationship", val)}
                  />
                </div>

                <Input
                  id={`personal-phone-${idx}`}
                  type="tel"
                  label="Teléfono o celular"
                  placeholder="809-000-0000"
                  required
                  value={ref.phone ?? ""}
                  error={errors[`personal_${idx}_phone`]}
                  onChange={(e) => handlePersonalReferenceChange(idx, "phone", formatPhone(e.target.value))}
                  onKeyDown={(e) => handleMaskedBackspace(e, formatPhone, (val) => handlePersonalReferenceChange(idx, "phone", val))}
                />
              </div>
            ))}
          </div>

          <div className={styles.actionsRow}>
            <Button type="button" variant="secondary" size="md" onClick={() => setStep(4)}>
              <ArrowLeft size={16} aria-hidden="true" style={{ marginRight: 6 }} />
              Atrás
            </Button>
            <div className={styles.primaryButtonWrapper}>
              <Button type="submit" variant="primary" size="md" style={{ width: "100%" }}>
                Continuar a revisión final
                <ArrowRight size={16} aria-hidden="true" style={{ marginLeft: 6 }} />
              </Button>
            </div>
          </div>
        </form>
      )}

      {/* ETAPA 6: Revisión y envío */}
      {step === 6 && (
        <form onSubmit={handleSubmit} noValidate>
          <div className={styles.stepIntro}>
            <h2 ref={stepHeadingRef} tabIndex={-1} className={styles.stepHeading}>
              Revisa tu información
            </h2>
            <p className={styles.stepSubheading}>
              Verifica que tus datos sean exactos antes de enviarlos. Puedes editar cualquier etapa si lo necesitas.
            </p>
          </div>

          <div className={styles.fieldsContainer} style={{ marginTop: "1.25rem" }}>
            {/* Resumen 1: Identidad */}
            <div className={styles.reviewBox}>
              <div className={styles.reviewTitle}>
                <span>1. Identidad y estado civil</span>
                <Button type="button" variant="ghost" size="sm" onClick={() => setStep(1)}>
                  Editar
                </Button>
              </div>
              <div className={styles.reviewList}>
                <div className={styles.reviewItem}>
                  <span className={styles.reviewLabel}>Tratamiento:</span>
                  <span className={styles.reviewValue}>{formData.treatment}</span>
                </div>
                <div className={styles.reviewItem}>
                  <span className={styles.reviewLabel}>Nombre:</span>
                  <span className={styles.reviewValue}>{formData.name}</span>
                </div>
                <div className={styles.reviewItem}>
                  <span className={styles.reviewLabel}>Cédula:</span>
                  <span className={styles.reviewValue}>{formData.identity}</span>
                </div>
                <div className={styles.reviewItem}>
                  <span className={styles.reviewLabel}>Nacionalidad:</span>
                  <span className={styles.reviewValue}>{formData.nationality}</span>
                </div>
                <div className={styles.reviewItem}>
                  <span className={styles.reviewLabel}>Estado civil:</span>
                  <span className={styles.reviewValue}>{formData.marital_status}</span>
                </div>
              </div>
            </div>

            {/* Resumen 2: Contacto y vivienda */}
            <div className={styles.reviewBox}>
              <div className={styles.reviewTitle}>
                <span>2. Contacto y vivienda</span>
                <Button type="button" variant="ghost" size="sm" onClick={() => setStep(2)}>
                  Editar
                </Button>
              </div>
              <div className={styles.reviewList}>
                <div className={styles.reviewItem}>
                  <span className={styles.reviewLabel}>Teléfono:</span>
                  <span className={styles.reviewValue}>{formData.phone}</span>
                </div>
                <div className={styles.reviewItem}>
                  <span className={styles.reviewLabel}>Correo:</span>
                  <span className={styles.reviewValue}>{formData.email}</span>
                </div>
                <div className={styles.reviewItemFull}>
                  <span className={styles.reviewLabel}>Dirección de residencia:</span>
                  <span className={styles.reviewValue}>{formData.address}</span>
                </div>
                <div className={styles.reviewItem}>
                  <span className={styles.reviewLabel}>Casa propia:</span>
                  <span className={styles.reviewValue}>{formData.profile.owns_home ? "Sí" : "No"}</span>
                </div>
                <div className={styles.reviewItem}>
                  <span className={styles.reviewLabel}>Vehículo propio:</span>
                  <span className={styles.reviewValue}>{formData.profile.owns_vehicle ? "Sí" : "No"}</span>
                </div>
              </div>
            </div>

            {/* Resumen 3: Empleo e ingresos */}
            <div className={styles.reviewBox}>
              <div className={styles.reviewTitle}>
                <span>3. Empleo e ingresos</span>
                <Button type="button" variant="ghost" size="sm" onClick={() => setStep(3)}>
                  Editar
                </Button>
              </div>
              <div className={styles.reviewList}>
                <div className={styles.reviewItem}>
                  <span className={styles.reviewLabel}>Origen ingresos:</span>
                  <span className={styles.reviewValue}>{formData.income_source}</span>
                </div>
                <div className={styles.reviewItem}>
                  <span className={styles.reviewLabel}>Sueldo / Fijos:</span>
                  <span className={styles.reviewValue}>{formData.profile.fixed_income}</span>
                </div>
                <div className={styles.reviewItem}>
                  <span className={styles.reviewLabel}>Empresa / Trabajo:</span>
                  <span className={styles.reviewValue}>{formData.profile.employer}</span>
                </div>
                <div className={styles.reviewItem}>
                  <span className={styles.reviewLabel}>Cargo:</span>
                  <span className={styles.reviewValue}>{formData.profile.position}</span>
                </div>
                <div className={styles.reviewItem}>
                  <span className={styles.reviewLabel}>Tiempo laborando:</span>
                  <span className={styles.reviewValue}>{formData.profile.employment_duration}</span>
                </div>
                <div className={styles.reviewItem}>
                  <span className={styles.reviewLabel}>Días de cobro:</span>
                  <span className={styles.reviewValue}>{formData.profile.pay_days}</span>
                </div>
                <div className={styles.reviewItemFull}>
                  <span className={styles.reviewLabel}>Otros ingresos:</span>
                  <span className={styles.reviewValue}>
                    {formData.profile.other_income} ({formData.profile.other_income_source})
                  </span>
                </div>
              </div>
            </div>

            {/* Resumen 4: Cónyuge */}
            <div className={styles.reviewBox}>
              <div className={styles.reviewTitle}>
                <span>4. Cónyuge</span>
                <Button type="button" variant="ghost" size="sm" onClick={() => setStep(4)}>
                  Editar
                </Button>
              </div>
              <div className={styles.reviewList}>
                {formData.profile.spouse_not_applicable ? (
                  <div className={styles.reviewItemFull}>
                    <span className={styles.reviewValue}>No aplica cónyuge</span>
                  </div>
                ) : (
                  <>
                    <div className={styles.reviewItem}>
                      <span className={styles.reviewLabel}>Nombre:</span>
                      <span className={styles.reviewValue}>{formData.profile.spouse?.name}</span>
                    </div>
                    <div className={styles.reviewItem}>
                      <span className={styles.reviewLabel}>Cédula:</span>
                      <span className={styles.reviewValue}>{formData.profile.spouse?.identity}</span>
                    </div>
                    <div className={styles.reviewItem}>
                      <span className={styles.reviewLabel}>Teléfono:</span>
                      <span className={styles.reviewValue}>{formData.profile.spouse?.phone}</span>
                    </div>
                    <div className={styles.reviewItem}>
                      <span className={styles.reviewLabel}>Lugar de trabajo:</span>
                      <span className={styles.reviewValue}>{formData.profile.spouse?.employer}</span>
                    </div>
                  </>
                )}
              </div>
            </div>

            {/* Resumen 5: Referencias */}
            <div className={styles.reviewBox}>
              <div className={styles.reviewTitle}>
                <span>5. Referencias</span>
                <Button type="button" variant="ghost" size="sm" onClick={() => setStep(5)}>
                  Editar
                </Button>
              </div>
              <div className={styles.reviewList}>
                <div className={styles.reviewItemFull}>
                  <span className={styles.reviewLabel}>Referencias familiares:</span>
                  {(formData.profile.family_references ?? []).map((r, i) => (
                    <div key={i} className={styles.reviewValue}>
                      • {r.name} ({r.relationship}) — {r.phone}
                    </div>
                  ))}
                </div>
                <div className={styles.reviewItemFull} style={{ marginTop: "0.5rem" }}>
                  <span className={styles.reviewLabel}>Referencias personales:</span>
                  {(formData.profile.personal_references ?? []).map((r, i) => (
                    <div key={i} className={styles.reviewValue}>
                      • {r.name} ({r.relationship}) — {r.phone}
                    </div>
                  ))}
                </div>
              </div>
            </div>

            {/* Badge de seguridad */}
            <div className={styles.noticeBadge}>
              <Lock className={styles.noticeIcon} aria-hidden="true" />
              <span>
                Tus datos se transmiten de forma cifrada directamente a YZY Contracts. El enlace se desactivará una vez enviado.
              </span>
            </div>

            {submitError && (
              <div ref={errorAlertRef} tabIndex={-1} className={styles.alertBox} role="alert">
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
              onClick={() => setStep(5)}
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
                Enviar ficha completa
                <CheckCircle2 size={16} aria-hidden="true" style={{ marginLeft: 6 }} />
              </Button>
            </div>
          </div>
        </form>
      )}
    </motion.section>
  );
}
