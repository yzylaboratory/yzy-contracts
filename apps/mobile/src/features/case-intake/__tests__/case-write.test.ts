import type { Client } from '../../../lib/api';
import type { Financing } from '../domain/payment-plan';
import { buildCaseWrite, CaseDraftError, type CaseDraftInput } from '../hooks/useCreateCase';

const client: Client = {
  id: 'client-1',
  name: 'Ana Ruiz',
  identity: null,
  phone: null,
  address: null,
  created_at: '2026-01-01T00:00:00Z',
};

const financing: Financing = {
  interest_installments: [{ date: '2026-12-16', amount_minor: 25_000_00 }],
  final_principal: { date: '2027-01-16', amount_minor: 1_025_000_00 },
  extraordinary_payments: [],
  extraordinary_from_signature: false,
  extraordinary_payment_count: 0,
};

function draft(partial: Partial<CaseDraftInput> = {}): CaseDraftInput {
  return {
    client,
    requestDate: '2026-11-16',
    signDate: '2026-11-20',
    requestedAmount: 'RD$1,000,000.00',
    insurancePaid: false,
    insuranceInstallment: '',
    installmentsCount: '2',
    installment: 'RD$25,000.00',
    installmentRows: [],
    extraordinary: {},
    financing,
    vehicle: {
      kind: '',
      brand: 'Toyota',
      model: '',
      year: '',
      color: '',
      registration: '',
      plate: '',
      chassis: '',
      engine: '',
    },
    ...partial,
  };
}

describe('buildCaseWrite', () => {
  it('sends the operation write with signature date, null insurance, and the saved financing', () => {
    const body = buildCaseWrite('company-1', draft());

    expect(body).toEqual({
      company_id: 'company-1',
      application: {
        application_date: '2026-11-16',
        requested_amount_minor: 100_000_000,
      },
      signature_date: '2026-11-20',
      insurance_installment_minor: null,
      insurance_paid: false,
      vehicle: {
        kind: null,
        brand: 'Toyota',
        model: null,
        year: null,
        color: null,
        registration: null,
        plate: null,
        chassis: null,
        engine: null,
      },
      financing: {
        interest_installments: financing.interest_installments,
        final_principal: financing.final_principal,
        extraordinary_payments: [],
        extraordinary_from_signature: false,
        extraordinary_payment_count: 0,
        insurance_installment_count: null,
      },
    });
    expect(body).not.toHaveProperty('contract_date');
    expect(body).not.toHaveProperty('request_date');
  });

  it('sends a positive insurance installment and nulls it when the insurance is already paid', () => {
    const unpaid = buildCaseWrite('company-1', draft({ insuranceInstallment: 'RD$10,000.00' }));
    expect(unpaid.insurance_installment_minor).toBe(1_000_000);
    expect(unpaid.insurance_paid).toBe(false);

    const paid = buildCaseWrite(
      'company-1',
      draft({ insurancePaid: true, insuranceInstallment: 'RD$10,000.00' }),
    );
    expect(paid.insurance_installment_minor).toBeNull();
    expect(paid.insurance_paid).toBe(true);
    expect(paid.financing.insurance_installment_count).toBeNull();
  });

  it('rejects a zero insurance installment instead of sending it', () => {
    expect(() => buildCaseWrite('company-1', draft({ insuranceInstallment: 'RD$0.00' }))).toThrow(CaseDraftError);
  });

  it('sends financing.insurance_installment_count when unpaid and nulls it when paid', () => {
    const unpaid = buildCaseWrite(
      'company-1',
      draft({ insurancePaid: false, insuranceInstallment: 'RD$10,000.00', insuranceInstallmentCount: '10' }),
    );
    expect(unpaid.financing.insurance_installment_count).toBe(10);

    const paid = buildCaseWrite(
      'company-1',
      draft({ insurancePaid: true, insuranceInstallment: 'RD$10,000.00', insuranceInstallmentCount: '10' }),
    );
    expect(paid.financing.insurance_installment_count).toBeNull();
  });

  it('rejects an out-of-range insurance installment count', () => {
    expect(() =>
      buildCaseWrite('company-1', draft({ insurancePaid: false, insuranceInstallmentCount: '1201' })),
    ).toThrow(CaseDraftError);
    expect(() =>
      buildCaseWrite('company-1', draft({ insurancePaid: false, insuranceInstallmentCount: '0' })),
    ).toThrow(CaseDraftError);
  });
});
