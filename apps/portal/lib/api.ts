import { supabase } from "./supabase";

const baseUrl = process.env.NEXT_PUBLIC_API_URL;

if (!baseUrl) {
  throw new Error("NEXT_PUBLIC_API_URL is required");
}

export class ApiError extends Error {
  constructor(readonly status: number, readonly code: string, message: string) {
    super(message);
  }
}

export async function isActiveAccount(accountId: string) {
  const { data } = await supabase.auth.getSession();
  return data.session?.user.id === accountId;
}

type ApiRequest = {
  method?: string;
  body?: unknown;
  expectedAccountId?: string;
  signal?: AbortSignal;
  notifyAccessChanged?: boolean;
  referrerPolicy?: ReferrerPolicy;
};

async function request(path: string, init: ApiRequest) {
  const { data } = await supabase.auth.getSession();
  if (!data.session) throw new ApiError(401, "UNAUTHENTICATED", "Authentication is required");
  if (init.expectedAccountId && data.session.user.id !== init.expectedAccountId) {
    throw new ApiError(401, "UNAUTHENTICATED", "The active account changed");
  }

  const headers = new Headers({ Authorization: `Bearer ${data.session.access_token}` });
  let body: BodyInit | undefined;
  if (init.body instanceof FormData || init.body instanceof Blob) {
    body = init.body;
  } else if (init.body !== undefined) {
    headers.set("Content-Type", "application/json");
    body = JSON.stringify(init.body);
  }
  const response = await fetch(`${baseUrl}/api/v1${path}`, {
    method: init.method ?? "GET",
    cache: "no-store",
    signal: init.signal,
    referrerPolicy: init.referrerPolicy,
    headers,
    body,
  });

  if (!response.ok) {
    const envelope = await response.json().catch(() => null) as { error?: { code: string; message: string } } | null;
    const code = envelope?.error?.code ?? "REQUEST_FAILED";
    if (typeof window !== "undefined" && init.notifyAccessChanged !== false && path !== "/me" && response.status === 403 && ["ACCESS_PENDING", "ACCOUNT_DELETED", "ADMIN_REQUIRED", "BILLING_REQUIRED"].includes(code)) {
      window.dispatchEvent(new Event("yzy:access-changed"));
    }
    throw new ApiError(response.status, code, envelope?.error?.message ?? "Request failed");
  }
  return response;
}

export async function api<T>(path: string, init: ApiRequest = {}): Promise<T> {
  const response = await request(path, init);
  return response.status === 204 ? undefined as T : await response.json() as T;
}

export async function apiBlob(path: string, init: ApiRequest = {}) {
  return (await request(path, init)).blob();
}
