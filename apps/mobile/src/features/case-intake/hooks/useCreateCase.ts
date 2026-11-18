import { useMutation, useQueryClient } from '@tanstack/react-query';
import { api, type CaseFinancing, type CaseWrite, type Vehicle } from '../../../lib/api';
import { queryKeys } from '../../../lib/query/keys';
import { parseMoneyToMinor } from '../../../shared/format/money';
import { useGate } from '../../access';
import {
  buildIntakeFinancing,
  computeIntakeExtraordinaryState,
  maxMonthlyInstallments,
  parseAmountMinor,
  paymentDateAfterMonths,
  planFromInputs,
  validateMonthlyPayments,
  type Financing,
} from '../domain/payment-plan';
import { useCaseDraft, type DraftState, type VehicleDraft } from '../draft-store';
import { parseInsuranceInstallmentCount } from '../schemas';

export class CaseDraftError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'CaseDraftError';
  }
}

type DraftSnapshot = Pick<
  DraftState,
  | 'financing'
  | 'requestedAmount'
  | 'installmentRows'
  | 'signDate'
  | 'installment'
  | 'installmentsCount'
  | 'extraordinary'
  | 'extraordinaryCount'
> & {
  insurancePaid?: boolean;
  insuranceInstallmentCount?: string;
};

export type CaseDraftInput = Pick<
  DraftState,
  | 'client'
  | 'requestDate'
  | 'signDate'
  | 'requestedAmount'
  | 'insuranceInstallment'
  | 'insurancePaid'
  | 'installmentsCount'
  | 'installment'
  | 'installmentRows'
  | 'extraordinary'
  | 'extraordinaryCount'
  | 'financing'
  | 'vehicle'
> & {
  insuranceInstallmentCount?: string;
};

function resolvedInsuranceCount(
  insurancePaid: boolean | undefined,
  rawCount: string | undefined,
): number | null | undefined {
  if (insurancePaid) return null;
  if (rawCount === undefined || rawCount.trim() === '') return undefined;
  const parsed = parseInsuranceInstallmentCount(rawCount);
  if (parsed === null) {
    throw new CaseDraftError(`Indica un número entero entre 1 y ${maxMonthlyInstallments}.`);
  }
  return parsed;
}

// Uses the financing saved on the plan step, or rebuilds it with the same portal function.
export function resolveDraftFinancing(draft: DraftSnapshot): Financing | undefined {
  const insuranceCount =
    draft.insurancePaid === true
      ? null
      : draft.insuranceInstallmentCount !== undefined && draft.insuranceInstallmentCount.trim() !== ''
        ? parseInsuranceInstallmentCount(draft.insuranceInstallmentCount)
        : undefined;
  if (draft.financing) {
    return insuranceCount !== undefined
      ? { ...draft.financing, insurance_installment_count: insuranceCount }
      : draft.financing;
  }
  const capital = parseAmountMinor(draft.requestedAmount) ?? 0;
  const rows =
    draft.installmentRows.length > 0
      ? draft.installmentRows
      : planFromInputs(draft.signDate, capital, draft.installment, draft.installmentsCount).rows;
  const { errors, plan, totalError } = validateMonthlyPayments(
    rows,
    paymentDateAfterMonths(draft.signDate, maxMonthlyInstallments),
  );
  if (!plan || totalError) return undefined;
  const extraState = computeIntakeExtraordinaryState({
    signatureDate: draft.signDate,
    rows,
    rowErrors: errors,
    extraordinary: draft.extraordinary,
    extraordinaryCount: draft.extraordinaryCount,
  });
  if (!extraState.validExtras) return undefined;
  return buildIntakeFinancing(plan, extraState.extras, insuranceCount);
}

function blank(value: string): string | null {
  const trimmed = value.trim();
  return trimmed === '' ? null : trimmed;
}

function vehicleWrite(vehicle: VehicleDraft): Vehicle {
  return {
    kind: blank(vehicle.kind),
    brand: blank(vehicle.brand),
    model: blank(vehicle.model),
    year: blank(vehicle.year),
    color: blank(vehicle.color),
    registration: blank(vehicle.registration),
    plate: blank(vehicle.plate),
    chassis: blank(vehicle.chassis),
    engine: blank(vehicle.engine),
  };
}

function toCaseFinancing(
  financing: Financing,
  insurancePaid: boolean,
  insuranceCountOverride: number | null | undefined,
): CaseFinancing {
  return {
    interest_installments: financing.interest_installments,
    final_principal: financing.final_principal,
    extraordinary_payments: financing.extraordinary_payments,
    extraordinary_from_signature: financing.extraordinary_from_signature === true,
    extraordinary_payment_count: financing.extraordinary_payment_count ?? null,
    insurance_installment_count: insurancePaid
      ? null
      : (insuranceCountOverride ?? financing.insurance_installment_count ?? null),
  };
}

// OperationWrite subset. contract_date is omitted: the wizard does not collect it apart from the signature date.
export function buildCaseWrite(companyId: string, draft: CaseDraftInput): CaseWrite {
  if (!draft.client) throw new CaseDraftError('Falta el cliente.');
  if (!draft.signDate) {
    throw new CaseDraftError('Indica la fecha de firma en la solicitud para calcular el calendario de cuotas.');
  }
  const requested = parseMoneyToMinor(draft.requestedAmount);
  if (requested === null || requested < 1) throw new CaseDraftError('Escribe el monto solicitado.');
  const insuranceRaw = parseMoneyToMinor(draft.insuranceInstallment);
  if (!draft.insurancePaid && insuranceRaw !== null && insuranceRaw < 1) {
    throw new CaseDraftError('Indica un monto mayor que cero.');
  }
  const insuranceCount = resolvedInsuranceCount(draft.insurancePaid, draft.insuranceInstallmentCount);
  const financing = resolveDraftFinancing(draft);
  if (!financing) throw new CaseDraftError('Revisa el plan de pagos.');
  return {
    company_id: companyId,
    application: {
      application_date: draft.requestDate,
      requested_amount_minor: requested,
    },
    signature_date: draft.signDate,
    insurance_installment_minor: draft.insurancePaid || insuranceRaw === null ? null : insuranceRaw,
    insurance_paid: draft.insurancePaid,
    vehicle: vehicleWrite(draft.vehicle),
    financing: toCaseFinancing(financing, draft.insurancePaid, insuranceCount),
  };
}

// Builds the wire body from the draft (amounts in minor units) and creates the expediente.
export function useCreateCase(companyId: string) {
  const queryClient = useQueryClient();
  const { me } = useGate();
  return useMutation({
    mutationFn: async () => {
      if (!me) throw new CaseDraftError('La empresa ya no está disponible.');
      if (me.overdue_company_ids.includes(companyId)) {
        throw new CaseDraftError('Bloqueada por falta de pago');
      }
      const draft = useCaseDraft.getState();
      if (!draft.client) throw new CaseDraftError('Falta el cliente.');
      const body = buildCaseWrite(companyId, draft);
      return api.cases.create(draft.client.id, body, me.companies);
    },
    onSuccess: async () => {
      useCaseDraft.getState().reset();
      await queryClient.invalidateQueries({ queryKey: queryKeys.casesRoot });
      await queryClient.invalidateQueries({ queryKey: ['dashboard'] });
    },
  });
}
