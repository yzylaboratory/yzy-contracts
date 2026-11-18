import { getApiBaseUrl } from "@/lib/api";

export interface ProspectFormData {
  name: string;
  identity: string;
  phone: string;
  address: string;
  email?: string | null;
  nationality?: string | null;
  marital_status?: string | null;
  position?: string | null;
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
 * Verifica la vigencia y disponibilidad del enlace de prospecto (POST /api/v1/public/prospect-links/check).
 * Respuesta 204: vigente; 404: no disponible/vencido/usado.
 */
export async function checkProspectLink(
  token: string,
  signal?: AbortSignal,
): Promise<CheckProspectLinkResult> {
  const apiBase = getPublicApiBase();
  try {
    const response = await fetch(`${apiBase}/api/v1/public/prospect-links/check`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ token }),
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
 * name/identity/phone/address son requeridos. Los opcionales vacíos se envían como null o se omiten.
 */
export async function submitProspectLink(
  token: string,
  data: ProspectFormData,
  signal?: AbortSignal,
): Promise<SubmitProspectResult> {
  const apiBase = getPublicApiBase();
  const payload = {
    token,
    name: data.name.trim(),
    identity: data.identity.trim(),
    phone: data.phone.trim(),
    address: data.address.trim(),
    email: data.email?.trim() ? data.email.trim() : null,
    nationality: data.nationality?.trim() ? data.nationality.trim() : null,
    marital_status: data.marital_status?.trim() ? data.marital_status.trim() : null,
    position: data.position?.trim() ? data.position.trim() : null,
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
