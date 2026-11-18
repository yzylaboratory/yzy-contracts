import { QueryClientProvider } from '@tanstack/react-query';
import { Inter_400Regular, Inter_500Medium, Inter_600SemiBold } from '@expo-google-fonts/inter';
import { Geist_600SemiBold, Geist_700Bold } from '@expo-google-fonts/geist';
import { useFonts } from 'expo-font';
import { type Href, Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import * as SplashScreen from 'expo-splash-screen';
import { useEffect, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { createQueryClient } from '../src/lib/query/query-client';
import {
  BootFailure,
  BootScreen,
  RouteGuard,
  screenAccess,
  type SettledGate,
  useAuthLifecycle,
  useGate,
  useUnauthorizedHandler,
} from '../src/features/access';
import { colors } from '../src/shared/theme/tokens';

SplashScreen.preventAutoHideAsync().catch(() => undefined);
const queryClient = createQueryClient();

export default function RootLayout() {
  const [loaded, fontError] = useFonts({
    Inter_400Regular,
    Inter_500Medium,
    Inter_600SemiBold,
    Geist_600SemiBold,
    Geist_700Bold,
  });

  useEffect(() => {
    if (loaded || fontError) void SplashScreen.hideAsync();
  }, [loaded, fontError]);

  if (!loaded && !fontError) return null;

  return (
    <SafeAreaProvider>
      <QueryClientProvider client={queryClient}>
        <AccessLayer />
        <StatusBar style="dark" />
      </QueryClientProvider>
    </SafeAreaProvider>
  );
}

// Keeps the navigator mounted and overlays the boot and failure states on top of it.
function AccessLayer() {
  useUnauthorizedHandler();
  useAuthLifecycle();
  const { gate, me, meFailure } = useGate();
  // Loading and failed are overlays on top of the last settled state, so they never reshape the navigator.
  const [settled, setSettled] = useState<SettledGate>();
  if (gate !== 'loading' && gate !== 'failed' && gate !== settled) setSettled(gate);
  const access = screenAccess(settled, me?.can_manage_billing === true);
  const home = access.home as Href;
  return (
    <View style={styles.root}>
      <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: colors.background } }}>
        <Stack.Protected guard={access.auth} redirectTo={home}>
          <Stack.Screen name="(auth)" />
          <Stack.Screen name="auth/callback" />
        </Stack.Protected>
        <Stack.Protected guard={access.unsupported} redirectTo={home}>
          <Stack.Screen name="unsupported-account" />
        </Stack.Protected>
        <Stack.Protected guard={access.pending} redirectTo={home}>
          <Stack.Screen name="access-pending" />
        </Stack.Protected>
        {/* The app is declared before companies: when both are allowed, the app is the first screen. */}
        <Stack.Protected guard={access.settings} redirectTo={home}>
          <Stack.Screen name="perfil" />
          <Stack.Screen name="configuracion" />
          <Stack.Screen name="terminos-y-condiciones" />
          <Stack.Screen name="politica-de-privacidad" />
        </Stack.Protected>
        <Stack.Protected guard={access.billing} redirectTo={home}>
          <Stack.Screen name="membresia" />
        </Stack.Protected>
        <Stack.Protected guard={access.app} redirectTo={home}>
          <Stack.Screen name="(tabs)" />
          <Stack.Screen name="expedientes/[id]/index" />
          <Stack.Screen name="expedientes/[id]/generar" />
          <Stack.Screen name="expedientes/[id]/listos" />
          <Stack.Screen name="nuevo-expediente" />
          <Stack.Screen name="vista-previa" />
        </Stack.Protected>
        <Stack.Protected guard={access.companies} redirectTo={home}>
          <Stack.Screen name="companies" />
        </Stack.Protected>
      </Stack>
      <RouteGuard />
      {gate === 'loading' ? (
        <View style={StyleSheet.absoluteFill}>
          <BootScreen />
        </View>
      ) : null}
      {gate === 'failed' ? (
        <View style={[StyleSheet.absoluteFill, { backgroundColor: colors.background }]}>
          <BootFailure kind={meFailure} />
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.background },
});
