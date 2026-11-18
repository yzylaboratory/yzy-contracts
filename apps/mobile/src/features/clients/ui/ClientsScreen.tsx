import { useEffect, useState } from 'react';
import { FlatList, StyleSheet, View } from 'react-native';
import { messageFor } from '../../../shared/errors/messages';
import { AppText } from '../../../shared/ui/AppText';
import { Card } from '../../../shared/ui/Card';
import { Screen } from '../../../shared/ui/Screen';
import { SearchField } from '../../../shared/ui/SearchField';
import { Skeleton } from '../../../shared/ui/Skeleton';
import { EmptyState, ErrorState } from '../../../shared/ui/StateViews';
import { colors, space } from '../../../shared/theme/tokens';
import { useClientDirectory } from '../hooks/useClientDirectory';

function formatIdentity(value: string | null): string {
  if (!value) return '';
  const digits = value.replace(/\D/g, '');
  if (digits.length === 11) {
    return `${digits.slice(0, 3)}-${digits.slice(3, 10)}-${digits.slice(10)}`;
  }
  return value;
}

export function ClientsScreen() {
  const [search, setSearch] = useState('');
  const [query, setQuery] = useState('');

  useEffect(() => {
    const timer = setTimeout(() => setQuery(search.trim()), 300);
    return () => clearTimeout(timer);
  }, [search]);

  const clients = useClientDirectory(query);
  const items = clients.data?.pages.flatMap((page) => page.items) ?? [];

  const header = (
    <View style={styles.header}>
      <AppText variant="subheading">Listado de clientes</AppText>
      <SearchField label="Buscar clientes" placeholder="Nombre o cédula…" value={search} onChangeText={setSearch} />
    </View>
  );

  return (
    <Screen inTabs scroll={false}>
      <FlatList
        data={clients.isPending || clients.isError ? [] : items}
        keyExtractor={(item) => item.id}
        style={styles.list}
        renderItem={({ item }) => (
          <Card>
            <View style={styles.row}>
              <View style={styles.text}>
                <AppText variant="bodyStrong">{item.name}</AppText>
                {item.identity ? (
                  <AppText variant="caption" tone="secondary">
                    {formatIdentity(item.identity)}
                  </AppText>
                ) : null}
                {item.phone ? (
                  <AppText variant="caption" tone="secondary">
                    {item.phone}
                  </AppText>
                ) : null}
              </View>
            </View>
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
            <Skeleton height={180} />
          ) : clients.isError ? (
            <ErrorState
              title="No pudimos cargar los clientes"
              body={messageFor(clients.error)}
              onRetry={() => void clients.refetch()}
            />
          ) : (
            <EmptyState
              title={query ? 'Sin resultados' : 'Aún no hay clientes'}
              body={query ? 'No hay clientes que coincidan con la búsqueda.' : 'Aún no hay clientes registrados.'}
            />
          )
        }
        ListFooterComponent={
          clients.isFetchingNextPage ? (
            <View style={styles.footer}>
              <Skeleton height={72} />
            </View>
          ) : undefined
        }
      />
    </Screen>
  );
}

const styles = StyleSheet.create({
  list: { flex: 1, backgroundColor: colors.background },
  content: { flexGrow: 1, gap: space.md },
  header: { gap: space.md, paddingBottom: space.sm },
  row: { flexDirection: 'row', alignItems: 'center' },
  text: { flex: 1, gap: 2 },
  separator: { height: space.md },
  footer: { paddingTop: space.md },
});
