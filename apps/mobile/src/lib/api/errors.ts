// Error codes mirror services/api/src/error.rs. HTTP status 0 marks a transport failure.
export class ApiError extends Error {
  readonly status: number;
  readonly code: string;
  readonly details: unknown;

  constructor(status: number, code: string, message: string, details?: unknown) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
    this.details = details ?? null;
  }
}

export function isApiError(error: unknown): error is ApiError {
  return error instanceof ApiError;
}

export function networkError(): ApiError {
  return new ApiError(0, 'NETWORK_ERROR', 'Sin conexión con el servidor.');
}

type UnauthorizedHandler = () => void;
let unauthorizedHandler: UnauthorizedHandler | null = null;

// Registered by the access feature: a 401 ends the session (plan section 9 / errors table).
export function setUnauthorizedHandler(handler: UnauthorizedHandler | null): void {
  unauthorizedHandler = handler;
}

export function reportApiError(error: unknown): void {
  if (isApiError(error) && error.status === 401) {
    unauthorizedHandler?.();
  }
}
