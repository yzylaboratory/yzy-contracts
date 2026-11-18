import { useRouter } from 'expo-router';
import { StyleSheet, View } from 'react-native';
import { formatMinor, parseMoneyToMinor } from '../../../shared/format/money';
import { formatDateEs } from '../../../shared/format/date';
import { messageFor } from '../../../shared/errors/messages';
import { useGate } from '../../access';
import { CompanyOverdueCopy, isCompanyOverdue } from '../../companies';
import { AppText } from '../../../shared/ui/AppText';
import { Button } from '../../../shared/ui/Button';
import { Card } from '../../../shared/ui/Card';
import { Notice } from '../../../shared/ui/Notice';
import { Screen } from '../../../shared/ui/Screen';
import { colors, space } from '../../../shared/theme/tokens';
import { moneyNumber } from '../domain/payment-plan';
import { useCaseDraft } from '../draft-store';
import { CaseDraftError, resolveDraftFinancing, useCreateCase } from '../hooks/useCreateCase';
import { parseInsuranceInstallmentCount } from '../schemas';
import { StepHeader } from './StepHeader';

// Paso 4 de 4: revisión y creación. Double-submit is blocked while the request is in flight.
export function ReviewStep({ companyId }: { companyId: string }) {
  const router = useRouter();
  const draft = useCaseDraft();
  const { me } = useGate();
  const blocked = isCompanyOverdue(me, companyId);
  const create = useCreateCase(companyId);

  const submit = () => {
    if (create.isPending || blocked) return;
    create.mutate(undefined, {
      onSuccess: (created) => router.replace(`/expedientes/${created.id}`),
    });
  };

  const vehicle = [draft.vehicle.brand, draft.vehicle.model, draft.vehicle.year].filter(Boolean).join(' ');
  const resolvedFinancing = resolveDraftFinancing(draft);
  const insuranceMinor = parseMoneyToMinor(draft.insuranceInstallment);
  const insuranceCount =
    parseInsuranceInstallmentCount(draft.insuranceInstallmentCount) ??
    resolvedFinancing?.insurance_installment_count ??
    null;

  const payments = resolvedFinancing
    ? [...resolvedFinancing.interest_installments, resolvedFinancing.final_principal]
    : [];
  const totalMinor = payments.reduce((sum, payment) => sum + payment.amount_minor, 0);
  const extraordinaryPayments = resolvedFinancing?.extraordinary_payments ?? [];

  return (
    <Screen
      footer={
        <Button label="Crear expediente" loading={create.isPending} disabled={blocked} onPress={submit} />
      }
    >
      <StepHeader step={4} title="Revisión" />
      <Card>
        <Row label="Cliente" value={draft.client?.name ?? 'Sin cliente'} />
        <Row label="Cédula" value={draft.client?.identity ?? 'Sin cédula'} />
      </Card>
      <Card>
        <Row label="Vehículo" value={vehicle || 'Sin datos'} />
        <Row label="Placa" value={draft.vehicle.plate || 'Sin placa'} />
      </Card>
      <Card>
        <Row label="Monto solicitado" value={formatMinor(parseMoneyToMinor(draft.requestedAmount) ?? 0)} />
        <Row label="Fecha de solicitud" value={formatDateEs(draft.requestDate)} />
        <Row label="Fecha de firma" value={draft.signDate ? formatDateEs(draft.signDate) : 'Sin firmar'} />
        <Row label="Cuotas" value={`${draft.installmentsCount || '0'} de ${formatMinor(parseMoneyToMinor(draft.installment) ?? 0)}`} />
        {draft.insurancePaid ? (
          <Row label="Seguro" value="Saldo (sin documentos del seguro)" />
        ) : (
          <>
            {insuranceMinor !== null && insuranceMinor > 0 ? (
              <Row label="Monto de cada cuota del seguro" value={formatMinor(insuranceMinor)} />
            ) : null}
            {insuranceCount !== null && insuranceCount > 0 ? (
              <Row label="Cantidad de cuotas del seguro" value={String(insuranceCount)} />
            ) : null}
          </>
        )}
      </Card>

      {payments.length > 0 ? (
        <Card>
          <AppText variant="subheading">Calendario de cuotas</AppText>
          <View style={styles.tableHeader}>
            <AppText variant="label" tone="secondary" style={styles.colIndex}>
              Cuota
            </AppText>
            <AppText variant="label" tone="secondary" style={styles.colDate}>
              Vencimiento
            </AppText>
            <AppText variant="label" tone="secondary" style={styles.colAmount}>
              Monto
            </AppText>
          </View>
          {payments.map((payment, index) => {
            const isFinal = index === payments.length - 1;
            return (
              <View key={`${payment.date}-${index}`} style={styles.scheduleRow}>
                <AppText variant="bodyStrong" style={styles.colIndex}>
                  {index + 1}
                  {isFinal ? ' · Capital e interés' : ''}
                </AppText>
                <AppText variant="body" tone="secondary" style={styles.colDate}>
                  {formatDateEs(payment.date)}
                </AppText>
                <AppText variant="bodyStrong" style={styles.colAmount}>
                  {moneyNumber(payment.amount_minor)}
                </AppText>
              </View>
            );
          })}
          <View style={styles.totalRow}>
            <AppText variant="bodyStrong">Total de cuotas</AppText>
            <AppText variant="bodyStrong">{moneyNumber(totalMinor)}</AppText>
          </View>
        </Card>
      ) : null}

      {extraordinaryPayments.length > 0 ? (
        <Card>
          <AppText variant="subheading">Abonos extraordinarios</AppText>
          <View style={styles.tableHeader}>
            <AppText variant="label" tone="secondary" style={styles.colIndex}>
              Abono
            </AppText>
            <AppText variant="label" tone="secondary" style={styles.colDate}>
              Fecha
            </AppText>
            <AppText variant="label" tone="secondary" style={styles.colAmount}>
              Monto
            </AppText>
          </View>
          {extraordinaryPayments.map((payment, index) => (
            <View key={`${payment.date}-${index}`} style={styles.scheduleRow}>
              <AppText variant="bodyStrong" style={styles.colIndex}>
                Abono {index + 1}
              </AppText>
              <AppText variant="body" tone="secondary" style={styles.colDate}>
                {formatDateEs(payment.date)}
              </AppText>
              <AppText variant="bodyStrong" style={styles.colAmount}>
                {payment.amount_minor > 0 ? moneyNumber(payment.amount_minor) : 'Pendiente'}
              </AppText>
            </View>
          ))}
        </Card>
      ) : null}

      {blocked ? <CompanyOverdueCopy companyId={companyId} /> : null}
      {create.isError ? (
        <Notice
          tone="danger"
          message={create.error instanceof CaseDraftError ? create.error.message : messageFor(create.error)}
        />
      ) : null}
    </Screen>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.row}>
      <AppText variant="caption" tone="secondary">
        {label}
      </AppText>
      <AppText variant="bodyStrong" style={styles.value}>
        {value}
      </AppText>
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', justifyContent: 'space-between', gap: space.md, paddingVertical: 2 },
  value: { flexShrink: 1, textAlign: 'right' },
  tableHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingBottom: space.xs,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
    gap: space.xs,
  },
  scheduleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: space.xxs,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.borderSubtle,
    gap: space.xs,
  },
  colIndex: { flex: 1.2 },
  colDate: { flex: 1.1 },
  colAmount: { flex: 1.1, textAlign: 'right' },
  totalRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingTop: space.xs,
  },
});
