export function isCompanyOverdue(
  me: { overdue_company_ids: readonly string[] } | undefined,
  companyId: string,
): boolean {
  return me?.overdue_company_ids.includes(companyId) === true;
}
