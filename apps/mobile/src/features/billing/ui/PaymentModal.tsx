// Note: "Descargar PDF" is skipped per specification instructions.
import { useState } from 'react';
import {
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  View,
} from 'react-native';
import { colors, radius, space } from '../../../shared/theme/tokens';
import { AppText } from '../../../shared/ui/AppText';
import { Button } from '../../../shared/ui/Button';
import { Chip } from '../../../shared/ui/Chip';
import { TextField } from '../../../shared/ui/TextField';
import { billingErrorMessage } from '../errors';
import { billingAmount, billingDate, invoicePeriod } from '../presentation';
import { expectedTransferTotal } from '../transfer';
import type { BankAccount, BillingInvoice, PaymentStep } from '../types';
import { Badge } from './Badge';
import { BankDetails } from './BankDetails';
import { InvoiceBreakdown } from './InvoiceBreakdown';
import { InvoiceStatus } from './InvoiceStatus';

type Props = {
  invoice: BillingInvoice | null;
  bankAccount: BankAccount | null;
  busy?: boolean;
  onClose: () => void;
  onReportTransfer: (params: {
    invoiceId: string;
    reference: string;
    months: number;
    renewalMonthLimit: number;
    invoiceTotalMinor: number;
  }) => Promise<void> | void;
};

export function PaymentModal({
  invoice,
  bankAccount,
  busy = false,
  onClose,
  onReportTransfer,
}: Props) {
  const [step, setStep] = useState<PaymentStep>('invoice');
  const [duration, setDuration] = useState<number>(1);
  const [reference, setReference] = useState<string>('');
  const [referenceError, setReferenceError] = useState<string>('');
  const [submitError, setSubmitError] = useState<string>('');

  if (!invoice) return null;
  const current = invoice;

  const monthLimit = Math.min(bankAccount ? current.renewal_month_limit : 1, 12);
  const months = Math.min(duration, monthLimit);
  const quote = expectedTransferTotal(current.total_minor, months);
  const preview = {
    ...current,
    months,
    discount_minor: quote.discountMinor,
    total_minor: quote.expectedTotalMinor,
  };

  async function handleSubmit() {
    if (!bankAccount || busy) return;
    if (!reference.trim()) {
      setReferenceError('Ingresa la referencia que aparece en tu comprobante bancario.');
      return;
    }
    setReferenceError('');
    setSubmitError('');
    try {
      await onReportTransfer({
        invoiceId: current.id,
        reference: reference.trim(),
        months,
        renewalMonthLimit: current.renewal_month_limit,
        invoiceTotalMinor: current.total_minor,
      });
      setStep('confirmation');
    } catch (failure) {
      setSubmitError(billingErrorMessage(failure));
    }
  }

  function handleClose() {
    setStep('invoice');
    setReference('');
    setReferenceError('');
    setSubmitError('');
    setDuration(1);
    onClose();
  }

  return (
    <Modal visible={Boolean(invoice)} transparent animationType="slide" onRequestClose={handleClose}>
      <Pressable style={styles.backdrop} onPress={handleClose}>
        <KeyboardAvoidingView
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
          style={styles.keyboardView}
        >
          <Pressable style={styles.sheet} onPress={(e) => e.stopPropagation()} accessibilityViewIsModal>
            <ScrollView contentContainerStyle={styles.scrollContent} bounces={false}>
              <View style={styles.header}>
                <AppText variant="title">Pago de membresía</AppText>
                <View style={styles.stepper} accessibilityRole="tablist" accessibilityLabel="Pasos del pago">
                  <StepIndicator active={step === 'invoice'} done={step !== 'invoice'} label="Factura" />
                  <StepIndicator active={step === 'transfer'} done={step === 'confirmation'} label="Transferencia" />
                  <StepIndicator active={step === 'confirmation'} done={false} label="Confirmación" />
                </View>
              </View>

              {step === 'invoice' && (
                <View style={styles.stepContent}>
                  <AppText variant="body" tone="secondary">
                    Revisa el importe antes de continuar con la transferencia.
                  </AppText>

                  <View style={styles.card}>
                    <View style={styles.rowBetween}>
                      <AppText variant="bodyStrong">Membresía mensual</AppText>
                      <InvoiceStatus invoice={invoice} />
                    </View>
                    <AppText variant="caption" tone="secondary">
                      {invoice.account_name} · {invoicePeriod(invoice)}
                    </AppText>
                  </View>

                  <View style={[styles.card, styles.totalBox]}>
                    <AppText variant="body" tone="secondary">
                      Total a pagar
                    </AppText>
                    <AppText variant="display">{billingAmount(invoice.total_minor)}</AppText>
                  </View>

                  {!bankAccount && (
                    <AppText variant="caption" tone="muted">
                      Los datos bancarios aún no están disponibles. Contacta con YZY Labs para coordinar el pago.
                    </AppText>
                  )}

                  <View style={styles.actions}>
                    <Button
                      label="Pagar por transferencia"
                      disabled={!bankAccount}
                      onPress={() => setStep('transfer')}
                    />
                    <Button label="Cerrar" variant="secondary" onPress={handleClose} />
                  </View>
                </View>
              )}

              {step === 'transfer' && (
                <View style={styles.stepContent}>
                  <View style={styles.sectionHeader}>
                    <AppText variant="subheading">
                      {monthLimit > 1 ? 'Renovar membresía' : 'Datos de la membresía'}
                    </AppText>
                    <AppText variant="bodyStrong">{invoice.account_name}</AppText>
                    <AppText variant="caption" tone="secondary">
                      Vencimiento de la primera cuota: {billingDate(invoice.due_on)}
                    </AppText>
                  </View>

                  {monthLimit > 1 && (
                    <View style={styles.durationSection}>
                      <AppText variant="label" tone="secondary">
                        Duración
                      </AppText>
                      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.durationChips}>
                        {Array.from({ length: monthLimit }, (_, idx) => {
                          const num = idx + 1;
                          const label = num === 1 ? '1 mes' : `${num} meses`;
                          return (
                            <Chip
                              key={num}
                              label={label}
                              selected={months === num}
                              onPress={() => setDuration(num)}
                            />
                          );
                        })}
                      </ScrollView>
                      <AppText variant="caption" tone="muted">
                        Ahorra un 10 % al pagar de 2 a 12 meses por adelantado.
                      </AppText>
                    </View>
                  )}

                  <View style={styles.card}>
                    <AppText variant="caption" tone="muted">
                      Período: {invoicePeriod(preview)}
                    </AppText>
                    <InvoiceBreakdown invoice={preview} totalLabel="Total a transferir" />
                  </View>

                  {bankAccount && (
                    <View style={styles.section}>
                      <AppText variant="subheading">Datos de la transferencia</AppText>
                      <BankDetails bankAccount={bankAccount} memo={invoice.transfer_memo} />
                      <TextField
                        label="Número de referencia"
                        value={reference}
                        onChangeText={(val) => {
                          setReference(val);
                          setReferenceError('');
                        }}
                        placeholder="Ej. 987654321"
                        error={referenceError || null}
                        hint="Escribe la referencia que aparece en tu comprobante después de hacer la transferencia."
                      />
                    </View>
                  )}

                  {submitError ? (
                    <AppText variant="body" tone="danger">
                      {submitError}
                    </AppText>
                  ) : null}

                  <View style={styles.actions}>
                    {bankAccount && (
                      <Button
                        label="Reportar transferencia"
                        loading={busy}
                        onPress={handleSubmit}
                      />
                    )}
                    <Button label="Atrás" variant="secondary" onPress={() => setStep('invoice')} />
                  </View>
                </View>
              )}

              {step === 'confirmation' && (
                <View style={styles.confirmationContent}>
                  <View style={styles.confirmationBox}>
                    <Badge tone="info" dot>
                      En revisión
                    </Badge>
                    <AppText variant="title">Transferencia reportada</AppText>
                    <AppText variant="body" tone="secondary" style={styles.centerText}>
                      Revisaremos la referencia y te confirmaremos el pago. Puedes seguir el estado en el historial.
                    </AppText>
                  </View>
                  <View style={styles.actions}>
                    <Button label="Listo" onPress={handleClose} />
                  </View>
                </View>
              )}
            </ScrollView>
          </Pressable>
        </KeyboardAvoidingView>
      </Pressable>
    </Modal>
  );
}

function StepIndicator({ active, done, label }: { active: boolean; done: boolean; label: string }) {
  return (
    <View
      style={[
        styles.stepItem,
        active && styles.stepItemActive,
        done && styles.stepItemDone,
      ]}
      accessibilityRole="tab"
      accessibilityState={{ selected: active }}
    >
      <AppText
        variant="caption"
        style={[
          styles.stepText,
          active && styles.stepTextActive,
          done && styles.stepTextDone,
        ]}
      >
        {label}
      </AppText>
    </View>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(27,31,87,0.35)',
    justifyContent: 'flex-end',
  },
  keyboardView: {
    maxHeight: '92%',
  },
  sheet: {
    backgroundColor: colors.background,
    borderTopLeftRadius: radius.card,
    borderTopRightRadius: radius.card,
  },
  scrollContent: {
    padding: space.lg,
    gap: space.md,
  },
  header: {
    gap: space.sm,
  },
  stepper: {
    flexDirection: 'row',
    gap: space.xs,
    backgroundColor: colors.surfaceMuted,
    padding: 4,
    borderRadius: radius.control,
  },
  stepItem: {
    flex: 1,
    paddingVertical: 6,
    alignItems: 'center',
    borderRadius: radius.small,
  },
  stepItemActive: {
    backgroundColor: colors.surfaceRaised,
  },
  stepItemDone: {
    backgroundColor: 'transparent',
  },
  stepText: {
    color: colors.textSecondary,
    fontFamily: 'Inter_500Medium',
  },
  stepTextActive: {
    color: colors.ink,
    fontFamily: 'Inter_600SemiBold',
  },
  stepTextDone: {
    color: colors.greenStrong,
  },
  stepContent: {
    gap: space.md,
  },
  card: {
    backgroundColor: colors.surfaceRaised,
    borderRadius: radius.small,
    borderWidth: 1,
    borderColor: colors.borderSubtle,
    padding: space.md,
    gap: space.xs,
  },
  rowBetween: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  totalBox: {
    alignItems: 'center',
    gap: 4,
    paddingVertical: space.md,
  },
  sectionHeader: {
    gap: 4,
  },
  durationSection: {
    gap: space.xs,
  },
  durationChips: {
    gap: space.xs,
    paddingVertical: 4,
  },
  section: {
    gap: space.xs,
  },
  actions: {
    gap: space.xs,
    marginTop: space.xs,
    paddingBottom: space.md,
  },
  confirmationContent: {
    paddingVertical: space.xl,
    gap: space.xl,
  },
  confirmationBox: {
    alignItems: 'center',
    gap: space.sm,
  },
  centerText: {
    textAlign: 'center',
    maxWidth: 320,
  },
});
