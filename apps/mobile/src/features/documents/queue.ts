import { z } from 'zod';
import {
  ApiError,
  isApiError,
  type CaseDocumentType,
  type DocumentFormat,
  type DocumentMetadata,
  type TemplateCandidate,
} from '../../lib/api';
import { messageFor } from '../../shared/errors/messages';

// Document generation queue (plan section 5.2 and 8): one PUT per document, sequential,
// idempotent document_id per item. A 402 stops the queue; other errors are per document.

export type ItemState = 'idle' | 'running' | 'done' | 'failed' | 'blocked' | 'needs_template';

export interface QueueItem {
  documentType: CaseDocumentType;
  label: string;
  documentId: string;
  contractId: string | null;
  operatorValues?: Record<string, string>;
  state: ItemState;
  message: string | null;
  candidates: TemplateCandidate[];
  metadata: DocumentMetadata | null;
  needsFreshId?: boolean;
}

export type GenerateOne = (input: {
  documentId: string;
  documentType: CaseDocumentType;
  format: DocumentFormat;
  contractId: string | null;
  operatorValues?: Record<string, string>;
}) => Promise<DocumentMetadata>;

const ambiguousDetails = z.object({
  candidates: z.array(z.object({ contract_id: z.string(), name: z.string() })),
});

const RETRIABLE = new Set(['DOCUMENT_RENDERER_UNAVAILABLE', 'REQUEST_TIMEOUT', 'NETWORK_ERROR']);

export function isRunnable(item: QueueItem): boolean {
  return item.state !== 'done';
}

// Runs every runnable item in order. Returns the items with their final states.
export async function runQueue(
  items: readonly QueueItem[],
  format: DocumentFormat,
  generate: GenerateOne,
  onUpdate: (items: QueueItem[]) => void,
): Promise<QueueItem[]> {
  const current = items.map((item) => ({ ...item }));
  const emit = () => onUpdate(current.map((item) => ({ ...item })));
  let billingStopped = false;

  for (let index = 0; index < current.length; index += 1) {
    const item = current[index];
    if (!item || !isRunnable(item)) continue;

    if (billingStopped) {
      current[index] = { ...item, state: 'blocked', message: 'Bloqueado por facturación. No se generó.' };
      continue;
    }

    current[index] = { ...item, state: 'running', message: null, needsFreshId: false };
    emit();

    try {
      const metadata = await generate({
        documentId: item.documentId,
        documentType: item.documentType,
        format,
        contractId: item.contractId,
        ...(item.operatorValues ? { operatorValues: item.operatorValues } : {}),
      });
      current[index] = { ...item, state: 'done', metadata, message: null, needsFreshId: false };
    } catch (error) {
      current[index] = applyError(item, error);
      if (isApiError(error) && error.status === 402) billingStopped = true;
    }
    emit();
  }
  return current;
}

function applyError(item: QueueItem, error: unknown): QueueItem {
  if (isApiError(error)) {
    if (error.status === 402) {
      return { ...item, state: 'blocked', message: 'Bloqueado por facturación. No se generó.' };
    }
    if (error.code === 'DOCUMENT_TEMPLATE_AMBIGUOUS') {
      const parsed = ambiguousDetails.safeParse(error.details);
      const candidates = parsed.success ? parsed.data.candidates : [];
      return { ...item, state: 'needs_template', candidates, message: 'Elige la plantilla para este documento.' };
    }
    if (error.code === 'GENERATED_DOCUMENT_CONFLICT') {
      return { ...item, state: 'failed', needsFreshId: true, message: messageFor(error) };
    }
    return {
      ...item,
      state: 'failed',
      message: RETRIABLE.has(error.code) ? 'No se pudo generar. Puedes reintentarlo.' : messageFor(error),
    };
  }
  return { ...item, state: 'failed', message: 'No se pudo generar. Puedes reintentarlo.' };
}

export function isBillingError(error: unknown): boolean {
  return error instanceof ApiError && error.status === 402;
}
