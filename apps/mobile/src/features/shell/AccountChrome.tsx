import { useGate } from '../access';
import { AccountMenuToolbar } from './AccountMenuToolbar';

// Account menu (Perfil · Cerrar sesión) for every signed-in screen that is not a tab root or the picker.
export function AccountChrome() {
  const { me } = useGate();
  if (!me) return null;
  return <AccountMenuToolbar me={me} mode="workspace" />;
}
