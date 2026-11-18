import {
  amountInputValue,
  buildIntakeFinancing,
  calculateMonthlyPayments,
  computeIntakeExtraordinaryState,
  defaultExtraordinaryPayments,
  expedienteExtraordinaryPayments,
  extraordinaryPaymentDate,
  extraordinaryPaymentDates,
  extraordinaryPaymentValues,
  formatMoneyInput,
  installmentDraft,
  integerWords,
  isExtraordinaryPaymentField,
  maxMonthlyInstallments,
  moneyNumber,
  notarialDate,
  notarialMoney,
  notarialMoneyWords,
  parseAmountMinor,
  paymentDateAfterMonths,
  planCalculationOutOfRange,
  planFromInputs,
  validateMonthlyPayments,
} from '../payment-plan';

describe('payment-plan domain parity with portal', () => {
  it('calculates monthly installments adding capital to the final installment', () => {
    const generated = calculateMonthlyPayments('2027-01-31', 750_000, 3, 30_000_000);
    expect(generated).toEqual([
      { date: '2027-02-28', amount_minor: 750_000 },
      { date: '2027-03-31', amount_minor: 750_000 },
      { date: '2027-04-30', amount_minor: 30_750_000 },
    ]);

    const leapGenerated = calculateMonthlyPayments('2028-01-31', 500_000, 4, 20_000_000);
    expect(leapGenerated).toEqual([
      { date: '2028-02-29', amount_minor: 500_000 },
      { date: '2028-03-31', amount_minor: 500_000 },
      { date: '2028-04-30', amount_minor: 500_000 },
      { date: '2028-05-31', amount_minor: 20_500_000 },
    ]);

    const single = calculateMonthlyPayments('2026-11-16', 1_250_000, 1, 50_000_000);
    expect(single).toEqual([{ date: '2026-12-16', amount_minor: 51_250_000 }]);
  });

  it('builds and validates edited monthly payment rows identically to portal', () => {
    const fromInputs = planFromInputs('2027-01-31', 30_000_000, 'RD$7,500.00', '3');
    expect(fromInputs).toEqual({
      amount: 'RD$7,500.00',
      count: '3',
      rows: [
        { date: '2027-02-28', amount: 'RD$7,500.00' },
        { date: '2027-03-31', amount: 'RD$7,500.00' },
        { date: '2027-04-30', amount: 'RD$307,500.00' },
      ],
    });

    const rows = [...fromInputs.rows];
    rows[0] = { date: '2027-02-25', amount: '8000.25' };
    rows[2] = { date: '2027-04-29', amount: '310000.00' };
    const validated = validateMonthlyPayments(rows, paymentDateAfterMonths('2027-01-31', maxMonthlyInstallments));
    expect(validated.total).toBe(32_550_025);
    expect(validated.totalError).toBe(false);
    expect(validated.plan).toEqual({
      interest_installments: [
        { date: '2027-02-25', amount_minor: 800_025 },
        { date: '2027-03-31', amount_minor: 750_000 },
      ],
      final_principal: { date: '2027-04-29', amount_minor: 31_000_000 },
    });

    rows[1] = { date: '2027-02-25', amount: '0' };
    const invalid = validateMonthlyPayments(rows);
    expect(invalid.plan).toBeUndefined();
    expect(invalid.errors[1]?.date).toBe('Debe ser posterior a la cuota anterior.');
    expect(invalid.errors[1]?.amount).toBe('Indica un monto mayor que cero.');
  });

  it('detects out-of-range calculation inputs', () => {
    expect(planCalculationOutOfRange('2027-01-31', 30_000_000, 'RD$7,500.00', '3')).toBe(false);
    expect(planCalculationOutOfRange('9999-12-31', 30_000_000, 'RD$7,500.00', '1')).toBe(true);
    expect(planFromInputs('9999-12-31', 30_000_000, 'RD$7,500.00', '1').rows).toEqual([]);
  });

  it('preserves the anchor day after a shorter month for extraordinary payments', () => {
    expect(extraordinaryPaymentDate('2023-10-31', 1)).toBe('2024-02-29');
    expect(extraordinaryPaymentDate('2023-10-31', 2)).toBe('2024-06-30');
    expect(extraordinaryPaymentDate('2023-10-31', 3)).toBe('2024-10-31');
    expect(extraordinaryPaymentDate('2024-02-30', 0)).toBeUndefined();
    expect(extraordinaryPaymentDate('9999-12-31', 1)).toBeUndefined();
  });

  it('schedules extraordinary installments every 4 months before the final installment', () => {
    expect(extraordinaryPaymentDates('2027-10-31', '2029-02-28')).toEqual([
      '2028-02-29',
      '2028-06-30',
      '2028-10-31',
    ]);
    expect(extraordinaryPaymentDates('2027-10-31', '2028-02-29')).toEqual([]);
    expect(extraordinaryPaymentDates(null, '2029-02-28')).toEqual([]);
  });

  it('defaults extraordinary payments to two and preserves added or funded legacy rows', () => {
    const signatureDate = '2027-10-31';
    const basePayments = extraordinaryPaymentDates(signatureDate, '2029-10-31').map((date) => ({
      date,
      amount_minor: 0,
    }));
    const financing = {
      final_principal: { date: '2029-10-31', amount_minor: 25_000_000 },
      extraordinary_from_signature: true,
      extraordinary_payments: basePayments,
    };

    expect(expedienteExtraordinaryPayments({ signature_date: signatureDate, financing })).toEqual([
      { date: '2028-02-29', amount_minor: 0 },
      { date: '2028-06-30', amount_minor: 0 },
    ]);

    expect(
      expedienteExtraordinaryPayments({
        signature_date: signatureDate,
        financing: { ...financing, extraordinary_payment_count: 3 },
      }),
    ).toEqual([
      { date: '2028-02-29', amount_minor: 0 },
      { date: '2028-06-30', amount_minor: 0 },
      { date: '2028-10-31', amount_minor: 0 },
    ]);

    const funded = basePayments.map((payment, index) =>
      index === 3 ? { ...payment, amount_minor: 250_000 } : payment,
    );
    const resolvedFunded = expedienteExtraordinaryPayments({
      signature_date: signatureDate,
      financing: { ...financing, extraordinary_payments: funded },
    });
    expect(resolvedFunded).toHaveLength(4);
    expect(resolvedFunded?.[3]?.amount_minor).toBe(250_000);
  });

  it('formats extraordinary payment values in both plain and notarial prose', () => {
    const plain = extraordinaryPaymentValues(
      [
        { date: '2028-02-29', amount_minor: 0 },
        { date: '2028-06-30', amount_minor: 123_456 },
      ],
      false,
    );
    expect(plain).toEqual({
      abonos_extraordinarios: '1) 29 de febrero de 2028, RD$0.00. 2) 30 de junio de 2028, RD$1,234.56',
      fecha_abono_extraordinario_1: '2028-02-29',
      abono_extraordinario_1_monto: 'RD$0.00',
      fecha_abono_extraordinario_2: '2028-06-30',
      abono_extraordinario_2_monto: 'RD$1,234.56',
    });

    const words = extraordinaryPaymentValues(
      [
        { date: '2028-02-29', amount_minor: 1_234_500 },
        { date: '2028-06-30', amount_minor: 2_500_000 },
      ],
      true,
    );
    expect(words).toEqual({
      abonos_extraordinarios:
        '1) VEINTINUEVE (29) DE FEBRERO DEL AÑO DOS MIL VEINTIOCHO (2028), DOCE MIL TRESCIENTOS CUARENTA Y CINCO PESOS CON 00/100 CENTAVOS DOMINICANOS (RD$12,345.00). 2) TREINTA (30) DE JUNIO DEL AÑO DOS MIL VEINTIOCHO (2028), VEINTICINCO MIL PESOS CON 00/100 CENTAVOS DOMINICANOS (RD$25,000.00)',
      fecha_abono_extraordinario_1: '2028-02-29',
      abono_extraordinario_1_monto: 'RD$12,345.00',
      fecha_abono_extraordinario_2: '2028-06-30',
      abono_extraordinario_2_monto: 'RD$25,000.00',
    });

    expect(extraordinaryPaymentValues([], false)).toEqual({ abonos_extraordinarios: 'Ninguno' });
    expect(isExtraordinaryPaymentField('abonos_extraordinarios')).toBe(true);
    expect(isExtraordinaryPaymentField('fecha_abono_extraordinario_1')).toBe(true);
    expect(isExtraordinaryPaymentField('abono_extraordinario_2_monto')).toBe(true);
    expect(isExtraordinaryPaymentField('abono_extraordinario_0_monto')).toBe(false);
  });

  it('parses and formats amounts identically to portal amount-input.ts', () => {
    expect(parseAmountMinor('RD$7,500.00')).toBe(750_000);
    expect(parseAmountMinor('8000.25')).toBe(800_025);
    expect(parseAmountMinor('1234,5')).toBe(123_450);
    expect(parseAmountMinor('RD$1,000,000.99')).toBe(100_000_099);
    expect(parseAmountMinor('invalid')).toBeUndefined();
    expect(amountInputValue(750_025)).toBe('7500.25');
    expect(formatMoneyInput(750_025)).toBe('RD$7,500.25');
    expect(moneyNumber(750_025)).toBe('RD$7,500.25');
    expect(notarialMoneyWords(100)).toBe('UN PESO CON 00/100 CENTAVOS DOMINICANOS');
    expect(notarialMoney(100)).toBe('UN PESO CON 00/100 CENTAVOS DOMINICANOS (RD$1.00)');
    expect(notarialDate(new Date('2026-11-07T00:00:00Z'))).toBe(
      'SIETE (07) DE NOVIEMBRE DEL AÑO DOS MIL VEINTISEIS (2026)',
    );
    expect(integerWords(21, true)).toBe('veintiún');
    expect(installmentDraft({ date: '2027-02-28', amount_minor: 750_000 })).toEqual({
      date: '2027-02-28',
      amount: 'RD$7,500.00',
    });
  });

  it('computes intake extraordinary state and builds financing payload like intake-payment-plan-step.tsx', () => {
    const signatureDate = '2027-10-31';
    const generated = planFromInputs(signatureDate, 25_000_000, 'RD$10,000.00', '24');
    const validated = validateMonthlyPayments(generated.rows);
    expect(validated.plan).toBeDefined();

    const stateDefault = computeIntakeExtraordinaryState({
      signatureDate,
      rows: generated.rows,
      rowErrors: validated.errors,
      extraordinary: {
        '2028-02-29': 'RD$50,000.00',
      },
    });
    expect(stateDefault.initialCount).toBe(defaultExtraordinaryPayments);
    expect(stateDefault.shownCount).toBe(2);
    expect(stateDefault.validExtras).toBe(false);
    expect(stateDefault.canAddMore).toBe(true);
    expect(stateDefault.canRemoveLast).toBe(false);

    const stateComplete = computeIntakeExtraordinaryState({
      signatureDate,
      rows: generated.rows,
      rowErrors: validated.errors,
      extraordinary: {
        '2028-02-29': 'RD$50,000.00',
        '2028-06-30': 'RD$50,000.00',
        '2028-10-31': 'RD$75,000.00',
      },
      extraordinaryCount: 3,
    });
    expect(stateComplete.shownCount).toBe(3);
    expect(stateComplete.validExtras).toBe(true);
    expect(stateComplete.canRemoveLast).toBe(true);

    const financing = buildIntakeFinancing(validated.plan!, stateComplete.extras);
    expect(financing.extraordinary_from_signature).toBe(true);
    expect(financing.extraordinary_payment_count).toBe(3);
    expect(financing.extraordinary_payments).toEqual([
      { date: '2028-02-29', amount_minor: 5_000_000 },
      { date: '2028-06-30', amount_minor: 5_000_000 },
      { date: '2028-10-31', amount_minor: 7_500_000 },
    ]);
  });
});
