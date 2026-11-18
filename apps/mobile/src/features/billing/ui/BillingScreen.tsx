import { Ionicons } from '@expo/vector-icons';
import { useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { colors, radius, space } from '../../../shared/theme/tokens';
import { AppText } from '../../../shared/ui/AppText';
import { Button } from '../../../shared/ui/Button';
import { Card } from '../../../shared/ui/Card';
import { Notice } from '../../../shared/ui/Notice';
import { Screen } from '../../../shared/ui/Screen';
import { SegmentedControl } from '../../../shared/ui/SegmentedControl';
import { Skeleton } from '../../../shared/ui/Skeleton';
import { EmptyState, ErrorState } from '../../../shared/ui/StateViews';
import { billingErrorMessage } from '../errors';
import { useBillingOverview, usePrepareRenewal, useReportTransfer } from '../hooks';
import {
  accountMembershipStatus,
  billingAmount,
  billingOverviewStatus,
  billingShortDate,
  billingUsdAmount,
  invoicePeriod,
} from '../presentation';
import type { HistoryFilter } from '../types';
import { AccountDetailsModal } from './AccountDetailsModal';
import { Badge } from './Badge';
import { InvoiceDetailsModal } from './InvoiceDetailsModal';
import { InvoiceStatus } from './InvoiceStatus';
import { PaymentModal } from './PaymentModal';

const HISTORY_FILTER_OPTIONS: readonly { value: HistoryFilter; label: string }[] = [
  { value: 'all', label: 'Todas' },
  { value: 'pending', label: 'Pendientes' },
  { value: 'in_review', label: 'En revisión' },
  { value: 'paid', label: 'Pagadas' },
];

export function BillingScreen() {
  const { data, isPending, isError, error, refetch } = useBillingOverview();
  const reportTransferMutation = useReportTransfer();
  const prepareRenewalMutation = usePrepareRenewal();

  const [paymentId, setPaymentId] = useState<string | null>(null);
  const [detailsId, setDetailsId] = useState<string | null>(null);
  const [accountDetailsId, setAccountDetailsId] = useState<string | null>(null);
  const [historyFilter, setHistoryFilter] = useState<HistoryFilter>('all');
  const [notice, setNotice] = useState<string>('');
  const [renewalError, setRenewalError] = useState<string>('');

  if (isPending) {
    return (
      <Screen>
        <View style={styles.loadingContainer}>
          <AppText variant="subheading" tone="muted" accessibilityLiveRegion="polite">
            Cargando membresía…
          </AppText>
          <Skeleton height={140} />
          <Skeleton height={180} />
          <Skeleton height={180} />
        </View>
      </Screen>
    );
  }

  if (isError || !data) {
    return (
      <Screen>
        <ErrorState
          title="Error de membresía"
          body={error?.message ?? 'No se pudo cargar la membresía. Intenta de nuevo.'}
          onRetry={() => void refetch()}
          retryLabel="Reintentar"
        />
      </Screen>
    );
  }

  const { accounts, invoices, bank_account: bankAccount, pricing } = data;

  if (accounts.length === 0) {
    return (
      <Screen>
        <EmptyState
          title="Sin cuentas de facturación"
          body="Todavía no tienes cuentas de facturación."
        />
      </Screen>
    );
  }
  const paymentInvoice = invoices.find((inv) => inv.id === paymentId) ?? null;
  const detailsInvoice = invoices.find((inv) => inv.id === detailsId) ?? null;
  const accountDetails = accounts.find((acc) => acc.id === accountDetailsId) ?? null;

  const overdue = invoices.some((invoice) => invoice.is_overdue && invoice.state !== 'paid');
  const overview = billingOverviewStatus(invoices);
  const companyCount = accounts.reduce((total, account) => total + account.companies.length, 0);
  const monthlyTotal = accounts.reduce((total, account) => total + account.monthly_total_minor, 0);
  const pendingInvoices = invoices
    .filter((invoice) => invoice.state === 'pending')
    .sort((left, right) => left.due_on.localeCompare(right.due_on));
  const pendingTotal = pendingInvoices.reduce((total, invoice) => total + invoice.total_minor, 0);
  const filteredInvoices =
    historyFilter === 'all' ? invoices : invoices.filter((invoice) => invoice.state === historyFilter);

  async function handleRenew(billingAccountId: string) {
    setRenewalError('');
    try {
      const invoice = await prepareRenewalMutation.mutateAsync(billingAccountId);
      setAccountDetailsId(null);
      setPaymentId(invoice.id);
    } catch (failure) {
      setRenewalError(billingErrorMessage(failure));
    }
  }

  async function handleReportTransfer(params: {
    invoiceId: string;
    reference: string;
    months: number;
    renewalMonthLimit: number;
    invoiceTotalMinor: number;
  }) {
    await reportTransferMutation.mutateAsync(params);
    setNotice('Transferencia reportada. Puedes consultar aquí el resultado de la revisión.');
  }

  return (
    <Screen>
      <View style={styles.container}>
        {overdue && (
          <Notice
            tone="danger"
            message="Hay facturas vencidas. Las funciones de trabajo de las empresas bloqueadas se reactivarán al confirmar el pago pendiente."
          />
        )}

        {notice ? <Notice tone="info" message={notice} /> : null}
        {renewalError ? <Notice tone="danger" message={renewalError} /> : null}

        {/* Header and Summary */}
        <Card style={styles.summaryCard}>
          <View style={styles.summaryHeader}>
            <View style={styles.titleArea}>
              <AppText variant="title">Membresías</AppText>
              <AppText variant="body" tone="secondary">
                Gestiona tus empresas, pagos y renovaciones.
              </AppText>
            </View>
            <Badge tone={overview.tone} dot>
              {overview.label}
            </Badge>
          </View>

          <View style={styles.summaryGrid}>
            <View style={styles.summaryItem}>
              <AppText variant="caption" tone="muted">
                Empresas
              </AppText>
              <AppText variant="subheading">
                {companyCount} {companyCount === 1 ? 'Registrada' : 'Registradas'}
              </AppText>
            </View>

            <View style={styles.summaryItem}>
              <AppText variant="caption" tone="muted">
                Total mensual
              </AppText>
              <AppText variant="subheading">{billingAmount(monthlyTotal)}</AppText>
              <AppText variant="caption" tone="muted">
                {accounts.length === 1 ? '1 membresía' : `${accounts.length} membresías`}
              </AppText>
            </View>

            <View style={styles.summaryItem}>
              <AppText variant="caption" tone="muted">
                Pendiente
              </AppText>
              <AppText variant="subheading">{billingAmount(pendingTotal)}</AppText>
              <AppText variant="caption" tone="muted">
                {pendingInvoices.length === 0
                  ? 'Sin facturas'
                  : pendingInvoices.length === 1
                    ? '1 factura'
                    : `${pendingInvoices.length} facturas`}
              </AppText>
            </View>
          </View>
        </Card>

        {/* Tus membresías */}
        <View style={styles.section}>
          <AppText variant="title">Tus membresías</AppText>

          <View style={styles.accountList}>
            {accounts.map((account) => {
                const status = accountMembershipStatus(account, invoices);
                const companyLabel =
                  account.companies.length === 1 ? '1 empresa' : `${account.companies.length} empresas`;

                return (
                  <Card key={account.id} style={styles.accountCard}>
                    <View style={styles.accountHeader}>
                      <View style={styles.accountIconBox}>
                        <Ionicons name="business-outline" size={20} color={colors.navy} />
                      </View>
                      <View style={styles.accountTitleBlock}>
                        <AppText variant="bodyStrong">{account.name}</AppText>
                        <AppText variant="caption" tone="secondary">
                          {companyLabel}
                          {status.relevantOn
                            ? ` · ${status.relevantLabel} ${billingShortDate(status.relevantOn)}`
                            : ` · Desde ${billingShortDate(account.starts_on)}`}
                        </AppText>
                      </View>
                      <View style={styles.accountBadge}>
                        <Badge tone={status.tone} size="sm" dot>
                          {status.label}
                        </Badge>
                      </View>
                    </View>

                    {status.label === 'Beneficio de entrada' && (
                      <AppText variant="caption" tone="secondary">
                        Incluye acceso hasta esa fecha. Luego{' '}
                        {billingUsdAmount(
                          account.companies.reduce(
                            (total, company) =>
                              total + (company.price_usd_minor ?? pricing.price_usd_minor),
                            0,
                          ),
                        )}{' '}
                        /mes ({billingAmount(account.monthly_total_minor)} al tipo de cambio actual).
                      </AppText>
                    )}

                    <View style={styles.accountFooter}>
                      <View style={styles.accountPrice}>
                        <AppText variant="subheading" style={styles.shrinkText}>
                          {status.label === 'Beneficio de entrada' ? (
                            <>
                              {billingUsdAmount(
                                account.companies.reduce(
                                  (total, company) =>
                                    total + (company.price_usd_minor ?? pricing.price_usd_minor),
                                  0,
                                ),
                              )}{' '}
                              /mes después
                            </>
                          ) : (
                            <>{billingAmount(account.monthly_total_minor)} /mes</>
                          )}
                        </AppText>
                      </View>
                      <Button
                        label="Ver detalles"
                        variant="secondary"
                        fullWidth={false}
                        onPress={() => setAccountDetailsId(account.id)}
                      />
                    </View>
                  </Card>
                );
            })}
          </View>
        </View>

        {/* Facturación y pagos */}
        <View style={styles.section}>
          <View style={styles.sectionTitleBlock}>
            <AppText variant="title">Facturación y pagos</AppText>
            <AppText variant="body" tone="secondary">
              Facturas pendientes, historial y comprobantes.
            </AppText>
          </View>

          {/* Pending Invoices List */}
          {pendingInvoices.length > 0 && (
            <View style={styles.pendingSection}>
              <AppText variant="subheading">Facturas pendientes</AppText>
              {pendingInvoices.map((invoice) => (
                <Card key={invoice.id} style={styles.pendingCard}>
                  <View style={styles.pendingCardTop}>
                    <View style={styles.pendingCardInfo}>
                      <AppText variant="bodyStrong">{invoice.account_name}</AppText>
                      <AppText variant="caption" tone="secondary">
                        {invoicePeriod(invoice)} · Vence el {billingShortDate(invoice.due_on)}
                      </AppText>
                    </View>
                    <InvoiceStatus invoice={invoice} />
                  </View>
                  <View style={styles.pendingCardBottom}>
                    <AppText variant="title" style={styles.shrinkText}>
                      {billingAmount(invoice.total_minor)}
                    </AppText>
                    {bankAccount && (
                      <Button
                        label="Pagar factura"
                        fullWidth={false}
                        onPress={() => setPaymentId(invoice.id)}
                      />
                    )}
                  </View>
                </Card>
              ))}
            </View>
          )}

          {/* Filter */}
          <View style={styles.filterBlock}>
            <SegmentedControl
              options={HISTORY_FILTER_OPTIONS}
              value={historyFilter}
              onChange={setHistoryFilter}
              accessibilityLabel="Filtro de facturas"
            />
          </View>

          {/* Filtered invoices list */}
          {filteredInvoices.length > 0 ? (
            <View style={styles.historyList}>
              {filteredInvoices.map((invoice) => {
                const payable = invoice.state === 'pending' && bankAccount !== null;
                const actionLabel = payable ? 'Pagar factura' : 'Ver factura';

                return (
                  <Card key={invoice.id} style={styles.historyCard}>
                    <View style={styles.historyCardHeader}>
                      <View style={styles.historyMainInfo}>
                        <AppText variant="bodyStrong">{invoicePeriod(invoice)}</AppText>
                        <AppText variant="caption" tone="secondary">
                          {invoice.account_name}
                        </AppText>
                      </View>
                      <InvoiceStatus invoice={invoice} />
                    </View>

                    <View style={styles.historyMetaRow}>
                      <View>
                        <AppText variant="caption" tone="muted">
                          Vencimiento
                        </AppText>
                        <AppText variant="body">
                          {billingShortDate(invoice.due_on)}
                        </AppText>
                      </View>
                      <View style={styles.alignRight}>
                        <AppText variant="caption" tone="muted">
                          Importe
                        </AppText>
                        <AppText variant="bodyStrong">
                          {billingAmount(invoice.total_minor)}
                        </AppText>
                      </View>
                    </View>

                    <View style={styles.historyActionRow}>
                      <Button
                        label={actionLabel}
                        variant="secondary"
                        fullWidth={false}
                        onPress={() => {
                          if (payable) setPaymentId(invoice.id);
                          else setDetailsId(invoice.id);
                        }}
                      />
                    </View>
                  </Card>
                );
              })}
            </View>
          ) : (
            <EmptyState
              title="Todavía no hay facturas"
              body={
                historyFilter === 'all'
                  ? 'Cuando se emitan facturas, aparecerán aquí junto con sus estados y comprobantes.'
                  : 'No hay facturas con este filtro.'
              }
            />
          )}
        </View>

        {/* Modals */}
        <PaymentModal
          invoice={paymentInvoice}
          bankAccount={bankAccount}
          busy={reportTransferMutation.isPending}
          onClose={() => setPaymentId(null)}
          onReportTransfer={handleReportTransfer}
        />

        <InvoiceDetailsModal
          invoice={detailsInvoice}
          onClose={() => setDetailsId(null)}
        />

        <AccountDetailsModal
          account={accountDetails}
          invoices={invoices}
          pricing={pricing}
          bankAccount={bankAccount}
          preparing={prepareRenewalMutation.isPending}
          onClose={() => setAccountDetailsId(null)}
          onRenew={() => accountDetails && void handleRenew(accountDetails.id)}
          onPay={(id) => {
            setAccountDetailsId(null);
            setPaymentId(id);
          }}
          onView={(id) => {
            setAccountDetailsId(null);
            setDetailsId(id);
          }}
        />
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  container: {
    gap: space.lg,
  },
  loadingContainer: {
    gap: space.md,
    paddingVertical: space.md,
  },
  summaryCard: {
    gap: space.md,
  },
  summaryHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    gap: space.sm,
  },
  titleArea: {
    flex: 1,
    gap: 2,
  },
  summaryGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'space-between',
    paddingTop: space.sm,
    borderTopWidth: 1,
    borderTopColor: colors.borderSubtle,
    gap: space.sm,
  },
  summaryItem: {
    width: '47%',
    gap: 2,
  },
  section: {
    gap: space.md,
  },
  sectionTitleBlock: {
    gap: 2,
  },
  accountList: {
    gap: space.sm,
  },
  accountCard: {
    gap: space.sm,
  },
  accountHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm,
  },
  accountIconBox: {
    width: 36,
    height: 36,
    borderRadius: radius.small,
    backgroundColor: colors.wordSurface,
    alignItems: 'center',
    justifyContent: 'center',
  },
  accountTitleBlock: {
    flex: 1,
    gap: 2,
  },
  accountBadge: {
    alignSelf: 'flex-start',
    flexShrink: 0,
  },
  accountPrice: {
    flexShrink: 1,
  },
  shrinkText: {
    flexShrink: 1,
  },
  accountFooter: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: space.sm,
    paddingTop: space.xs,
    borderTopWidth: 1,
    borderTopColor: colors.borderSubtle,
  },
  pendingSection: {
    gap: space.sm,
  },
  pendingCard: {
    gap: space.sm,
    borderColor: colors.borderStrong,
  },
  pendingCardTop: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    gap: space.sm,
  },
  pendingCardInfo: {
    flex: 1,
    gap: 2,
  },
  pendingCardBottom: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: space.sm,
    paddingTop: space.xs,
    borderTopWidth: 1,
    borderTopColor: colors.borderSubtle,
  },
  filterBlock: {
    marginVertical: space.xs,
  },
  historyList: {
    gap: space.sm,
  },
  historyCard: {
    gap: space.sm,
  },
  historyCardHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    gap: space.sm,
  },
  historyMainInfo: {
    flex: 1,
    gap: 2,
  },
  historyMetaRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 2,
  },
  alignRight: {
    alignItems: 'flex-end',
  },
  historyActionRow: {
    alignItems: 'flex-end',
    paddingTop: space.xs,
    borderTopWidth: 1,
    borderTopColor: colors.borderSubtle,
  },
});
