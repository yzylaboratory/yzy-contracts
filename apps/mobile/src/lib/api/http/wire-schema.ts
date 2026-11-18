import { z } from 'zod';

export const isoDate = z.iso.date();
// RFC 3339: chrono emits `Z`, some serializers emit a numeric offset.
export const isoDateTime = z.iso.datetime({ offset: true });

const whole = z.number().int().nonnegative();
const money = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);
const positiveMoney = z.number().int().min(1).max(Number.MAX_SAFE_INTEGER);

export const operationStatusSchema = z.enum(['solicitud', 'en_proceso', 'firma', 'desembolso', 'cerrado']);

export const serverVehicleSchema = z.object({
  vehicle_type: z.string().nullable().optional(),
  make: z.string().nullable().optional(),
  model: z.string().nullable().optional(),
  year: z.string().nullable().optional(),
  color: z.string().nullable().optional(),
  registration_number: z.string().nullable().optional(),
  plate: z.string().nullable().optional(),
  chassis_number: z.string().nullable().optional(),
  engine_number: z.string().nullable().optional(),
  source_document: z.enum(['vehicle_registration', 'bill_of_lading']).nullable().optional(),
});

export const paymentSchema = z.object({
  date: isoDate,
  amount_minor: money,
});

export const financingSchema = z.object({
  interest_installments: z.array(paymentSchema),
  final_principal: paymentSchema,
  extraordinary_payments: z.array(paymentSchema),
  extraordinary_from_signature: z.boolean().optional(),
  extraordinary_payment_count: z.number().int().nonnegative().max(299).nullable().optional(),
  insurance_installment_count: positiveMoney.nullable().optional(),
  monthly_plan: z
    .object({
      capital_minor: positiveMoney,
      monthly_rate_basis_points: positiveMoney,
      installment_count: z.number().int().min(1).max(1200),
    })
    .nullable()
    .optional(),
});

// Only the fields the case view reads. The rest of CaseApplication is stripped.
const applicationObjectSchema = z.object({
  application_date: isoDate.nullable().optional(),
  requested_amount_minor: positiveMoney.nullable().optional(),
});

export const operationSchema = z.object({
  id: z.uuid(),
  company_id: z.uuid(),
  client_id: z.uuid(),
  contract_id: z.uuid().nullable(),
  reference: z.string().nullable(),
  status: operationStatusSchema,
  contract_date: isoDate.nullable(),
  signature_date: isoDate.nullable(),
  insurance_installment_minor: positiveMoney.nullable(),
  insurance_paid: z.boolean(),
  vehicle: serverVehicleSchema,
  application: applicationObjectSchema.nullish(),
  financing: financingSchema.nullable(),
  created_at: isoDateTime,
  updated_at: isoDateTime,
});

export const caseListItemSchema = z.object({
  id: z.uuid(),
  client_id: z.uuid(),
  client_name: z.string(),
  client_identity: z.string().nullable(),
  company_id: z.uuid(),
  company_name: z.string(),
  reference: z.string().nullable(),
  contract_date: isoDate.nullable(),
  status: operationStatusSchema,
  vehicle: serverVehicleSchema,
  created_at: isoDateTime,
});

export function pageSchema<T extends z.ZodType>(item: T) {
  return z.object({
    items: z.array(item),
    total: whole,
    page: z.number().int().positive(),
    per_page: z.number().int().positive(),
  });
}

export const casePageSchema = pageSchema(caseListItemSchema);

const referenceSchema = z.object({
  name: z.string().nullable().optional(),
  phone: z.string().nullable().optional(),
  address: z.string().nullable().optional(),
  relationship: z.string().nullable().optional(),
});

const spouseSchema = z.object({
  name: z.string().nullable().optional(),
  identity: z.string().nullable().optional(),
  phone: z.string().nullable().optional(),
  employer: z.string().nullable().optional(),
  employment_duration: z.string().nullable().optional(),
  position: z.string().nullable().optional(),
  address: z.string().nullable().optional(),
  work_phone: z.string().nullable().optional(),
});

// Fields without skip_serializing_if are always present (null when empty).
const clientProfileSchema = z.object({
  treatment: z.string().nullable().optional(),
  nationality: z.string().nullable().optional(),
  marital_status: z.string().nullable().optional(),
  spouse_not_applicable: z.boolean().nullable().optional(),
  owns_home: z.boolean().nullable(),
  rents_home: z.boolean().nullable(),
  owns_vehicle: z.boolean().nullable(),
  employer: z.string().nullable(),
  work_address: z.string().nullable(),
  work_phone: z.string().nullable(),
  position: z.string().nullable(),
  employment_duration: z.string().nullable(),
  fixed_income: z.string().nullable(),
  other_income: z.string().nullable(),
  other_income_source: z.string().nullable(),
  pay_days: z.string().nullable(),
  spouse: spouseSchema.nullable(),
  family_references: z.array(referenceSchema),
  personal_references: z.array(referenceSchema),
});

export const clientSchema = z.object({
  id: z.uuid(),
  name: z.string(),
  identity: z.string().nullable(),
  address: z.string().nullable(),
  phone: z.string().nullable(),
  email: z.string().nullable(),
  income_source: z.string().nullable(),
  profile: clientProfileSchema.nullish(),
  created_at: isoDateTime,
  updated_at: isoDateTime,
});

export const clientPageSchema = pageSchema(clientSchema);

const dashboardCaseSchema = z.object({
  id: z.uuid(),
  client_id: z.uuid(),
  client_name: z.string(),
  reference: z.string().nullable(),
  status: operationStatusSchema,
  created_at: isoDateTime,
  has_payment_plan: z.boolean(),
  actor_name: z.string().nullable().optional(),
});

export const workspaceDashboardSchema = z.object({
  clients_total: whole,
  cases_total: whole,
  cases_this_month: whole,
  cases_without_plan: whole,
  unsigned_cases: whole,
  pending_disbursement_cases: whole,
  disbursed_cases: whole,
  disbursed_this_month: whole,
  documents_total: whole,
  documents_this_month: whole,
  time_saved_minutes: whole,
  user_time_saved_minutes: whole,
  user_disbursements_total: whole,
  user_documents_total: whole,
  status_counts: z.object({
    solicitud: whole,
    en_proceso: whole,
    firma: whole,
    desembolso: whole,
    cerrado: whole,
  }),
  user_stats: z.array(
    z.object({
      user_id: z.uuid(),
      user_name: z.string(),
      is_current_user: z.boolean(),
      disbursements_total: whole,
      unsigned_cases: whole,
      pending_disbursement_cases: whole,
      cases_total: whole,
      documents_total: whole,
      time_saved_minutes: whole,
    }),
  ),
  months: z.array(z.object({ month: z.string(), total: whole })),
  formats: z.object({ pdf: whole, docx: whole, email: whole }),
  recent_cases: z.array(dashboardCaseSchema),
});

export const documentMetadataSchema = z.object({
  id: z.uuid(),
  contract_id: z.uuid(),
  contract_name: z.string(),
  format: z.enum(['pdf', 'docx', 'email']),
  filename: z.string(),
  created_at: isoDateTime,
  has_artifact: z.boolean(),
  document_type: z.string().nullable(),
  operation_id: z.uuid().nullable(),
  company: z
    .object({
      id: z.uuid(),
      name: z.string(),
      values: z.record(z.string(), z.string()),
    })
    .nullable()
    .optional(),
});

export const documentPageSchema = pageSchema(documentMetadataSchema);

export const caseDocumentTypeSchema = z.enum([
  'venta_condicional',
  'venta_condicional_seguro',
  'pagare_autentico',
  'entrega_voluntaria',
  'acto_seguro',
  'pagare_seguro',
  'declaracion_jurada',
  'gps',
  'autorizacion_data',
  'acuerdo_seguro',
  'autorizacion_asegurar_vehiculo',
  'autorizacion_desembolso',
  'designacion_cuenta',
  'levantamiento_oposicion',
  'entrega_vehiculo',
  'entrega_vehiculo_fines_saldo',
  'entrega_documentos',
  'carta_saldo',
]);

export const templateCandidateSchema = z.object({
  contract_id: z.uuid(),
  name: z.string(),
});

export const latestGeneratedDocumentSchema = z.object({
  id: z.uuid(),
  created_at: isoDateTime,
  format: z.enum(['pdf', 'docx', 'email']),
});

export const operatorFieldSchema = z.object({
  key: z.string(),
  label: z.string(),
  kind: z.enum(['text', 'money', 'date']),
  required: z.boolean(),
});

export const availableDocumentSchema = z.object({
  document_type: caseDocumentTypeSchema,
  status: z.enum(['ready', 'ambiguous', 'missing']),
  candidates: z.array(templateCandidateSchema),
  latest_generated: latestGeneratedDocumentSchema.nullable(),
  operator_fields: z.array(operatorFieldSchema),
});

export const availableDocumentsSchema = z.array(availableDocumentSchema);

export type JsonValue = string | number | boolean | null | JsonValue[] | { [key: string]: JsonValue };

export const jsonValueSchema: z.ZodType<JsonValue> = z.lazy(() =>
  z.union([
    z.string(),
    z.number(),
    z.boolean(),
    z.null(),
    z.array(jsonValueSchema),
    z.record(z.string(), jsonValueSchema),
  ]),
);

export const timelineEventSchema = z.object({
  id: z.uuid(),
  kind: z.enum([
    'client_created',
    'client_updated',
    'operation_created',
    'operation_updated',
    'document_generated',
  ]),
  occurred_at: isoDateTime,
  operation_label: z.string().nullable(),
  document_name: z.string().nullable(),
  actor_name: z.string().nullable(),
  changes: z.array(
    z.object({
      field: z.string(),
      before: jsonValueSchema,
      after: jsonValueSchema,
    }),
  ),
});

export const timelinePageSchema = pageSchema(timelineEventSchema);

export type OperationWire = z.output<typeof operationSchema>;
export type CaseListItemWire = z.output<typeof caseListItemSchema>;
export type ClientWire = z.output<typeof clientSchema>;
export type TimelineEventWire = z.output<typeof timelineEventSchema>;
export type DocumentWire = z.output<typeof documentMetadataSchema>;
