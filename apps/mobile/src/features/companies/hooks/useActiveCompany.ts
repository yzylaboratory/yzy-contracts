import { useActiveCompanyStore } from '../../../lib/storage/active-company';
import { useGate } from '../../access';
import type { CompanyAccess } from '../../../lib/api';

export interface ActiveCompany {
  companyId: string;
  company: CompanyAccess;
}

// The company the user works in. Only valid when the gate is ready.
export function useActiveCompany(): ActiveCompany | null {
  const { me } = useGate();
  const companyId = useActiveCompanyStore((state) => state.companyId);
  if (!me || !companyId) return null;
  const company = me.companies.find((c) => c.id === companyId);
  return company ? { companyId, company } : null;
}
