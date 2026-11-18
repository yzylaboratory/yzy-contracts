import { useQueryClient } from '@tanstack/react-query';
import { useSessionQuery, type MeFailureKind } from '../session';
import { AccessScreen } from './AccessScreen';
import { AppText } from '../../../shared/ui/AppText';
import { Button } from '../../../shared/ui/Button';
import { queryKeys } from '../../../lib/query/keys';

// Shown while the session boots or while /me is loading.
export function BootScreen() {
  const session = useSessionQuery();
  return <AccessScreen title="Comprobando tu acceso…" checking canSignOut={Boolean(session.data)} />;
}

// Shown when /me fails for a reason other than a restricted account.
export function BootFailure({ kind }: { kind: MeFailureKind | null }) {
  const queryClient = useQueryClient();
  const deleted = kind === 'deleted';

  return (
    <AccessScreen
      title="No se pudo comprobar el acceso"
      action={
        <Button
          label="Reintentar"
          variant="secondary"
          onPress={() => void queryClient.invalidateQueries({ queryKey: queryKeys.me })}
        />
      }
    >
      <AppText tone="secondary" accessibilityRole="alert">
        {deleted
          ? 'Esta cuenta ya no está activa.'
          : 'No pudimos comprobar tu acceso. Intenta de nuevo.'}
      </AppText>
    </AccessScreen>
  );
}