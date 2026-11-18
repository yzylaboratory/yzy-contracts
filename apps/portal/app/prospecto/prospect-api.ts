import { getApiBaseUrl } from "@/lib/api";
import type { ClientProfile } from "@/components/case-application/case-application";

export interface ProspectFormData {
  name: string;
  identity: string;
  phone: string;
  address: string;
  email: string;
  treatment?: string | null;
  nationality?: string | null;
  marital_status?: string | null;
  position?: string | null;
  income_source: string;
  profile: ClientProfile;
}

export type CheckProspectLinkResult =
  | { kind: "valid" }
  | { kind: "not_found" }
  | { kind: "network_error"; message: string };

export type SubmitProspectResult =
  | { kind: "success" }
  | { kind: "not_found" }
  | { kind: "error"; message: string };

/**
 * Valida que el token cumpla con 64 caracteres hexadecimales en minúsculas.
 */
export function isValidProspectToken(token: string | null | undefined): boolean {
  if (!token) return false;
  return /^[0-9a-f]{64}$/.test(token);
}

/**
 * Extrae y valida el token desde el hash de la URL sin exponerlo ni registrarlo.
 */
export function extractProspectTokenFromHash(hash: string): string | null {
  const cleaned = hash.startsWith("#") ? hash.slice(1) : hash;
  return isValidProspectToken(cleaned) ? cleaned : null;
}

/**
 * Obtiene la base de la API pública evitando conectar a producción desde entornos de desarrollo.
 */
export function getPublicApiBase(): string {
  return getApiBaseUrl().replace(/\/+$/, "");
}

/**
 * Sanitiza el perfil del cliente para el enlace público, garantizando que incluya
 * todos los campos exigidos por la ficha sin exponer ni enviar datos de préstamo
 * (sin monto solicitado, fecha de solicitud ni cálculos de expediente).
 */
export function sanitizeProspectProfile(rawProfile?: Partial<ClientProfile> | null): ClientProfile {
  const profile = rawProfile ?? {};
  const ownsHome = typeof profile.owns_home === "boolean" ? profile.owns_home : null;
  const rentsHome = typeof profile.rents_home === "boolean"
    ? profile.rents_home
    : (ownsHome !== null ? !ownsHome : null);

  const spouseNotApplicable = profile.spouse_not_applicable === true;

  const spouse = spouseNotApplicable || !profile.spouse
    ? null
    : {
        name: profile.spouse.name?.trim() || null,
        identity: profile.spouse.identity?.trim() || null,
        phone: profile.spouse.phone?.trim() || null,
        employer: profile.spouse.employer?.trim() || null,
        employment_duration: profile.spouse.employment_duration?.trim() || null,
        position: profile.spouse.position?.trim() || null,
        address: profile.spouse.address?.trim() || null,
        work_phone: profile.spouse.work_phone?.trim() || null,
      };

  const familyReferences = (profile.family_references ?? []).map((ref) => ({
    name: ref.name?.trim() || "",
    relationship: ref.relationship?.trim() || "",
    phone: ref.phone?.trim() || "",
    address: ref.address?.trim() || "",
  }));

  const personalReferences = (profile.personal_references ?? []).map((ref) => ({
    name: ref.name?.trim() || "",
    relationship: ref.relationship?.trim() || "",
    phone: ref.phone?.trim() || "",
  }));

  return {
    treatment: profile.treatment?.trim() || null,
    nationality: profile.nationality?.trim() || null,
    marital_status: profile.marital_status?.trim() || null,
    owns_home: ownsHome,
    rents_home: rentsHome,
    owns_vehicle: typeof profile.owns_vehicle === "boolean" ? profile.owns_vehicle : null,
    employer: profile.employer?.trim() || null,
    work_address: profile.work_address?.trim() || null,
    work_phone: profile.work_phone?.trim() || null,
    position: profile.position?.trim() || null,
    employment_duration: profile.employment_duration?.trim() || null,
    fixed_income: profile.fixed_income?.trim() || null,
    other_income: profile.other_income?.trim() || null,
    other_income_source: profile.other_income_source?.trim() || null,
    pay_days: profile.pay_days?.trim() || null,
    spouse_not_applicable: spouseNotApplicable,
    spouse,
    family_references: familyReferences,
    personal_references: personalReferences,
  };
}

/**
 * Verifica la vigencia y disponibilidad del enlace de prospecto (POST /api/v1/public/prospect-links/check).
 * Respuesta 204: vigente; 404: no disponible/vencido/usado.
 */
export async function checkProspectLink(
  token: string,
  identity: string,
  signal?: AbortSignal,
): Promise<CheckProspectLinkResult> {
  const apiBase = getPublicApiBase();
  try {
    const response = await fetch(`${apiBase}/api/v1/public/prospect-links/check`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ token, identity }),
      cache: "no-store",
      credentials: "omit",
      redirect: "error",
      referrerPolicy: "no-referrer",
      signal,
    });

    if (response.status === 204) {
      return { kind: "valid" };
    }
    if (response.status === 404) {
      return { kind: "not_found" };
    }
    return {
      kind: "network_error",
      message: "Respuesta inesperada al verificar el enlace.",
    };
  } catch (error) {
    if (signal?.aborted) {
      throw error;
    }
    return {
      kind: "network_error",
      message: "No se pudo conectar con el servidor. Por favor verifica tu conexión a internet.",
    };
  }
}

/**
 * Envía los datos del prospecto (POST /api/v1/public/prospect-links/submit).
 * Respuesta 204: éxito; 404: no disponible.
 * Incluye campos personales, origen de ingresos (income_source) y profile completo de ClientProfile.
 * Conserva la privacidad y no incluye ningún dato financiero o de cálculo del préstamo.
 */
export async function submitProspectLink(
  token: string,
  data: ProspectFormData,
  signal?: AbortSignal,
): Promise<SubmitProspectResult> {
  const apiBase = getPublicApiBase();
  const sanitizedProfile = sanitizeProspectProfile(data.profile);

  const nationality = data.nationality?.trim() || sanitizedProfile.nationality || null;
  const maritalStatus = data.marital_status?.trim() || sanitizedProfile.marital_status || null;
  const position = data.position?.trim() || sanitizedProfile.position || null;

  sanitizedProfile.nationality = nationality;
  sanitizedProfile.marital_status = maritalStatus;
  sanitizedProfile.position = position;

  const payload = {
    token,
    name: data.name.trim(),
    identity: data.identity.trim(),
    phone: data.phone.trim(),
    address: data.address.trim(),
    email: data.email?.trim() ? data.email.trim() : null,
    nationality,
    marital_status: maritalStatus,
    position,
    income_source: data.income_source.trim(),
    profile: sanitizedProfile,
  };

  try {
    const response = await fetch(`${apiBase}/api/v1/public/prospect-links/submit`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
      cache: "no-store",
      credentials: "omit",
      redirect: "error",
      referrerPolicy: "no-referrer",
      signal,
    });

    if (response.status === 204) {
      return { kind: "success" };
    }
    if (response.status === 404) {
      return { kind: "not_found" };
    }
    return {
      kind: "error",
      message: "No fue posible procesar la solicitud. Inténtalo de nuevo.",
    };
  } catch (error) {
    if (signal?.aborted) {
      throw error;
    }
    return {
      kind: "error",
      message: "Error de red al enviar tus datos. Verifica tu conexión e inténtalo de nuevo.",
    };
  }
}
