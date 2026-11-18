import { ApiError, type CaseDocumentType, type DocumentMetadata } from '../../../lib/api';
import { type GenerateOne, type QueueItem, runQueue } from '../queue';

function item(
  documentType: CaseDocumentType,
  documentId: string,
  operatorValues?: Record<string, string>,
): QueueItem {
  return {
    documentType,
    label: documentType,
    documentId,
    contractId: null,
    ...(operatorValues ? { operatorValues } : {}),
    state: 'idle',
    message: null,
    candidates: [],
    metadata: null,
  };
}

function metadataFor(documentId: string, documentType: CaseDocumentType): DocumentMetadata {
  return {
    id: documentId,
    document_type: documentType,
    contract_id: 'tpl',
    contract_name: 'Plantilla',
    format: 'pdf',
    filename: `${documentType}.pdf`,
    created_at: '2026-11-16T15:00:00Z',
    operation_id: 'op',
    has_artifact: true,
    company: null,
  };
}

describe('runQueue', () => {
  it('generates every item in order and forwards operatorValues', async () => {
    const calls: { documentType: CaseDocumentType; operatorValues?: Record<string, string> }[] = [];
    const generate: GenerateOne = async ({ documentId, documentType, operatorValues }) => {
      calls.push({ documentType, operatorValues });
      return metadataFor(documentId, documentType);
    };
    const result = await runQueue(
      [
        item('venta_condicional', '1'),
        item('carta_saldo', '2', { saldo_confirmado: 'RD$10,000.00', fecha_saldo: '2026-11-18' }),
      ],
      'pdf',
      generate,
      () => undefined,
    );
    expect(calls).toEqual([
      { documentType: 'venta_condicional', operatorValues: undefined },
      { documentType: 'carta_saldo', operatorValues: { saldo_confirmado: 'RD$10,000.00', fecha_saldo: '2026-11-18' } },
    ]);
    expect(result.map((r) => r.state)).toEqual(['done', 'done']);
  });

  it('stops on 402 and blocks the remaining documents', async () => {
    const generate: GenerateOne = async ({ documentId, documentType }) => {
      if (documentType === 'pagare_autentico') throw new ApiError(402, 'PAYMENT_REQUIRED', 'Facturación');
      return metadataFor(documentId, documentType);
    };
    const result = await runQueue(
      [item('venta_condicional', '1'), item('pagare_autentico', '2'), item('gps', '3')],
      'pdf',
      generate,
      () => undefined,
    );
    expect(result.map((r) => r.state)).toEqual(['done', 'blocked', 'blocked']);
  });

  it('asks for a template on an ambiguous 422 and keeps going', async () => {
    const generate: GenerateOne = async ({ documentId, documentType, contractId }) => {
      if (documentType === 'venta_condicional' && !contractId) {
        throw new ApiError(422, 'DOCUMENT_TEMPLATE_AMBIGUOUS', 'Varias', {
          candidates: [
            { contract_id: 'x', name: 'X' },
            { contract_id: 'y', name: 'Y' },
          ],
        });
      }
      return metadataFor(documentId, documentType);
    };
    const result = await runQueue(
      [item('venta_condicional', '1'), item('pagare_autentico', '2')],
      'pdf',
      generate,
      () => undefined,
    );
    expect(result[0]?.state).toBe('needs_template');
    expect(result[0]?.candidates).toHaveLength(2);
    expect(result[1]?.state).toBe('done');
  });

  it('keeps the same document id on a retry after a timeout (idempotent PUT)', async () => {
    const seen: string[] = [];
    let attempt = 0;
    const generate: GenerateOne = async ({ documentId, documentType }) => {
      seen.push(documentId);
      attempt += 1;
      if (attempt === 1) throw new ApiError(504, 'REQUEST_TIMEOUT', 'Tiempo agotado');
      return metadataFor(documentId, documentType);
    };
    const first = await runQueue([item('venta_condicional', 'fixed-id')], 'pdf', generate, () => undefined);
    expect(first[0]?.state).toBe('failed');
    const second = await runQueue(first, 'pdf', generate, () => undefined);
    expect(second[0]?.state).toBe('done');
    expect(seen).toEqual(['fixed-id', 'fixed-id']);
  });

  it('marks 409 conflict as needing a fresh id and shows the Spanish validation message on 422', async () => {
    const generate: GenerateOne = async ({ documentType }) => {
      if (documentType === 'venta_condicional') {
        throw new ApiError(409, 'GENERATED_DOCUMENT_CONFLICT', 'This generated document ID is already in use.');
      }
      throw new ApiError(422, 'VALIDATION_ERROR', 'Indica la distribución del desembolso.');
    };

    const result = await runQueue(
      [item('venta_condicional', 'id-1'), item('autorizacion_desembolso', 'id-2')],
      'docx',
      generate,
      () => undefined,
    );
    expect(result[0]?.state).toBe('failed');
    expect(result[0]?.needsFreshId).toBe(true);
    expect(result[0]?.message).toBe('Este documento ya se generó con otros datos. Vuelve a intentarlo.');
    expect(result[1]?.state).toBe('failed');
    expect(result[1]?.needsFreshId).toBeUndefined();
    expect(result[1]?.message).toBe('Indica la distribución del desembolso.');
  });

  it('does not rerun items already done', async () => {
    const generate = jest.fn<ReturnType<GenerateOne>, Parameters<GenerateOne>>(async ({ documentId, documentType }) =>
      metadataFor(documentId, documentType),
    );
    const done: QueueItem = {
      ...item('venta_condicional', '1'),
      state: 'done',
      metadata: metadataFor('1', 'venta_condicional'),
    };
    await runQueue([done, item('pagare_autentico', '2')], 'pdf', generate, () => undefined);
    expect(generate).toHaveBeenCalledTimes(1);
  });
});
