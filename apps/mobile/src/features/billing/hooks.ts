import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { queryKeys } from '../../lib/query/keys';
import { getBillingOverview, prepareRenewalInvoice, reportInvoiceTransfer } from './api';
import { billingOverviewIsStale } from './errors';
import type { BillingInvoice, BillingOverview } from './types';

export const BILLING_OVERVIEW_KEY = ['billing', 'overview'] as const;

async function refreshBillingAndAccess(queryClient: ReturnType<typeof useQueryClient>): Promise<void> {
  await Promise.all([
    queryClient.invalidateQueries({ queryKey: BILLING_OVERVIEW_KEY }),
    queryClient.invalidateQueries({ queryKey: queryKeys.me }),
  ]);
}

export function useBillingOverview() {
  return useQuery<BillingOverview, Error>({
    queryKey: BILLING_OVERVIEW_KEY,
    queryFn: getBillingOverview,
  });
}

export type ReportTransferInput = {
  invoiceId: string;
  reference: string;
  months: number;
  renewalMonthLimit: number;
  invoiceTotalMinor: number;
};

export function useReportTransfer() {
  const queryClient = useQueryClient();

  return useMutation<BillingInvoice, Error, ReportTransferInput>({
    mutationFn: (input) => reportInvoiceTransfer(input),
    onSuccess: () => refreshBillingAndAccess(queryClient),
    onError: (error) => {
      if (billingOverviewIsStale(error)) {
        void queryClient.invalidateQueries({ queryKey: BILLING_OVERVIEW_KEY });
      }
    },
  });
}

export function usePrepareRenewal() {
  const queryClient = useQueryClient();

  return useMutation<BillingInvoice, Error, string>({
    mutationFn: (billingAccountId) => prepareRenewalInvoice(billingAccountId),
    onSuccess: () => refreshBillingAndAccess(queryClient),
    onError: (error) => {
      if (billingOverviewIsStale(error)) {
        void queryClient.invalidateQueries({ queryKey: BILLING_OVERVIEW_KEY });
      }
    },
  });
}
