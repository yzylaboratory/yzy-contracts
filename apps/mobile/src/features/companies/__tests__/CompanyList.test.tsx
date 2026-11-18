import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen } from '@testing-library/react-native';
import { useState, type ReactNode } from 'react';
import { useRouter } from 'expo-router';
import type { Me } from '../../../lib/api';
import { useActiveCompanyStore } from '../../../lib/storage/active-company';
import { CompanyList } from '../ui/CompanyList';

jest.mock('expo-router', () => ({
  Stack: { Screen: () => null },
  useRouter: jest.fn(),
}));

jest.mock('../../access', () => ({
  useGate: jest.fn(),
}));

jest.mock('../../shell/PickerChrome', () => ({
  PickerChrome: () => null,
}));

const replace = jest.fn();
const dismissAll = jest.fn();
const push = jest.fn();

const meBase: Me = {
  id: '11111111-1111-4111-8111-111111111111',
  email: 'persona@example.test',
  role: 'member',
  access: 'active',
  companies: [
    { id: '22222222-2222-4222-8222-222222222222', name: 'Empresa Demo' },
    { id: '33333333-3333-4333-8333-333333333333', name: 'Empresa Bloqueada' },
  ],
  overdue_company_ids: ['33333333-3333-4333-8333-333333333333'],
  can_manage_billing: true,
  billing_company_ids: ['22222222-2222-4222-8222-222222222222'],
  manageable_overdue_company_ids: ['33333333-3333-4333-8333-333333333333'],
};

function Providers({ children }: { children: ReactNode }) {
  const [client] = useState(() => new QueryClient({ defaultOptions: { queries: { retry: false } } }));
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

describe('CompanyList', () => {
  beforeEach(() => {
    replace.mockReset();
    dismissAll.mockReset();
    push.mockReset();
    jest.mocked(useRouter).mockReturnValue({ replace, dismissAll, push } as unknown as ReturnType<typeof useRouter>);
    useActiveCompanyStore.setState({ accountId: meBase.id, companyId: null });
    const { useGate } = jest.requireMock('../../access') as { useGate: jest.Mock };
    useGate.mockReturnValue({ me: meBase });
  });

  it('lists Acceder actions and overdue billing copy', async () => {
    await render(<CompanyList />, { wrapper: Providers });
    expect(screen.getByText('Elige la empresa con la que quieres trabajar.')).toBeOnTheScreen();
    expect(screen.getByRole('button', { name: 'Acceder' })).toBeOnTheScreen();
    expect(screen.getByText('Bloqueada por falta de pago')).toBeOnTheScreen();
    expect(screen.getByText('Consultar mis facturas')).toBeOnTheScreen();
  });

  it('selects a company and lands on the dashboard tab', async () => {
    const select = jest.spyOn(useActiveCompanyStore.getState(), 'select');
    await render(<CompanyList />, { wrapper: Providers });
    await fireEvent.press(screen.getByRole('button', { name: 'Acceder' }));
    expect(select).toHaveBeenCalledWith(meBase.id, '22222222-2222-4222-8222-222222222222');
    expect(dismissAll).toHaveBeenCalled();
    expect(replace).toHaveBeenCalledWith('/(tabs)/(inicio)');
  });
});