import type { BillingInvoice } from '../types';
import { invoiceStatus } from '../presentation';
import { Badge } from './Badge';

export function InvoiceStatus({ invoice }: { invoice: BillingInvoice }) {
  const { tone, label } = invoiceStatus(invoice);
  return (
    <Badge tone={tone} dot>
      {label}
    </Badge>
  );
}
