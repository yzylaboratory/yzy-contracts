import { useEffect } from 'react';
import { useRootNavigationState, useRouter, useSegments } from 'expo-router';
import { redirectFor } from '../gate';
import { useGate } from '../session';

// Keeps the route tree in line with the access gate. Renders nothing itself.
export function RouteGuard() {
  const { gate, me } = useGate();
  const segments = useSegments();
  const router = useRouter();
  const navigationReady = useRootNavigationState()?.key !== undefined;
  const canManageBilling = me?.can_manage_billing === true;

  useEffect(() => {
    if (!navigationReady) return;
    const target = redirectFor(gate, segments[0], canManageBilling);
    if (target) router.replace(target as never);
  }, [canManageBilling, gate, navigationReady, router, segments]);

  return null;
}
