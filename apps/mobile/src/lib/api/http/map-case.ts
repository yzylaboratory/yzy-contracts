import type { Case, CaseFinancing, CaseListItem, CaseWrite, CompanyAccess, Vehicle } from '../contract';
import { ApiError } from '../errors';
import type { CaseListItemWire, ClientWire, OperationWire } from './wire-schema';

export function mapVehicle(vehicle: OperationWire['vehicle']): Vehicle {
  return {
    kind: vehicle.vehicle_type ?? null,
    brand: vehicle.make ?? null,
    model: vehicle.model ?? null,
    year: vehicle.year ?? null,
    color: vehicle.color ?? null,
    registration: vehicle.registration_number ?? null,
    plate: vehicle.plate ?? null,
    chassis: vehicle.chassis_number ?? null,
    engine: vehicle.engine_number ?? null,
  };
}

export function vehicleToWire(vehicle: Vehicle): Record<string, string | null> {
  return {
    vehicle_type: vehicle.kind,
    make: vehicle.brand,
    model: vehicle.model,
    year: vehicle.year,
    color: vehicle.color,
    registration_number: vehicle.registration,
    plate: vehicle.plate,
    chassis_number: vehicle.chassis,
    engine_number: vehicle.engine,
  };
}

export function caseWriteToWire(body: CaseWrite): Record<string, unknown> {
  const financing: CaseFinancing = body.financing;
  const wire: Record<string, unknown> = {
    company_id: body.company_id,
    application: {
      application_date: body.application.application_date,
      requested_amount_minor: body.application.requested_amount_minor,
    },
    signature_date: body.signature_date,
    insurance_installment_minor: body.insurance_installment_minor,
    insurance_paid: body.insurance_paid,
    vehicle: vehicleToWire(body.vehicle),
    financing: {
      interest_installments: financing.interest_installments,
      final_principal: financing.final_principal,
      extraordinary_payments: financing.extraordinary_payments,
      extraordinary_from_signature: financing.extraordinary_from_signature,
      extraordinary_payment_count: financing.extraordinary_payment_count,
      insurance_installment_count: financing.insurance_installment_count,
    },
  };
  if (body.contract_date !== undefined) wire.contract_date = body.contract_date;
  return wire;
}

export function companyNameFrom(companies: readonly CompanyAccess[], companyId: string): string {
  const company = companies.find((item) => item.id === companyId);
  if (!company) throw new ApiError(404, 'COMPANY_NOT_FOUND', 'La empresa ya no está disponible.');
  return company.name;
}

export function mapCaseListItem(item: CaseListItemWire): CaseListItem {
  return {
    id: item.id,
    client_id: item.client_id,
    client_name: item.client_name,
    client_identity: item.client_identity,
    company_id: item.company_id,
    company_name: item.company_name,
    reference: item.reference,
    contract_date: item.contract_date,
    status: item.status,
    vehicle: mapVehicle(item.vehicle),
    created_at: item.created_at,
  };
}

function requestDate(operation: OperationWire): string {
  const fromApplication = operation.application?.application_date;
  if (fromApplication) return fromApplication;
  return operation.created_at.slice(0, 10);
}

function installmentFields(financing: OperationWire['financing']): {
  installment_minor: number | null;
  installments_count: number | null;
} {
  if (!financing) return { installment_minor: null, installments_count: null };
  return {
    installment_minor: financing.interest_installments[0]?.amount_minor ?? null,
    installments_count: financing.interest_installments.length + 1,
  };
}

// client_name and client_identity come from GET /clients/{id}. company_name comes from the caller's company list.
export function mapOperation(operation: OperationWire, client: ClientWire, companyName: string): Case {
  const installments = installmentFields(operation.financing);
  return {
    id: operation.id,
    client_id: operation.client_id,
    client_name: client.name,
    client_identity: client.identity,
    company_id: operation.company_id,
    company_name: companyName,
    reference: operation.reference,
    contract_date: operation.contract_date,
    status: operation.status,
    vehicle: mapVehicle(operation.vehicle),
    created_at: operation.created_at,
    request_date: requestDate(operation),
    signature_date: operation.signature_date,
    requested_amount_minor: operation.application?.requested_amount_minor ?? null,
    insurance_installment_minor: operation.insurance_installment_minor,
    insurance_paid: operation.insurance_paid,
    installment_minor: installments.installment_minor,
    installments_count: installments.installments_count,
    updated_at: operation.updated_at,
  };
}

export function mapClient(client: ClientWire) {
  return {
    id: client.id,
    name: client.name,
    identity: client.identity,
    phone: client.phone,
    address: client.address,
    created_at: client.created_at,
  };
}
