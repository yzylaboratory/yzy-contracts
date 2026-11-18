import { isApiError } from '../../lib/api/errors';

// Spanish copy for codes the mobile client can receive from the API or from its own HTTP layer.
export function messageFor(error: unknown): string {
  if (isApiError(error)) {
    switch (error.code) {
      case 'NETWORK_ERROR':
        return 'Sin conexión. Revisa tu red e inténtalo de nuevo.';
      case 'UNAUTHENTICATED':
        return 'Tu sesión terminó. Vuelve a iniciar sesión.';
      case 'ACCESS_NOT_ALLOWED':
        return 'Esta cuenta no puede entrar en este entorno.';
      case 'BILLING_REQUIRED':
        return 'Solo el responsable de facturación puede acceder a esta cuenta.';
      case 'BILLING_BANK_REQUIRED':
        return 'Configura la cuenta bancaria de transferencias antes de activar la facturación.';
      case 'BILLING_NOT_FOUND':
        return 'No encontramos esa facturación.';
      case 'CLIENT_NOT_FOUND':
        return 'No encontramos ese cliente.';
      // The API sends the Spanish sentence for these codes.
      case 'VALIDATION_ERROR':
      case 'CLIENT_IDENTITY_CONFLICT':
      case 'CASE_REFERENCE_CONFLICT':
      case 'BILLING_CONFLICT':
      case 'PAYMENT_REQUIRED':
      case 'DOCUMENT_TEMPLATE_AMBIGUOUS':
        return error.message;
      case 'CLIENT_OPERATION_NOT_FOUND':
        return 'No encontramos ese expediente.';
      case 'COMPANY_NOT_FOUND':
        return 'La empresa ya no está disponible.';
      case 'GENERATED_DOCUMENT_CONFLICT':
        return 'Este documento ya se generó con otros datos. Vuelve a intentarlo.';
      case 'DOCUMENT_RENDERER_UNAVAILABLE':
        return 'El servicio de documentos no está disponible. Inténtalo de nuevo.';
      case 'REQUEST_TIMEOUT':
        return 'La generación tardó demasiado. Inténtalo de nuevo.';
      case 'INVALID_RESPONSE':
        return 'La respuesta del servidor no se pudo leer. Inténtalo de nuevo.';
      default:
        return error.message || 'Algo salió mal. Inténtalo de nuevo.';
    }
  }
  return 'Algo salió mal. Inténtalo de nuevo.';
}
