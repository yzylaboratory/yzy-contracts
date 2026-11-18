import { ClientsScreen } from '../../../src/features/clients';
import { WorkspaceChrome } from '../../../src/features/shell/WorkspaceChrome';

export default function ClientesTab() {
  return (
    <>
      <WorkspaceChrome />
      <ClientsScreen />
    </>
  );
}