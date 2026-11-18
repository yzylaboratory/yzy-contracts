import { Stack, useRouter } from 'expo-router';
import { Platform } from 'react-native';
import { useEffect, useState, type ReactElement } from 'react';
import { readSupabaseAccountName } from '../../lib/account-profile';
import type { Me } from '../../lib/api';
import { useSignOut } from '../access';
import { accountIcon } from './toolbar-icons';

export type AccountMenuMode = 'picker' | 'workspace';

function initialsFor(name: string, email: string | null): string {
  const trimmed = name.trim();
  if (trimmed) {
    return trimmed
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 2)
      .map((part) => Array.from(part)[0]?.toUpperCase() ?? '')
      .join('');
  }
  const letter = email?.trim()[0]?.toUpperCase();
  return letter ?? '?';
}

export function AccountMenuToolbar({
  me,
  mode,
  children,
}: {
  me: Me;
  mode: AccountMenuMode;
  children?: (menu: ReactElement) => ReactElement;
}) {
  const router = useRouter();
  const signOut = useSignOut();
  const [label, setLabel] = useState(me.email ?? '');

  useEffect(() => {
    let active = true;
    void readSupabaseAccountName(me.id, me.email).then((name) => {
      if (active) setLabel(name || me.email || 'Cuenta');
    });
    return () => {
      active = false;
    };
  }, [me.email, me.id]);

  const menuLabel = label || me.email || 'Cuenta';
  const accessibilityLabel = `Menú de cuenta, ${menuLabel}`;
  const initials = initialsFor(label, me.email);
  const menu = (
    <Stack.Toolbar.Menu accessibilityLabel={accessibilityLabel} icon={Platform.OS === 'ios' ? 'person.crop.circle' : accountIcon}>
      {Platform.OS === 'ios' ? <Stack.Toolbar.Label>{initials}</Stack.Toolbar.Label> : null}
      <Stack.Toolbar.MenuAction onPress={() => router.push('/perfil')}>Perfil</Stack.Toolbar.MenuAction>
      <Stack.Toolbar.MenuAction hidden={mode !== 'picker'} onPress={() => router.push('/configuracion')}>
        Configuración
      </Stack.Toolbar.MenuAction>
      <Stack.Toolbar.MenuAction hidden={mode !== 'picker' || !me.can_manage_billing} onPress={() => router.push('/membresia')}>
        Membresía
      </Stack.Toolbar.MenuAction>
      <Stack.Toolbar.MenuAction onPress={() => void signOut()}>Cerrar sesión</Stack.Toolbar.MenuAction>
    </Stack.Toolbar.Menu>
  );
  if (children) return children(menu);
  return <Stack.Toolbar placement="right">{menu}</Stack.Toolbar>;
}