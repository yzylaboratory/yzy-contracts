import { useRouter } from 'expo-router';
import { useState } from 'react';
import { StyleSheet } from 'react-native';
import { maskMoneyInput } from '../../../shared/format/money';
import { AppText } from '../../../shared/ui/AppText';
import { Button } from '../../../shared/ui/Button';
import { Checkbox } from '../../../shared/ui/Checkbox';
import { DateField } from '../../../shared/ui/DateField';
import { Screen } from '../../../shared/ui/Screen';
import { TextField } from '../../../shared/ui/TextField';
import { parseAmountMinor, planFromInputs } from '../domain/payment-plan';
import { useCaseDraft, type VehicleDraft } from '../draft-store';
import { requestStepSchema } from '../schemas';
import { StepHeader } from './StepHeader';

type RequestErrors = Partial<
  Record<
    'requestDate' | 'signDate' | 'requestedAmount' | 'insuranceInstallment' | 'insuranceInstallmentCount' | 'installmentsCount',
    string
  >
>;

// Paso 2 de 4: préstamo, seguro y datos del vehículo (plan section 8, item 5).
export function RequestStep() {
  const router = useRouter();
  const draft = useCaseDraft();
  const [errors, setErrors] = useState<RequestErrors>({});

  const refreshPlan = (updates: {
    signDate?: string;
    requestedAmount?: string;
    installmentsCount?: string;
  }) => {
    const nextSignDate = updates.signDate ?? draft.signDate;
    const nextRequestedAmount = updates.requestedAmount ?? draft.requestedAmount;
    const nextCount = updates.installmentsCount ?? draft.installmentsCount;
    const capital = parseAmountMinor(nextRequestedAmount) ?? 0;
    const generated = planFromInputs(nextSignDate, capital, draft.installment, nextCount);
    draft.patch({
      ...updates,
      installmentRows: generated.rows,
      financing: null,
    });
  };

  const next = () => {
    const parsed = requestStepSchema.safeParse({
      requestDate: draft.requestDate,
      signDate: draft.signDate,
      requestedAmount: draft.requestedAmount,
      insurancePaid: draft.insurancePaid,
      insuranceInstallment: draft.insuranceInstallment,
      insuranceInstallmentCount: draft.insuranceInstallmentCount,
      installmentsCount: draft.installmentsCount,
    });
    if (!parsed.success) {
      const map: RequestErrors = {};
      for (const issue of parsed.error.issues) {
        const key = issue.path[0];
        if (typeof key === 'string' && key in requestKeys) map[key as keyof RequestErrors] = issue.message;
      }
      setErrors(map);
      return;
    }
    setErrors({});
    router.push('/nuevo-expediente/plan-pagos');
  };

  const vehicle = (key: keyof VehicleDraft, label: string, placeholder?: string) => (
    <TextField label={label} value={draft.vehicle[key]} placeholder={placeholder} onChangeText={(value) => draft.patchVehicle({ [key]: value })} />
  );

  return (
    <Screen
      footer={<Button label="Continuar al plan de pagos" onPress={next} />}
    >
      <StepHeader step={2} title="Solicitud de préstamo" />
      <AppText variant="subheading">Préstamo y seguro</AppText>
      <DateField
        label="Fecha de solicitud"
        value={draft.requestDate}
        onChange={(value) => draft.patch({ requestDate: value })}
        error={errors.requestDate}
      />
      <DateField
        label="Fecha de firma"
        value={draft.signDate}
        onChange={(value) => refreshPlan({ signDate: value })}
        error={errors.signDate}
        hint="Se usa para calcular el calendario de cuotas. Déjala vacía si aún no hay firma."
        allowEmpty
      />
      <TextField
        label="Monto solicitado"
        value={draft.requestedAmount}
        onChangeText={(value) => refreshPlan({ requestedAmount: maskMoneyInput(value) })}
        placeholder="RD$0.00"
        error={errors.requestedAmount}
        keyboardType="number-pad"
      />
      <Checkbox
        label="¿Seguro saldo?"
        sublabel={
          draft.insurancePaid
            ? 'El seguro está saldo. No se requerirán cuotas ni se generarán los documentos del seguro al crear el expediente.'
            : 'Marca esta opción si el seguro ya está saldo y no requiere financiamiento ni documentos del seguro.'
        }
        checked={draft.insurancePaid}
        onChange={(checked) => draft.patch({ insurancePaid: checked })}
      />
      {draft.insurancePaid ? null : (
        <>
          <TextField
            label="Monto de cada cuota del seguro"
            value={draft.insuranceInstallment}
            onChangeText={(value) => draft.patch({ insuranceInstallment: maskMoneyInput(value) })}
            placeholder="RD$0.00"
            error={errors.insuranceInstallment}
            keyboardType="number-pad"
          />
          <TextField
            label="Cantidad de cuotas del seguro"
            value={draft.insuranceInstallmentCount}
            onChangeText={(value) => draft.patch({ insuranceInstallmentCount: value.replace(/\D/g, '') })}
            error={errors.insuranceInstallmentCount}
            keyboardType="number-pad"
          />
        </>
      )}
      <TextField
        label="Cantidad de cuotas"
        value={draft.installmentsCount}
        onChangeText={(value) => refreshPlan({ installmentsCount: value.replace(/\D/g, '') })}
        error={errors.installmentsCount}
        keyboardType="number-pad"
      />

      <AppText variant="subheading" style={styles.section}>
        Datos del vehículo
      </AppText>
      {vehicle('kind', 'Tipo de vehículo', 'Escribe o selecciona')}
      {vehicle('brand', 'Marca', 'Marca')}
      {vehicle('model', 'Modelo', 'Modelo')}
      {vehicle('year', 'Año', 'Año')}
      {vehicle('color', 'Color', 'Color')}
      {vehicle('registration', 'Matrícula')}
      {vehicle('plate', 'Placa')}
      {vehicle('chassis', 'Chasis')}
      {vehicle('engine', 'Motor o número de serie')}
    </Screen>
  );
}

const requestKeys: Record<keyof RequestErrors, true> = {
  requestDate: true,
  signDate: true,
  requestedAmount: true,
  insuranceInstallment: true,
  insuranceInstallmentCount: true,
  installmentsCount: true,
};

const styles = StyleSheet.create({
  section: { marginTop: 8 },
});
