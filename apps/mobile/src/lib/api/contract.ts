// View models for the mobile app. HTTP modules validate the wire JSON and map it onto these types.
// Screens keep these names (kind, brand, registration, …). Server names stay in the mappers.

import type { AuthCallbackParams } from './http/auth-callback';

export interface SessionSummary {
  accountId: string;
}

export type AccessRole = 'superadmin' | 'member';
export type AccessStatus = 'active' | 'pending';
export type CaseStatus = 'solicitud' | 'en_proceso' | 'firma' | 'desembolso' | 'cerrado';
export const CASE_STATUSES: readonly CaseStatus[] = ['solicitud', 'en_proceso', 'firma', 'desembolso', 'cerrado'];
export type DocumentFormat = 'pdf' | 'docx';

export interface CompanyAccess {
  id: string;
  name: string;
}

export interface Me {
  id: string;
  email: string | null;
  role: AccessRole;
  access: AccessStatus;
  companies: CompanyAccess[];
  overdue_company_ids: string[];
  can_manage_billing: boolean;
  billing_company_ids: string[];
  manageable_overdue_company_ids: string[];
}

// Read model is the directory subset. email, income_source, profile and updated_at are validated on the wire and not copied here.
export interface Client {
  id: string;
  name: string;
  identity: string | null;
  phone: string | null;
  address: string | null;
  created_at: string;
}

export interface ClientReference {
  name: string | null;
  phone: string | null;
  address: string | null;
  relationship: string | null;
}

export interface ClientSpouse {
  name: string | null;
  identity: string | null;
  phone: string | null;
  employer: string | null;
  employment_duration: string | null;
  position: string | null;
  address: string | null;
  work_phone: string | null;
}

export interface ClientProfile {
  treatment: string | null;
  nationality: string | null;
  marital_status: string | null;
  spouse_not_applicable: boolean | null;
  owns_home: boolean | null;
  rents_home: boolean | null;
  owns_vehicle: boolean | null;
  employer: string | null;
  work_address: string | null;
  work_phone: string | null;
  position: string | null;
  employment_duration: string | null;
  fixed_income: string | null;
  other_income: string | null;
  other_income_source: string | null;
  pay_days: string | null;
  spouse: ClientSpouse | null;
  family_references: ClientReference[];
  personal_references: ClientReference[];
}

// Blanks are null. The server rejects unknown keys, so this is the whole write body.
export interface ClientWrite {
  name: string;
  identity: string | null;
  phone: string | null;
  address: string | null;
  email: string | null;
  income_source: string | null;
  profile: ClientProfile | null;
}

export interface ClientListParams {
  q?: string;
  page: number;
  perPage: number;
}

export interface ClientPage {
  items: Client[];
  total: number;
  page: number;
  per_page: number;
}

export interface Vehicle {
  kind: string | null;
  brand: string | null;
  model: string | null;
  year: string | null;
  color: string | null;
  registration: string | null;
  plate: string | null;
  chassis: string | null;
  engine: string | null;
}

// Row from GET /expedientes. Amounts and the request date live only on the detail.
export interface CaseListItem {
  id: string;
  client_id: string;
  client_name: string;
  client_identity: string | null;
  company_id: string;
  company_name: string;
  reference: string | null;
  contract_date: string | null;
  status: CaseStatus;
  vehicle: Vehicle;
  created_at: string;
}

export interface Case extends CaseListItem {
  request_date: string;
  signature_date: string | null;
  requested_amount_minor: number | null;
  insurance_installment_minor: number | null;
  insurance_paid: boolean;
  installment_minor: number | null;
  installments_count: number | null;
  updated_at: string;
}

export interface CasePage {
  items: CaseListItem[];
  total: number;
  page: number;
  per_page: number;
}

export interface Dashboard {
  time_saved_minutes: number;
  documents_total: number;
  unsigned_cases: number;
  pending_disbursement_cases: number;
  disbursed_cases: number;
  disbursed_this_month: number;
  recent_cases: CaseListItem[];
  status_counts: Record<CaseStatus, number>;
}

export interface Payment {
  date: string;
  amount_minor: number;
}

// Subset of OperationWrite the intake wizard sends. reference is omitted so the server assigns one.
// monthly_plan is not part of this body.
export interface CaseFinancing {
  interest_installments: Payment[];
  final_principal: Payment;
  extraordinary_payments: Payment[];
  extraordinary_from_signature: boolean;
  extraordinary_payment_count: number | null;
  insurance_installment_count: number | null;
}

export interface CaseWrite {
  company_id: string;
  application: {
    application_date: string;
    requested_amount_minor: number;
  };
  signature_date: string;
  contract_date?: string | null;
  insurance_installment_minor: number | null;
  insurance_paid: boolean;
  vehicle: Vehicle;
  financing: CaseFinancing;
}

export type CaseDocumentType =
  | 'venta_condicional'
  | 'venta_condicional_seguro'
  | 'pagare_autentico'
  | 'entrega_voluntaria'
  | 'acto_seguro'
  | 'pagare_seguro'
  | 'declaracion_jurada'
  | 'gps'
  | 'autorizacion_data'
  | 'acuerdo_seguro'
  | 'autorizacion_asegurar_vehiculo'
  | 'autorizacion_desembolso'
  | 'designacion_cuenta'
  | 'levantamiento_oposicion'
  | 'entrega_vehiculo'
  | 'entrega_vehiculo_fines_saldo'
  | 'entrega_documentos'
  | 'carta_saldo';

export type DocumentAvailabilityStatus = 'ready' | 'ambiguous' | 'missing';

export interface TemplateCandidate {
  contract_id: string;
  name: string;
}

export interface LatestGeneratedDocument {
  id: string;
  created_at: string;
  format: DocumentFormat | 'email';
}

export type OperatorFieldKind = 'text' | 'money' | 'date';

export interface OperatorField {
  key: string;
  label: string;
  kind: OperatorFieldKind;
  required: boolean;
}

export interface AvailableDocument {
  document_type: CaseDocumentType;
  status: DocumentAvailabilityStatus;
  candidates: TemplateCandidate[];
  latest_generated: LatestGeneratedDocument | null;
  operator_fields: OperatorField[];
}

export interface GenerateDocumentBody {
  company_id: string;
  document_type: CaseDocumentType;
  format: DocumentFormat;
  contract_id?: string | null;
  operator_values?: Record<string, string>;
}

export interface DocumentCompany {
  id: string;
  name: string;
  values: Record<string, string>;
}

export interface DocumentMetadata {
  id: string;
  document_type: string | null;
  contract_id: string;
  contract_name: string;
  format: DocumentFormat;
  filename: string;
  created_at: string;
  operation_id: string | null;
  has_artifact: boolean;
  company: DocumentCompany | null;
}

export interface DocumentPage {
  items: DocumentMetadata[];
  total: number;
  page: number;
  per_page: number;
}

// Binary artifact already written under the cache directory. Share `uri`; there is no inline body.
export interface Artifact {
  filename: string;
  mime_type: string;
  uri: string;
}

export interface TimelineEvent {
  id: string;
  occurred_at: string;
  title: string;
  detail: string | null;
}

export interface TimelinePage {
  items: TimelineEvent[];
  total: number;
  page: number;
  per_page: number;
}

export interface CaseListParams {
  companyId: string;
  q?: string;
  status?: CaseStatus;
  page: number;
  perPage: number;
}

export interface YzyApi {
  auth: {
    currentSession(): Promise<SessionSummary | null>;
    sendMagicLink(email: string): Promise<void>;
    completeCallback(params: AuthCallbackParams): Promise<void>;
    signInWithGoogle(): Promise<void>;
    signOut(): Promise<void>;
    onChange(listener: (session: SessionSummary | null) => void): () => void;
    setForeground(active: boolean): Promise<void>;
  };
  me: { get(): Promise<Me> };
  dashboard: { get(companyId: string): Promise<Dashboard> };
  cases: {
    list(params: CaseListParams): Promise<CasePage>;
    get(id: string, companies: readonly CompanyAccess[]): Promise<Case>;
    create(clientId: string, body: CaseWrite, companies: readonly CompanyAccess[]): Promise<Case>;
    updateStatus(params: {
      companyId: string;
      clientId: string;
      operationId: string;
      status: CaseStatus;
      companies: readonly CompanyAccess[];
    }): Promise<Case>;
    timeline(params: { clientId: string; operationId: string; page: number; perPage: number }): Promise<TimelinePage>;
    documents(params: { operationId: string; page: number; perPage: number }): Promise<DocumentPage>;
    availableDocuments(params: { caseId: string; companyId: string }): Promise<AvailableDocument[]>;
    generateDocument(params: {
      caseId: string;
      documentId: string;
      body: GenerateDocumentBody;
    }): Promise<DocumentMetadata>;
    artifact(documentId: string): Promise<Artifact>;
    // Word documents only: the API renders the saved file as a PDF and the client caches it like an artifact.
    renderPdf(documentId: string, sourceFilename: string): Promise<Artifact>;
  };
  clients: {
    list(params: ClientListParams): Promise<ClientPage>;
    get(id: string): Promise<Client>;
    create(body: ClientWrite): Promise<Client>;
  };
}
