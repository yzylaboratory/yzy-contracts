import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import { FlatList, Pressable, StyleSheet, View } from 'react-native';
import { api, type Client, type ClientWrite } from '../../../lib/api';
import { messageFor } from '../../../shared/errors/messages';
import { AppText } from '../../../shared/ui/AppText';
import { Button } from '../../../shared/ui/Button';
import { Card } from '../../../shared/ui/Card';
import { Notice } from '../../../shared/ui/Notice';
import { Screen } from '../../../shared/ui/Screen';
import { SearchField } from '../../../shared/ui/SearchField';
import { Skeleton } from '../../../shared/ui/Skeleton';
import { TextField } from '../../../shared/ui/TextField';
import { EmptyState, ErrorState } from '../../../shared/ui/StateViews';
import { colors, space } from '../../../shared/theme/tokens';
import { useGate } from '../../access';
import { useClientDirectory } from '../../clients';
import { CompanyOverdueCopy, isCompanyOverdue, useActiveCompany } from '../../companies';
import { useCaseDraft } from '../draft-store';
import { clientFormSchema, normalizeIdentity } from '../schemas';
import { StepHeader } from './StepHeader';

// Paso 1 de 4: cliente. Search, pick, or create quickly (plan section 8, item 5).
export function ClientStep() {
  const router = useRouter();
  const setClient = useCaseDraft((state) => state.setClient);
  const active = useActiveCompany();
  const { me } = useGate();
  const blocked = active !== null && isCompanyOverdue(me, active.companyId);
  const [search, setSearch] = useState('');
  const [query, setQuery] = useState('');
  const [creating, setCreating] = useState(false);

  useEffect(() => {
    const timer = setTimeout(() => setQuery(search.trim()), 300);
    return () => clearTimeout(timer);
  }, [search]);

  const clients = useClientDirectory(query, !blocked);
  const items = clients.data?.pages.flatMap((page) => page.items) ?? [];

  const choose = (client: Client) => {
    setClient(client);
    router.push('/nuevo-expediente/solicitud');
  };

  if (blocked && active) {
    return (
      <Screen>
        <StepHeader step={1} title="Cliente" />
        <CompanyOverdueCopy companyId={active.companyId} />
      </Screen>
    );
  }

  const header = (
    <View style={styles.header}>
      <StepHeader step={1} title="Cliente" />
      <SearchField label="Buscar clientes" value={search} placeholder="Nombre o cédula" onChangeText={setSearch} />
    </View>
  );

  return (
    <Screen scroll={false}>
      <FlatList
        data={clients.isPending || clients.isError ? [] : items}
        keyExtractor={(item) => item.id}
        style={styles.list}
        renderItem={({ item }) => (
          <Card style={styles.row}>
            <View style={styles.text}>
              <AppText variant="bodyStrong">{item.name}</AppText>
              <AppText variant="caption" tone="secondary">
                {item.identity ?? 'Sin cédula'}
              </AppText>
            </View>
            <Button
              label="Usar este cliente"
              accessibilityLabel={`Usar a ${item.name}`}
              variant="secondary"
              onPress={() => choose(item)}
            />
          </Card>
        )}
        ItemSeparatorComponent={() => <View style={styles.separator} />}
        ListHeaderComponent={header}
        contentContainerStyle={styles.content}
        keyboardShouldPersistTaps="handled"
        onEndReached={() => {
          if (clients.hasNextPage && !clients.isFetchingNextPage) void clients.fetchNextPage();
        }}
        onEndReachedThreshold={0.4}
        ListEmptyComponent={
          clients.isPending ? (
            <Skeleton height={72} />
          ) : clients.isError ? (
            <ErrorState
              title="No pudimos buscar clientes"
              body={messageFor(clients.error)}
              onRetry={() => void clients.refetch()}
            />
          ) : (
            <EmptyState title="Sin clientes" body="Crea un cliente nuevo para continuar." />
          )
        }
        ListFooterComponent={
          <View style={styles.footer}>
            {clients.isFetchingNextPage ? <Skeleton height={72} /> : null}
            {creating ? (
              <NewClientForm onCreated={choose} onCancel={() => setCreating(false)} />
            ) : (
              <Pressable accessibilityRole="button" onPress={() => setCreating(true)} style={styles.newButton}>
                <AppText variant="bodyStrong" tone="accent">
                  + Nuevo cliente
                </AppText>
              </Pressable>
            )}
          </View>
        }
      />
    </Screen>
  );
}

function NewClientForm({ onCreated, onCancel }: { onCreated: (client: Client) => void; onCancel: () => void }) {
  const queryClient = useQueryClient();
  const [name, setName] = useState('');
  const [identity, setIdentity] = useState('');
  const [phone, setPhone] = useState('');
  const [errors, setErrors] = useState<Partial<Record<'name' | 'identity' | 'phone', string>>>({});

  const create = useMutation({
    mutationFn: (values: { name: string; identity: string; phone: string }) => {
      const body: ClientWrite = {
        name: values.name,
        identity: values.identity === '' ? null : values.identity,
        phone: values.phone === '' ? null : values.phone,
        address: null,
        email: null,
        income_source: null,
        profile: null,
      };
      return api.clients.create(body);
    },
    onSuccess: async (client) => {
      await queryClient.invalidateQueries({ queryKey: ['clients'] });
      onCreated(client);
    },
  });

  const submit = () => {
    const parsed = clientFormSchema.safeParse({ name, identity, phone });
    if (!parsed.success) {
      const next: typeof errors = {};
      for (const issue of parsed.error.issues) {
        const key = issue.path[0];
        if (key === 'name' || key === 'identity' || key === 'phone') next[key] = issue.message;
      }
      setErrors(next);
      return;
    }
    setErrors({});
    create.mutate({ ...parsed.data, identity: normalizeIdentity(parsed.data.identity) });
  };

  return (
    <Card style={styles.form}>
      <AppText variant="subheading">Nuevo cliente</AppText>
      <TextField label="Nombre completo" value={name} onChangeText={setName} error={errors.name} autoCapitalize="words" />
      <TextField
        label="Cédula"
        value={identity}
        onChangeText={setIdentity}
        error={errors.identity}
        placeholder="001-0000000-1"
        keyboardType="numbers-and-punctuation"
        hint="Opcional. Si la escribes, debe ser única."
      />
      <TextField label="Teléfono" value={phone} onChangeText={setPhone} error={errors.phone} keyboardType="phone-pad" autoComplete="tel" />
      {create.isError ? <Notice tone="danger" message={messageFor(create.error)} /> : null}
      <Button label="Guardar y usar cliente" loading={create.isPending} onPress={submit} />
      <Button label="Cancelar" variant="ghost" onPress={onCancel} />
    </Card>
  );
}

const styles = StyleSheet.create({
  list: { flex: 1 },
  content: { gap: space.md, flexGrow: 1 },
  header: { gap: space.md, paddingBottom: space.sm },
  row: { gap: space.sm, padding: 14 },
  text: { gap: 2 },
  separator: { height: space.md },
  footer: { gap: space.md, paddingTop: space.md },
  newButton: { minHeight: 48, justifyContent: 'center', paddingHorizontal: 4 },
  form: { gap: space.md, borderColor: colors.borderStrong },
});
