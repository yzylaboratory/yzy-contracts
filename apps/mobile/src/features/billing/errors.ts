import { isApiError } from '../../lib/api/errors';

// Server copy is already Spanish. 409 BILLING_CONFLICT and 404 need a fresh overview; other 409s do not.
export function billingErrorMessage(error: unknown): string {
  if (isApiError(error)) return error.message;
  if (error instanceof Error && error.message.length > 0) return error.message;
  return 'No se pudo completar la solicitud.';
}

export function billingOverviewIsStale(error: unknown): boolean {
  return isApiError(error) && (error.code === 'BILLING_CONFLICT' || error.status === 404);
}
