import { StyleSheet, View } from 'react-native';
import { colors, space } from '../../../shared/theme/tokens';
import { AppText } from '../../../shared/ui/AppText';
import { billingAmount } from '../presentation';
import type { BillingInvoice } from '../types';

type InvoiceLike = Pick<BillingInvoice, 'lines' | 'total_minor'> & {
  months?: number;
  discount_minor?: number;
};

type Props = {
  invoice: InvoiceLike;
  totalLabel?: string;
};

export function InvoiceBreakdown({ invoice, totalLabel = 'Total' }: Props) {
  const duration = invoice.months ?? 1;
  const discount = invoice.discount_minor ?? 0;
  const subtotal = invoice.total_minor + discount;

  return (
    <View style={styles.container}>
      {invoice.lines.map((line) => (
        <View key={line.company_id} style={styles.row}>
          <AppText variant="body" tone="secondary" style={styles.label}>
            {line.company_name}
          </AppText>
          <AppText variant="bodyStrong">{billingAmount(line.unit_price_minor * duration)}</AppText>
        </View>
      ))}

      {duration > 1 && (
        <>
          <View style={styles.row}>
            <AppText variant="body" tone="secondary" style={styles.label}>
              Subtotal
            </AppText>
            <AppText variant="bodyStrong">{billingAmount(subtotal)}</AppText>
          </View>
          <View style={styles.row}>
            <AppText variant="body" tone="secondary" style={styles.label}>
              Descuento por pago adelantado (10 %)
            </AppText>
            <AppText variant="bodyStrong" tone="accent">
              −{billingAmount(discount)}
            </AppText>
          </View>
        </>
      )}

      <View style={[styles.row, styles.totalRow]}>
        <AppText variant="subheading">{totalLabel}</AppText>
        <AppText variant="title">{billingAmount(invoice.total_minor)}</AppText>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    gap: space.xs,
    paddingVertical: space.xs,
  },
  row: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: space.sm,
  },
  label: {
    flex: 1,
  },
  totalRow: {
    marginTop: space.xs,
    paddingTop: space.sm,
    borderTopWidth: 1,
    borderTopColor: colors.borderSubtle,
  },
});
