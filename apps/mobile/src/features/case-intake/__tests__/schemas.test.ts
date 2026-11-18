import { clientFormSchema, normalizeIdentity, planStepSchema, requestStepSchema } from '../schemas';
import { emailFormSchema } from '../../auth/schemas';

const validRequest = {
  requestDate: '2026-11-16',
  signDate: '',
  requestedAmount: 'RD$1,000,000.00',
  insuranceInstallment: 'RD$10,000.00',
  installmentsCount: '48',
};

describe('auth email schema', () => {
  it('normalizes and accepts a valid email', () => {
    expect(emailFormSchema.parse({ email: '  Persona@Empresa.test ' })).toEqual({ email: 'persona@empresa.test' });
  });

  it('rejects malformed emails and unknown keys (strict)', () => {
    expect(emailFormSchema.safeParse({ email: 'no-es-correo' }).success).toBe(false);
    expect(emailFormSchema.safeParse({ email: 'a@b.test', role: 'superadmin' }).success).toBe(false);
  });
});

describe('client form schema', () => {
  it('requires a name of at least two characters', () => {
    expect(clientFormSchema.safeParse({ name: 'A', identity: '', phone: '' }).success).toBe(false);
  });

  it('accepts an empty identity and rejects a malformed cédula', () => {
    expect(clientFormSchema.safeParse({ name: 'MARÍA PÉREZ', identity: '', phone: '' }).success).toBe(true);
    expect(clientFormSchema.safeParse({ name: 'MARÍA PÉREZ', identity: '12345', phone: '' }).success).toBe(false);
    expect(clientFormSchema.safeParse({ name: 'MARÍA PÉREZ', identity: '001-0000000-1', phone: '' }).success).toBe(true);
  });

  it('normalizes eleven digits into the cédula format', () => {
    expect(normalizeIdentity('00100000001')).toBe('001-0000000-1');
  });
});

describe('request step schema', () => {
  it('accepts a complete request', () => {
    expect(requestStepSchema.safeParse(validRequest).success).toBe(true);
  });

  it('requires a requested amount greater than zero', () => {
    expect(requestStepSchema.safeParse({ ...validRequest, requestedAmount: 'RD$0.00' }).success).toBe(false);
    expect(requestStepSchema.safeParse({ ...validRequest, requestedAmount: '' }).success).toBe(false);
  });

  it('rejects impossible dates and an empty installment count', () => {
    expect(requestStepSchema.safeParse({ ...validRequest, requestDate: '2026-02-31' }).success).toBe(false);
    expect(requestStepSchema.safeParse({ ...validRequest, installmentsCount: '' }).success).toBe(false);
  });

  it('allows an empty signing date while the request is not signed', () => {
    expect(requestStepSchema.safeParse({ ...validRequest, signDate: '' }).success).toBe(true);
  });

  it('requires an integer between 1 and 1200 for insuranceInstallmentCount when insurancePaid is false', () => {
    expect(
      requestStepSchema.safeParse({ ...validRequest, insurancePaid: false, insuranceInstallmentCount: '10' }).success,
    ).toBe(true);
    expect(
      requestStepSchema.safeParse({ ...validRequest, insurancePaid: false, insuranceInstallmentCount: '' }).success,
    ).toBe(false);
    expect(
      requestStepSchema.safeParse({ ...validRequest, insurancePaid: false, insuranceInstallmentCount: '0' }).success,
    ).toBe(false);
    expect(
      requestStepSchema.safeParse({ ...validRequest, insurancePaid: false, insuranceInstallmentCount: '1201' }).success,
    ).toBe(false);
    expect(
      requestStepSchema.safeParse({ ...validRequest, insurancePaid: true, insuranceInstallmentCount: '' }).success,
    ).toBe(true);
  });
});

describe('plan step schema', () => {
  it('requires a cuota greater than zero', () => {
    expect(planStepSchema.safeParse({ installment: 'RD$25,000.00' }).success).toBe(true);
    expect(planStepSchema.safeParse({ installment: '' }).success).toBe(false);
  });
});
