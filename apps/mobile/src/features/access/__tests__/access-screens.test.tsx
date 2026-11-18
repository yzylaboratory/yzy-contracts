import { render, screen } from '@testing-library/react-native';
import { AppText } from '../../../shared/ui/AppText';
import { AccessScreen } from '../ui/AccessScreen';

jest.mock('../session', () => ({
  useSignOut: () => jest.fn(),
}));

describe('AccessScreen states', () => {
  it('renders restricted access with only sign out', async () => {
    await render(
      <AccessScreen title="Acceso restringido">
        <AppText tone="secondary" accessibilityRole="alert">
          Esta cuenta no puede entrar a YZY Contracts. Inicia sesión con tu cuenta habilitada.
        </AppText>
      </AccessScreen>,
    );
    expect(screen.getByText('Acceso restringido')).toBeOnTheScreen();
    expect(
      screen.getByText('Esta cuenta no puede entrar a YZY Contracts. Inicia sesión con tu cuenta habilitada.'),
    ).toBeOnTheScreen();
    expect(screen.getByRole('button', { name: 'Cerrar sesión' })).toBeOnTheScreen();
    expect(screen.queryByRole('button', { name: 'Reintentar' })).not.toBeOnTheScreen();
    expect(screen.queryByRole('button', { name: 'Comprobar de nuevo' })).not.toBeOnTheScreen();
  });

  it('shows the checking copy while the gate loads', async () => {
    await render(<AccessScreen title="Comprobando tu acceso…" checking canSignOut />);
    expect(screen.getByText('Comprobando tu acceso…')).toBeOnTheScreen();
    expect(screen.getByText('Estamos verificando los permisos de tu cuenta.')).toBeOnTheScreen();
  });
});