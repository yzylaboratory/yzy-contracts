import { create } from 'zustand';
import { supabase } from './supabase';

function readName(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

interface ProfileState {
  names: Record<string, string>;
  setName: (accountId: string, value: string) => void;
  clearAccount: (accountId: string) => void;
  reset: () => void;
}

export const useProfileStore = create<ProfileState>((set) => ({
  names: {},
  setName: (accountId, value) =>
    set((state) => {
      const next = { ...state.names };
      if (value) next[accountId] = value;
      else delete next[accountId];
      return { names: next };
    }),
  clearAccount: (accountId) =>
    set((state) => {
      if (!(accountId in state.names)) return state;
      const next = { ...state.names };
      delete next[accountId];
      return { names: next };
    }),
  reset: () => set({ names: {} }),
}));

export function accountNameFromMetadata(metadata: Record<string, unknown> | undefined): string {
  return readName(metadata?.full_name) || readName(metadata?.name);
}

export async function readSupabaseAccountName(accountId: string, email: string | null): Promise<string> {
  const { data } = await supabase.auth.getSession();
  const user = data.session?.user;
  if (!user || user.id !== accountId) return email ?? '';
  const metadata = user.user_metadata as Record<string, unknown> | undefined;
  const google = user.identities?.find((identity) => identity.provider === 'google')?.identity_data as
    | Record<string, unknown>
    | undefined;
  return (
    readName(useProfileStore.getState().names[accountId]) ||
    accountNameFromMetadata(metadata) ||
    readName(google?.full_name) ||
    readName(google?.name) ||
    email ||
    ''
  );
}

export function displayNameFor(accountId: string, email: string | null, metadata?: Record<string, unknown>): string {
  const saved = readName(useProfileStore.getState().names[accountId]);
  if (saved) return saved;
  const fromMeta = accountNameFromMetadata(metadata);
  if (fromMeta) return fromMeta;
  return email ?? '';
}