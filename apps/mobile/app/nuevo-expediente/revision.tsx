import { useActiveCompany } from '../../src/features/companies';
import { ReviewStep } from '../../src/features/case-intake';

export default function RevisionStep() {
  const active = useActiveCompany();
  return active ? <ReviewStep companyId={active.companyId} /> : null;
}
