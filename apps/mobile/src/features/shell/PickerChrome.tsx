import { useGate } from '../access';
import { AccountMenuToolbar } from './AccountMenuToolbar';

export function PickerChrome() {
  const { me } = useGate();
  if (!me) return null;
  return <AccountMenuToolbar me={me} mode="picker" />;
}