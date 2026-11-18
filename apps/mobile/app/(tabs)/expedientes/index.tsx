import { CaseList } from '../../../src/features/cases';
import { useActiveCompany } from '../../../src/features/companies';
import { WorkspaceChrome } from '../../../src/features/shell/WorkspaceChrome';

export default function ExpedientesTab() {
  const active = useActiveCompany();
  return (
    <>
      <WorkspaceChrome newCase />
      {active ? <CaseList companyId={active.companyId} /> : null}
    </>
  );
}