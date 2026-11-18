import type {
  Artifact,
  AvailableDocument,
  Case,
  CasePage,
  DocumentMetadata,
  DocumentPage,
  TimelinePage,
  YzyApi,
} from '../contract';
import { ApiError } from '../errors';
import { filenameFromContentDisposition, mimeFromContentType, writeArtifactCache } from './artifact-cache';
import type { ApiClient } from './client';
import { toQuery } from './client';
import { caseWriteToWire, companyNameFrom, mapCaseListItem, mapOperation } from './map-case';
import { toTimelineEvent } from './timeline-text';
import {
  availableDocumentsSchema,
  casePageSchema,
  clientSchema,
  documentMetadataSchema,
  documentPageSchema,
  operationSchema,
  timelinePageSchema,
  type DocumentWire,
} from './wire-schema';

function segment(value: string): string {
  return encodeURIComponent(value);
}

function mapDocument(document: DocumentWire): DocumentMetadata | null {
  if (document.format === 'email') return null;
  return {
    id: document.id,
    document_type: document.document_type,
    contract_id: document.contract_id,
    contract_name: document.contract_name,
    format: document.format,
    filename: document.filename,
    created_at: document.created_at,
    operation_id: document.operation_id,
    has_artifact: document.has_artifact,
    company: document.company ?? null,
  };
}

export function createHttpCasesApi(http: ApiClient): YzyApi['cases'] {
  async function loadCase(operationId: string, companies: Parameters<YzyApi['cases']['get']>[1]): Promise<Case> {
    const operation = await http.json(`/expedientes/${segment(operationId)}`, operationSchema);
    const client = await http.json(`/clients/${segment(operation.client_id)}`, clientSchema);
    return mapOperation(operation, client, companyNameFrom(companies, operation.company_id));
  }

  return {
    async list(params): Promise<CasePage> {
      const page = await http.json(
        `/expedientes${toQuery([
          ['company_id', params.companyId],
          ['page', params.page],
          ['per_page', params.perPage],
          ['q', params.q],
          ['status', params.status],
        ])}`,
        casePageSchema,
      );
      return {
        items: page.items.map(mapCaseListItem),
        total: page.total,
        page: page.page,
        per_page: page.per_page,
      };
    },

    get(id, companies) {
      return loadCase(id, companies);
    },

    async create(clientId, body, companies) {
      const operation = await http.json(`/clients/${segment(clientId)}/operations`, operationSchema, {
        method: 'POST',
        body: caseWriteToWire(body),
      });
      const client = await http.json(`/clients/${segment(operation.client_id)}`, clientSchema);
      return mapOperation(operation, client, companyNameFrom(companies, operation.company_id));
    },

    async updateStatus(params) {
      const operation = await http.json(
        `/companies/${segment(params.companyId)}/clients/${segment(params.clientId)}/operations/${segment(params.operationId)}`,
        operationSchema,
        { method: 'PATCH', body: { status: params.status } },
      );
      const client = await http.json(`/clients/${segment(operation.client_id)}`, clientSchema);
      return mapOperation(operation, client, companyNameFrom(params.companies, operation.company_id));
    },

    async timeline(params): Promise<TimelinePage> {
      const page = await http.json(
        `/clients/${segment(params.clientId)}/timeline${toQuery([
          ['operation_id', params.operationId],
          ['page', params.page],
          ['per_page', params.perPage],
        ])}`,
        timelinePageSchema,
      );
      return {
        items: page.items.map(toTimelineEvent),
        total: page.total,
        page: page.page,
        per_page: page.per_page,
      };
    },

    // Email rows are not files the case screen can share. total stays the server total, which still counts them.
    async documents(params): Promise<DocumentPage> {
      const page = await http.json(
        `/generated-documents${toQuery([
          ['operation_id', params.operationId],
          ['page', params.page],
          ['per_page', params.perPage],
        ])}`,
        documentPageSchema,
      );
      return {
        items: page.items.flatMap((item) => {
          const mapped = mapDocument(item);
          return mapped ? [mapped] : [];
        }),
        total: page.total,
        page: page.page,
        per_page: page.per_page,
      };
    },

    async availableDocuments(params): Promise<AvailableDocument[]> {
      return http.json(
        `/expedientes/${segment(params.caseId)}/available-documents${toQuery([['company_id', params.companyId]])}`,
        availableDocumentsSchema,
      );
    },

    async generateDocument(params): Promise<DocumentMetadata> {
      const generated = await http.json(
        `/expedientes/${segment(params.caseId)}/documents/${segment(params.documentId)}`,
        documentMetadataSchema,
        { method: 'PUT', body: params.body },
      );
      const mapped = mapDocument(generated);
      if (!mapped) throw new ApiError(200, 'INVALID_RESPONSE', 'Respuesta inesperada del servidor.');
      return mapped;
    },

    async artifact(documentId: string): Promise<Artifact> {
      const downloaded = await http.binary(`/generated-documents/${segment(documentId)}/artifact`);
      if (!downloaded.contentType || !downloaded.contentDisposition) {
        throw new ApiError(200, 'INVALID_RESPONSE', 'Respuesta inesperada del servidor.');
      }
      const filename = filenameFromContentDisposition(downloaded.contentDisposition);
      const mimeType = mimeFromContentType(downloaded.contentType);
      const stored = await writeArtifactCache(filename, downloaded.bytes);
      return { filename: stored.filename, mime_type: mimeType, uri: stored.uri };
    },
  };
}
