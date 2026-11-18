import { render, screen } from '@testing-library/react-native';
import type { Me } from '../../../lib/api';
import { AccountMenuToolbar } from '../AccountMenuToolbar';

jest.mock('expo-router', () => {
  const { Text } = require('react-native');
  const Menu = ({ children }: { children: React.ReactNode }) => children;
  const MenuAction = ({ children, hidden }: { children: React.ReactNode; hidden?: boolean }) =>
    hidden ? null : <Text>{children}</Text>;
  const Label = ({ children }: { children: React.ReactNode }) => <Text>{children}</Text>;
  const Toolbar = ({ children }: { children: React.ReactNode }) => children;
  Toolbar.Menu = Menu;
  Toolbar.MenuAction = MenuAction;
  Toolbar.Label = Label;
  return {
    Stack: { Toolbar },
    useRouter: () => ({ push: jest.fn() }),
  };
});

jest.mock('../../access', () => ({
  useSignOut: () => jest.fn(),
}));

jest.mock('../../../lib/account-profile', () => ({
  readSupabaseAccountName: async () => 'Ana Demo',
}));

const me: Me = {
  id: '11111111-1111-4111-8111-111111111111',
  email: 'ana@example.test',
  role: 'member',
  access: 'active',
  companies: [],
  overdue_company_ids: [],
  can_manage_billing: true,
  billing_company_ids: [],
  manageable_overdue_company_ids: [],
};

describe('AccountMenuToolbar', () => {
  it('includes billing destinations on the company picker', async () => {
    await render(<AccountMenuToolbar me={me} mode="picker" />);
    expect(screen.getByText('Perfil')).toBeOnTheScreen();
    expect(screen.getByText('Configuración')).toBeOnTheScreen();
    expect(screen.getByText('Membresía')).toBeOnTheScreen();
    expect(screen.getByText('Cerrar sesión')).toBeOnTheScreen();
  });

  it('hides Membresía without billing access', async () => {
    await render(<AccountMenuToolbar me={{ ...me, can_manage_billing: false }} mode="picker" />);
    expect(screen.queryByText('Membresía')).not.toBeOnTheScreen();
  });
});