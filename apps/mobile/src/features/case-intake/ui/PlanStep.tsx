import { useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { formatDateEs } from '../../../shared/format/date';
import { formatMinor, maskMoneyInput } from '../../../shared/format/money';
import { colors, radius, space } from '../../../shared/theme/tokens';
import { AppText } from '../../../shared/ui/AppText';
import { Button } from '../../../shared/ui/Button';
import { Card } from '../../../shared/ui/Card';
import { DateField } from '../../../shared/ui/DateField';
import { Notice } from '../../../shared/ui/Notice';
import { Screen } from '../../../shared/ui/Screen';
import { TextField } from '../../../shared/ui/TextField';
import {
  buildIntakeFinancing,
  computeIntakeExtraordinaryState,
  maxMonthlyInstallments,
  moneyNumber,
  parseAmountMinor,
  paymentDateAfterMonths,
  planCalculationOutOfRange,
  planFromInputs,
  validateMonthlyPayments,
  type InstallmentDraft,
} from '../domain/payment-plan';
import { useCaseDraft } from '../draft-store';
import { parseInsuranceInstallmentCount, planStepSchema } from '../schemas';
import { StepHeader } from './StepHeader';

// Paso 3 de 4: calendario de cuotas mensuales y abonos extraordinarios (paridad con IntakePaymentPlanStep del portal).
// Al continuar, el borrador guarda el Financing de buildIntakeFinancing. El alta lo envía tal cual.
export function PlanStep() {
  const router = useRouter();
  const signDate = useCaseDraft((state) => state.signDate);
  const requestedAmount = useCaseDraft((state) => state.requestedAmount);
  const insurancePaid = useCaseDraft((state) => state.insurancePaid);
  const insuranceInstallmentCount = useCaseDraft((state) => state.insuranceInstallmentCount);
  const installment = useCaseDraft((state) => state.installment);
  const count = useCaseDraft((state) => state.installmentsCount);
  const rows = useCaseDraft((state) => state.installmentRows);
  const extraordinary = useCaseDraft((state) => state.extraordinary);
  const extraordinaryCount = useCaseDraft((state) => state.extraordinaryCount);
  const patch = useCaseDraft((state) => state.patch);
  const [error, setError] = useState<string | null>(null);
  const [submitAttempted, setSubmitAttempted] = useState(false);

  const capital = parseAmountMinor(requestedAmount) ?? 0;
  const amount = parseAmountMinor(installment) ?? 0;
  const countNum = /^\d+$/.test(count) ? Number(count) : 0;
  const validCount = Number.isInteger(countNum) && countNum >= 1 && countNum <= maxMonthlyInstallments;

  // Populate initial schedule rows when entering Step 3 with valid signDate, capital, amount, and count.
  useEffect(() => {
    if (rows.length === 0 && signDate && capital > 0 && amount > 0 && validCount) {
      const generated = planFromInputs(signDate, capital, installment, count);
      if (generated.rows.length > 0) {
        patch({ installmentRows: generated.rows });
      }
    }
  }, [signDate, capital, amount, validCount, installment, count, rows.length, patch]);

  const calculationOutOfRange = planCalculationOutOfRange(signDate, capital, installment, count);
  const {
    errors: rowErrors,
    plan,
    total,
    totalError,
  } = validateMonthlyPayments(rows, paymentDateAfterMonths(signDate, maxMonthlyInstallments));

  const extraState = computeIntakeExtraordinaryState({
    signatureDate: signDate,
    rows,
    rowErrors,
    extraordinary,
    extraordinaryCount,
  });

  const handleAmountChange = (raw: string) => {
    const nextAmount = maskMoneyInput(raw);
    setError(null);
    if (rows.length > 0 && parseAmountMinor(nextAmount) === parseAmountMinor(installment)) {
      patch({ installment: nextAmount });
      return;
    }
    const generated = planFromInputs(signDate, capital, nextAmount, count);
    patch({
      installment: generated.amount,
      installmentsCount: generated.count,
      installmentRows: generated.rows,
    });
  };

  const handleCountChange = (raw: string) => {
    const nextCount = raw.replace(/\D/g, '');
    setError(null);
    const generated = planFromInputs(signDate, capital, installment, nextCount);
    patch({
      installment: generated.amount,
      installmentsCount: generated.count,
      installmentRows: generated.rows,
    });
  };

  const editInstallment = (index: number, update: Partial<InstallmentDraft>) => {
    patch({
      installmentRows: rows.map((row, position) => (position === index ? { ...row, ...update } : row)),
    });
  };

  const next = () => {
    setSubmitAttempted(true);
    const parsed = planStepSchema.safeParse({ installment });
    if (!parsed.success) {
      setError(parsed.error.issues[0]?.message ?? 'Revisa el monto de la cuota.');
      return;
    }
    if (!validCount) {
      setError(`Indica entre 1 y ${maxMonthlyInstallments} cuotas.`);
      return;
    }
    if (!signDate) {
      setError('Indica la fecha de firma en la solicitud para calcular el calendario de cuotas.');
      return;
    }
    if (!plan || totalError || !extraState.validExtras) {
      return;
    }
    setError(null);
    const parsedInsuranceCount = insurancePaid ? null : parseInsuranceInstallmentCount(insuranceInstallmentCount);
    patch({ financing: buildIntakeFinancing(plan, extraState.extras, parsedInsuranceCount) });
    router.push('/nuevo-expediente/revision');
  };

  const fallbackTotal = amount > 0 && validCount ? capital + amount * countNum : null;
  const displayedTotal = plan ? total : fallbackTotal;

  return (
    <Screen footer={<Button label="Revisar expediente" onPress={next} />}>
      <StepHeader step={3} title="Plan de pagos" />
      <Card>
        <View style={styles.row}>
          <AppText tone="secondary">Fecha de firma</AppText>
          <AppText variant="bodyStrong">{signDate ? formatDateEs(signDate) : 'Sin definir'}</AppText>
        </View>
        <View style={styles.row}>
          <AppText tone="secondary">Capital financiado · Solicitud de préstamo</AppText>
          <AppText variant="bodyStrong">{formatMinor(capital)}</AppText>
        </View>
      </Card>

      <TextField
        label="Monto de la cuota"
        value={installment}
        onChangeText={handleAmountChange}
        placeholder="RD$0.00"
        error={
          error ??
          (installment !== '' && amount <= 0 ? 'Indica un monto mayor que cero con hasta dos decimales.' : null)
        }
        keyboardType="number-pad"
      />
      <TextField
        label="Cantidad de cuotas"
        value={count}
        onChangeText={handleCountChange}
        hint="Incluye la última cuota, a la que se suma el capital financiado."
        error={count !== '' && !validCount ? `Indica entre 1 y ${maxMonthlyInstallments} cuotas.` : null}
        keyboardType="number-pad"
      />

      {!signDate ? (
        <Notice
          tone="warning"
          message="Guarda la fecha de firma en la solicitud de préstamo para calcular el calendario de cuotas y abonos extraordinarios."
        />
      ) : null}

      {calculationOutOfRange ? (
        <Notice
          tone="danger"
          message="El calendario o el total supera el rango permitido. Revisa el monto y la cantidad de cuotas."
        />
      ) : null}

      {rows.length > 0 ? (
        <View style={styles.section}>
          <AppText variant="subheading">Calendario de cuotas</AppText>
          <AppText variant="caption" tone="secondary">
            Puedes editar cada fecha y monto. Si cambias el monto o la cantidad, se regeneran las cuotas.
          </AppText>
          <Card style={styles.scheduleCard}>
            <View style={styles.tableHeader}>
              <AppText variant="label" tone="secondary" style={styles.colIndex}>
                Cuota
              </AppText>
              <AppText variant="label" tone="secondary" style={styles.colDate}>
                Vencimiento
              </AppText>
              <AppText variant="label" tone="secondary" style={styles.colAmount}>
                Monto (RD$)
              </AppText>
            </View>
            {rows.map((row, index) => {
              const isFinal = index === rows.length - 1;
              const rowAmountMinor = parseAmountMinor(row.amount);
              return (
                <View key={index} style={styles.installmentItem}>
                  <View style={styles.installmentSummaryRow}>
                    <AppText variant="bodyStrong" style={styles.colIndex}>
                      {index + 1}
                      {isFinal ? ' · Cuota final' : ''}
                    </AppText>
                    <AppText variant="body" tone="secondary" style={styles.colDate}>
                      {formatDateEs(row.date)}
                    </AppText>
                    <AppText variant="bodyStrong" style={styles.colAmount}>
                      {rowAmountMinor !== undefined ? moneyNumber(rowAmountMinor) : row.amount}
                    </AppText>
                  </View>
                  <View style={styles.installmentEditors}>
                    <DateField
                      label={`Vencimiento de la cuota ${index + 1}`}
                      value={row.date}
                      error={rowErrors[index]?.date ?? null}
                      onChange={(nextDate) => editInstallment(index, { date: nextDate })}
                    />
                    <TextField
                      label={`Monto de la cuota ${index + 1}`}
                      value={row.amount}
                      error={rowErrors[index]?.amount ?? null}
                      placeholder="RD$0.00"
                      keyboardType="number-pad"
                      onChangeText={(nextValue) => editInstallment(index, { amount: maskMoneyInput(nextValue) })}
                    />
                  </View>
                </View>
              );
            })}
            <View style={styles.totalRow}>
              <AppText variant="bodyStrong">Total de cuotas</AppText>
              <AppText variant="bodyStrong">{displayedTotal !== null ? moneyNumber(displayedTotal) : 'Pendiente'}</AppText>
            </View>
          </Card>
          {totalError ? <Notice tone="danger" message="El total de las cuotas supera el monto permitido." /> : null}
        </View>
      ) : (
        <Card>
          <View style={styles.row}>
            <AppText tone="secondary">Cantidad de cuotas</AppText>
            <AppText variant="bodyStrong">{count || 'Sin definir'}</AppText>
          </View>
          <View style={styles.row}>
            <AppText tone="secondary">Total de cuotas</AppText>
            <AppText variant="bodyStrong">{displayedTotal !== null ? moneyNumber(displayedTotal) : 'Pendiente'}</AppText>
          </View>
        </Card>
      )}

      {extraState.extras.length > 0 ? (
        <View style={styles.section}>
          <AppText variant="subheading">Abonos extraordinarios</AppText>
          <AppText variant="caption" tone="secondary">
            Indica el monto de cada abono extraordinario requerido para los contratos.
          </AppText>
          <Card style={styles.extrasCard}>
            {extraState.extras.map(({ date, value, amount: extraAmount }, index) => {
              const invalidExtra =
                (value.trim() !== '' || submitAttempted) && (extraAmount === undefined || extraAmount <= 0);
              return (
                <TextField
                  key={date}
                  label={`Monto del abono ${index + 1}`}
                  hint={formatDateEs(date)}
                  value={value}
                  placeholder="RD$0.00"
                  keyboardType="number-pad"
                  error={invalidExtra ? 'Escribe un monto mayor que cero con hasta dos decimales.' : null}
                  onChangeText={(nextValue) =>
                    patch({
                      extraordinary: {
                        ...extraordinary,
                        [date]: maskMoneyInput(nextValue),
                      },
                    })
                  }
                />
              );
            })}
            {extraState.canRemoveLast || extraState.canAddMore ? (
              <View style={styles.extraActions}>
                {extraState.canRemoveLast ? (
                  <Button
                    label="Quitar último abono"
                    variant="secondary"
                    onPress={() => patch({ extraordinaryCount: extraState.extras.length - 1 })}
                  />
                ) : null}
                {extraState.canAddMore ? (
                  <Button
                    label="Agregar abono"
                    variant="secondary"
                    onPress={() => patch({ extraordinaryCount: extraState.extras.length + 1 })}
                  />
                ) : null}
              </View>
            ) : null}
          </Card>
        </View>
      ) : (
        <AppText variant="caption" tone="secondary">
          Los abonos extraordinarios se programan cada cuatro meses desde la firma.
        </AppText>
      )}
    </Screen>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: space.sm },
  section: { gap: space.xs },
  scheduleCard: { gap: space.md },
  tableHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingBottom: space.xs,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
    gap: space.xs,
  },
  colIndex: { flex: 1.1 },
  colDate: { flex: 1.2 },
  colAmount: { flex: 1.2, textAlign: 'right' },
  installmentItem: {
    gap: space.xs,
    paddingVertical: space.xs,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.borderSubtle,
  },
  installmentSummaryRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.xs,
    backgroundColor: colors.surface,
    paddingHorizontal: space.sm,
    paddingVertical: space.xs,
    borderRadius: radius.small,
  },
  installmentEditors: {
    gap: space.xs,
    paddingTop: space.xxs,
  },
  totalRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingTop: space.xs,
  },
  extrasCard: { gap: space.md },
  extraActions: { gap: space.xs },
});
