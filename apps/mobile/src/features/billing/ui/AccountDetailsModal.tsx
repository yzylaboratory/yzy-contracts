import { Modal, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { colors, radius, space } from '../../../shared/theme/tokens';
import { AppText } from '../../../shared/ui/AppText';
import { Button } from '../../../shared/ui/Button';
import {
  accountMembershipStatus,
  billingAmount,
  billingDate,
  billingUsdAmount,
  invoicePeriod,
} from '../presentation';
import type { BankAccount, BillingAccount, BillingInvoice, BillingPricing } from '../types';
import { Badge } from './Badge';
import { InvoiceStatus } from './InvoiceStatus';

type Props = {
  account: BillingAccount | null;
  invoices: BillingInvoice[];
  pricing: BillingPricing;
  bankAccount: BankAccount | null;
  preparing?: boolean;
  onClose: () => void;
  onRenew?: () => void;
  onPay: (invoiceId: string) => void;
  onView: (invoiceId: string) => void;
};

export function AccountDetailsModal({
  account,
  invoices,
  pricing,
  bankAccount,
  preparing = false,
  onClose,
  onRenew,
  onPay,
  onView,
}: Props) {
  if (!account) return null;

  const status = accountMembershipStatus(account, invoices);
  const related = invoices.filter((invoice) => invoice.account_id === account.id);
  const canRenew = status.canRenew && bankAccount !== null && account.companies.length > 0;
  const entryBenefit = status.label === 'Beneficio de entrada';
  const usdTotal = account.companies.reduce(
    (total, company) => total + (company.price_usd_minor ?? pricing.price_usd_minor),
    0,
  );

  return (
    <Modal visible={Boolean(account)} transparent animationType="slide" onRequestClose={onClose}>
      <Pressable style={styles.backdrop} onPress={onClose}>
        <Pressable style={styles.sheet} onPress={(e) => e.stopPropagation()} accessibilityViewIsModal>
          <ScrollView contentContainerStyle={styles.scrollContent} bounces={false}>
            <View style={styles.header}>
              <AppText variant="title">{account.name}</AppText>
              <View style={styles.statusGroup}>
                <Badge tone={status.tone} dot>
                  {status.label}
                </Badge>
                {status.relevantOn && (
                  <AppText variant="body" tone="muted">
                    {status.relevantLabel} {billingDate(status.relevantOn)}
                  </AppText>
                )}
              </View>
            </View>

            <View style={styles.amountBlock}>
              <AppText variant="display">
                {entryBenefit ? billingUsdAmount(usdTotal) : billingAmount(account.monthly_total_minor)}
              </AppText>
              <AppText variant="body" tone="secondary">
                {entryBenefit
                  ? `Beneficio de entrada · luego ${billingAmount(account.monthly_total_minor)}/mes`
                  : `Total mensual · ${billingAmount(account.monthly_total_minor)}`}
                {' · '}
                {account.companies.length === 1 ? '1 empresa' : `${account.companies.length} empresas`}
              </AppText>
            </View>

            <View style={styles.section}>
              <AppText variant="subheading">Empresas incluidas</AppText>
              {account.companies.length > 0 ? (
                <View style={styles.companyList}>
                  {account.companies.map((company) => (
                    <View key={company.id} style={styles.companyItem}>
                      <AppText variant="bodyStrong">{company.name}</AppText>
                      <AppText variant="caption" tone="secondary">
                        {billingUsdAmount(company.price_usd_minor ?? pricing.price_usd_minor)}
                        {' / '}
                        {billingAmount(company.unit_price_minor)}
                      </AppText>
                    </View>
                  ))}
                </View>
              ) : (
                <AppText variant="body" tone="muted">
                  Esta cuenta aún no tiene empresas incluidas.
                </AppText>
              )}
            </View>

            {related.length > 0 && (
              <View style={styles.section}>
                <AppText variant="subheading">Facturas de esta cuenta</AppText>
                <View style={styles.invoiceList}>
                  {related.slice(0, 5).map((invoice) => {
                    const payable = invoice.state === 'pending' && bankAccount !== null;
                    return (
                      <View key={invoice.id} style={styles.invoiceRow}>
                        <View style={styles.invoiceInfo}>
                          <AppText variant="bodyStrong">{invoicePeriod(invoice)}</AppText>
                          <AppText variant="caption" tone="secondary">
                            {billingAmount(invoice.total_minor)}
                          </AppText>
                        </View>
                        <View style={styles.invoiceActionGroup}>
                          <InvoiceStatus invoice={invoice} />
                          <Button
                            label={payable ? 'Pagar' : 'Ver'}
                            variant="secondary"
                            fullWidth={false}
                            onPress={() => (payable ? onPay(invoice.id) : onView(invoice.id))}
                          />
                        </View>
                      </View>
                    );
                  })}
                </View>
              </View>
            )}

            <View style={styles.actions}>
              {canRenew && onRenew && (
                <Button
                  label="Renovar membresía"
                  loading={preparing}
                  onPress={onRenew}
                />
              )}
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
    maxHeight: '88%',
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
  amountBlock: {
    gap: 4,
    paddingVertical: space.xs,
  },
  section: {
    gap: space.xs,
  },
  companyList: {
    backgroundColor: colors.surfaceRaised,
    borderRadius: radius.small,
    borderWidth: 1,
    borderColor: colors.borderSubtle,
    padding: space.sm,
    gap: space.xs,
  },
  companyItem: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 4,
  },
  invoiceList: {
    backgroundColor: colors.surfaceRaised,
    borderRadius: radius.small,
    borderWidth: 1,
    borderColor: colors.borderSubtle,
    padding: space.sm,
    gap: space.xs,
  },
  invoiceRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: space.xs,
    borderBottomWidth: 1,
    borderBottomColor: colors.borderSubtle,
  },
  invoiceInfo: {
    flex: 1,
    gap: 2,
  },
  invoiceActionGroup: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.xs,
  },
  actions: {
    gap: space.xs,
    marginTop: space.xs,
    paddingBottom: space.md,
  },
});
