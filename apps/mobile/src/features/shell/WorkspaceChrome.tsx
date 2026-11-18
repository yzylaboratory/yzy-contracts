import { Stack, useRouter } from 'expo-router';
import { Platform } from 'react-native';
import { useGate } from '../access';
import { AccountMenuToolbar } from './AccountMenuToolbar';
import { addIcon, backIcon } from './toolbar-icons';

export function WorkspaceChrome({ newCase = false }: { newCase?: boolean }) {
  const router = useRouter();
  const { me } = useGate();
  if (!me) return null;

  return (
    <>
      <Stack.Toolbar placement="left">
        <Stack.Toolbar.Button accessibilityLabel="Mis empresas" onPress={() => router.replace('/companies')}>
          {Platform.OS === 'ios' ? <Stack.Toolbar.Icon sf="chevron.left" /> : <Stack.Toolbar.Icon src={backIcon} />}
          <Stack.Toolbar.Label>Mis empresas</Stack.Toolbar.Label>
        </Stack.Toolbar.Button>
      </Stack.Toolbar>
      <AccountMenuToolbar me={me} mode="workspace">
        {(menu) => (
          <Stack.Toolbar placement="right">
            {newCase ? (
              <Stack.Toolbar.Button accessibilityLabel="Nuevo expediente" onPress={() => router.push('/nuevo-expediente')}>
                {Platform.OS === 'ios' ? <Stack.Toolbar.Icon sf="plus" /> : <Stack.Toolbar.Icon src={addIcon} />}
              </Stack.Toolbar.Button>
            ) : null}
            {menu}
          </Stack.Toolbar>
        )}
      </AccountMenuToolbar>
    </>
  );
}