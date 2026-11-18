// Note: "Descargar PDF" is skipped per specification instructions.
import { Modal, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { colors, radius, space } from '../../../shared/theme/tokens';
import { AppText } from '../../../shared/ui/AppText';
import { Button } from '../../../shared/ui/Button';
import { billingDate, invoicePeriod } from '../presentation';
import type { BillingInvoice } from '../types';
import { InvoiceBreakdown } from './InvoiceBreakdown';
import { InvoiceStatus } from './InvoiceStatus';

type Props = {
  invoice: BillingInvoice | null;
  onClose: () => void;
};

export function InvoiceDetailsModal({ invoice, onClose }: Props) {
  if (!invoice) return null;

  return (
    <Modal visible={Boolean(invoice)} transparent animationType="slide" onRequestClose={onClose}>
      <Pressable style={styles.backdrop} onPress={onClose}>
        <Pressable style={styles.sheet} onPress={(e) => e.stopPropagation()} accessibilityViewIsModal>
          <ScrollView contentContainerStyle={styles.scrollContent} bounces={false}>
            <View style={styles.header}>
              <AppText variant="title">Factura de {invoicePeriod(invoice)}</AppText>
              <View style={styles.statusGroup}>
                <InvoiceStatus invoice={invoice} />
                <AppText variant="body" tone="muted">
                  Vencimiento: {billingDate(invoice.due_on)}
                </AppText>
              </View>
            </View>

            <InvoiceBreakdown invoice={invoice} />

            {invoice.state === 'paid' && invoice.paid_at && (
              <AppText variant="body" tone="secondary">
                Pago confirmado el {billingDate(invoice.paid_at)}.
              </AppText>
            )}

            {invoice.state === 'in_review' && invoice.transfer_reference && (
              <AppText variant="body" tone="secondary">
                Estamos revisando la transferencia {invoice.transfer_reference}.
              </AppText>
            )}

            <View style={styles.actions}>
              <Button label="Cerrar" variant="secondary" onPress={onClose} />
            </View>
          </ScrollView>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(27,31,87,0.35)',
    justifyContent: 'flex-end',
  },
  sheet: {
    backgroundColor: colors.background,
    borderTopLeftRadius: radius.card,
    borderTopRightRadius: radius.card,
    maxHeight: '85%',
  },
  scrollContent: {
    padding: space.lg,
    gap: space.md,
  },
  header: {
    gap: space.xs,
  },
  statusGroup: {
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: space.xs,
  },
  actions: {
    marginTop: space.xs,
    paddingBottom: space.md,
  },
});
