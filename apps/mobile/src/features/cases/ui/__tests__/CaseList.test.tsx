import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen } from '@testing-library/react-native';
import { useState, type ReactNode } from 'react';
import { useRouter } from 'expo-router';
import { api, type CaseListItem, type CasePage } from '../../../../lib/api';
import { CaseList } from '../CaseList';

jest.mock('expo-router', () => ({
  useRouter: jest.fn(),
}));

jest.mock('../../../access', () => ({
  useGate: () => ({ me: undefined }),
}));

jest.mock('../../../../lib/api', () => ({
  api: {
    cases: {
      list: jest.fn(),
    },
  },
}));

const push = jest.fn();
const COMPANY_ID = '22222222-2222-4222-8222-222222222222';

function Providers({ children }: { children: ReactNode }) {
  const [client] = useState(
    () => new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity } } }),
  );
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

const emptyPage: CasePage = { items: [], total: 0, page: 1, per_page: 20 };

const listedCase: CaseListItem = {
  id: 'case-1',
  client_id: 'client-1',
  client_name: 'María Pérez',
  client_identity: null,
  company_id: COMPANY_ID,
  company_name: 'Empresa',
  reference: 'IAC-0003',
  contract_date: null,
  status: 'solicitud',
  vehicle: {
    kind: null,
    brand: 'Toyota',
    model: 'Corolla',
    year: '2020',
    color: null,
    registration: null,
    plate: null,
    chassis: null,
    engine: null,
  },
  created_at: '2026-11-16T12:00:00Z',
};

beforeEach(() => {
  push.mockReset();
  jest.mocked(api.cases.list).mockReset();
  jest.mocked(useRouter).mockReturnValue({ push } as unknown as ReturnType<typeof useRouter>);
});

describe('CaseList', () => {
  it('shows the empty expediente state', async () => {
    jest.mocked(api.cases.list).mockResolvedValue(emptyPage);

    await render(<CaseList companyId={COMPANY_ID} />, { wrapper: Providers });

    expect(await screen.findByText('Aún no hay expedientes')).toBeOnTheScreen();
    expect(screen.getByText('Crea el primero para empezar a generar documentos.')).toBeOnTheScreen();
    expect(screen.queryByText('IAC-0003')).not.toBeOnTheScreen();
    expect(api.cases.list).toHaveBeenCalledWith({
      companyId: COMPANY_ID,
      q: undefined,
      status: undefined,
      page: 1,
      perPage: 20,
    });
  });

  it('opens Nuevo expediente from the empty list', async () => {
    jest.mocked(api.cases.list).mockResolvedValue(emptyPage);

    await render(<CaseList companyId={COMPANY_ID} />, { wrapper: Providers });

    await fireEvent.press(await screen.findByRole('button', { name: 'Nuevo expediente' }));

    expect(push).toHaveBeenCalledWith('/nuevo-expediente');
  });

  it('renders a list row from CaseListItem fields', async () => {
    jest.mocked(api.cases.list).mockResolvedValue({ ...emptyPage, items: [listedCase], total: 1 });

    await render(<CaseList companyId={COMPANY_ID} />, { wrapper: Providers });

    expect(await screen.findByText('IAC-0003')).toBeOnTheScreen();
    expect(screen.getByText('María Pérez')).toBeOnTheScreen();
    expect(screen.getByText('1 expediente')).toBeOnTheScreen();
  });
});
