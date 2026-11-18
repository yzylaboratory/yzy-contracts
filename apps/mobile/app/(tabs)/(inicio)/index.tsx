import { DashboardScreen } from '../../../src/features/dashboard';
import { WorkspaceChrome } from '../../../src/features/shell/WorkspaceChrome';

export default function Inicio() {
  return (
    <>
      <WorkspaceChrome newCase />
      <DashboardScreen />
    </>
  );
}