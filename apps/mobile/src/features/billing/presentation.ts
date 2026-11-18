import type { BillingAccount, BillingInvoice } from './types';

const currency = new Intl.NumberFormat('es-DO', { style: 'currency', currency: 'DOP' });
const usd = new Intl.NumberFormat('es-DO', { style: 'currency', currency: 'USD' });
const dates = new Intl.DateTimeFormat('es-DO', { dateStyle: 'long', timeZone: 'UTC' });
const shortDates = new Intl.DateTimeFormat('es-DO', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' });
const localDates = new Intl.DateTimeFormat('es-DO', { dateStyle: 'long', timeZone: 'America/Santo_Domingo' });
const months = new Intl.DateTimeFormat('es-DO', { month: 'long', year: 'numeric', timeZone: 'UTC' });

export function billingAmount(minorUnits: number) {
  return currency.format(minorUnits / 100);
}

export function billingUsdAmount(minorUnits: number) {
  return usd.format(minorUnits / 100);
}

export function billingExchangeRate(milli: number) {
  return new Intl.NumberFormat('es-DO', { minimumFractionDigits: 2, maximumFractionDigits: 3 }).format(milli / 1000);
}

export function billingDate(value: string) {
  return value.length === 10 ? dates.format(new Date(`${value}T00:00:00Z`)) : localDates.format(new Date(value));
}

export function billingShortDate(value: string) {
  return shortDates.format(new Date(`${value.slice(0, 10)}T00:00:00Z`));
}

export type BadgeTone = 'default' | 'info' | 'warning' | 'danger' | 'success';

export type MembershipStatus = {
  tone: BadgeTone;
  label: string;
  relevantOn: string | null;
  relevantLabel: string;
  canRenew: boolean;
};

export function billingOverviewStatus(invoices: BillingInvoice[]): { tone: BadgeTone; label: string } {
  if (invoices.some((invoice) => invoice.is_overdue && invoice.state !== 'paid')) {
    return { tone: 'danger', label: 'Vencida' };
  }
  if (invoices.some((invoice) => invoice.state === 'in_review')) {
    return { tone: 'info', label: 'En revisión' };
  }
  if (invoices.some((invoice) => invoice.state === 'pending')) {
    return { tone: 'warning', label: 'Pendiente' };
  }
  return { tone: 'success', label: 'Al día' };
}

export function accountMembershipStatus(account: BillingAccount, invoices: BillingInvoice[]): MembershipStatus {
  const related = invoices.filter((invoice) => invoice.account_id === account.id);
  const open = related.filter((invoice) => invoice.state !== 'paid');
  const overdue = open.find((invoice) => invoice.is_overdue);
  const inReview = open.find((invoice) => invoice.state === 'in_review');
  const pending = open
    .filter((invoice) => invoice.state === 'pending')
    .sort((left, right) => left.due_on.localeCompare(right.due_on))[0];

  if (overdue) {
    return { tone: 'danger', label: 'Vencida', relevantOn: overdue.due_on, relevantLabel: 'Venció el', canRenew: false };
  }
  if (inReview) {
    return { tone: 'info', label: 'En revisión', relevantOn: inReview.due_on, relevantLabel: 'Vence el', canRenew: false };
  }
  if (pending) {
    return { tone: 'warning', label: 'Pendiente', relevantOn: pending.due_on, relevantLabel: 'Vence el', canRenew: false };
  }

  const paid = related
    .filter((invoice) => invoice.state === 'paid')
    .sort((left, right) => right.period.localeCompare(left.period))[0];
  if (paid) {
    const coveredUntil = lastBillingMonth(paid.period, paid.months ?? 1);
    const renewOn = new Date(`${coveredUntil}T00:00:00Z`);
    renewOn.setUTCMonth(renewOn.getUTCMonth() + 1);
    return {
      tone: 'success',
      label: 'Al día',
      relevantOn: renewOn.toISOString().slice(0, 10),
      relevantLabel: 'Próxima renovación',
      canRenew: true,
    };
  }

  return {
    tone: 'info',
    label: 'Beneficio de entrada',
    relevantOn: account.starts_on,
    relevantLabel: 'Sin cobro hasta el',
    canRenew: true,
  };
}

export function billingPeriod(value: string) {
  return months.format(new Date(`${value.slice(0, 10)}T00:00:00Z`));
}

export function lastBillingMonth(period: string, duration: number) {
  const last = new Date(`${period.slice(0, 10)}T00:00:00Z`);
  last.setUTCMonth(last.getUTCMonth() + duration - 1);
  return last.toISOString().slice(0, 10);
}

export function invoicePeriod(invoice: { period: string; months?: number }) {
  const start = billingPeriod(invoice.period);
  const duration = invoice.months ?? 1;
  return duration > 1 ? `${start} a ${billingPeriod(lastBillingMonth(invoice.period, duration))}` : start;
}

export function invoiceStatus(invoice: BillingInvoice): { tone: BadgeTone; label: string } {
  if (invoice.state === 'paid') return { tone: 'success', label: 'Pagada' };
  if (invoice.state === 'in_review') return { tone: 'info', label: 'En revisión' };
  if (invoice.is_overdue) return { tone: 'danger', label: 'Vencida' };
  return { tone: 'warning', label: 'Pendiente' };
}
