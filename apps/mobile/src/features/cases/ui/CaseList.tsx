import { useEffect, useState } from 'react';
import { FlatList, ScrollView, StyleSheet, View } from 'react-native';
import { useRouter } from 'expo-router';
import type { CaseStatus } from '../../../lib/api';
import { messageFor } from '../../../shared/errors/messages';
import { AppText } from '../../../shared/ui/AppText';
import { Button } from '../../../shared/ui/Button';
import { Chip } from '../../../shared/ui/Chip';
import { SearchField } from '../../../shared/ui/SearchField';
import { Skeleton } from '../../../shared/ui/Skeleton';
import { EmptyState, ErrorState } from '../../../shared/ui/StateViews';
import { colors, space } from '../../../shared/theme/tokens';
import { useGate } from '../../access';
import { CompanyOverdueCopy, isCompanyOverdue } from '../../companies';
import { useCaseList } from '../hooks/useCases';
import { CaseRow } from './CaseRow';
import { STATUS_FILTERS, statusFilterLabel } from '../status';

// Expedientes tab body: debounced search, status chips, infinite scroll.
export function CaseList({ companyId }: { companyId: string }) {
  const router = useRouter();
  const [search, setSearch] = useState('');
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState<CaseStatus | 'todos'>('todos');

  useEffect(() => {
    const timer = setTimeout(() => setQuery(search.trim()), 300);
    return () => clearTimeout(timer);
  }, [search]);

  const { me } = useGate();
  const blocked = isCompanyOverdue(me, companyId);
  const status = filter === 'todos' ? undefined : filter;
  const list = useCaseList(companyId, query, status);
  const items = list.data?.pages.flatMap((page) => page.items) ?? [];
  const total = list.data?.pages[0]?.total ?? 0;
  const filtered = query !== '' || status !== undefined;

  const header = (
    <View style={styles.header}>
      <SearchField
        label="Buscar expedientes"
        value={search}
        placeholder="Referencia, cliente o vehículo"
        onChangeText={setSearch}
      />
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        style={styles.chipsScroll}
        contentContainerStyle={styles.chips}
      >
        {STATUS_FILTERS.map((value) => (
          <Chip
            key={value}
            label={statusFilterLabel(value)}
            selected={filter === value}
            onPress={() => setFilter(value)}
          />
        ))}
      </ScrollView>
      {!list.isPending && !list.isError && items.length > 0 ? (
        <AppText variant="caption" tone="secondary" accessibilityLiveRegion="polite">
          {total === 1 ? '1 expediente' : `${total} expedientes`}
        </AppText>
      ) : null}
    </View>
  );

  if (list.isPending) {
    return (
      <View style={styles.wrap}>
        {header}
        <Skeleton height={96} />
        <Skeleton height={96} />
        <Skeleton height={96} />
      </View>
    );
  }

  if (list.isError) {
    return (
      <View style={styles.wrap}>
        {header}
        <ErrorState
          title="No pudimos cargar los expedientes"
          body={messageFor(list.error)}
          onRetry={() => void list.refetch()}
        />
      </View>
    );
  }

  return (
    <FlatList
      data={items}
      keyExtractor={(item) => item.id}
      style={styles.list}
      renderItem={({ item }) => <CaseRow item={item} />}
      ItemSeparatorComponent={() => <View style={styles.separator} />}
      ListHeaderComponent={header}
      contentContainerStyle={styles.content}
      keyboardShouldPersistTaps="handled"
      onEndReached={() => {
        if (list.hasNextPage && !list.isFetchingNextPage) void list.fetchNextPage();
      }}
      onEndReachedThreshold={0.4}
      ListEmptyComponent={
        <EmptyState
          title={filtered ? 'Sin resultados' : 'Aún no hay expedientes'}
          body={
            filtered
              ? 'Prueba con otra búsqueda o cambia el estado.'
              : 'Crea el primero para empezar a generar documentos.'
          }
          action={
            filtered ? undefined : blocked ? (
              <CompanyOverdueCopy companyId={companyId} />
            ) : (
              <Button label="Nuevo expediente" onPress={() => router.push('/nuevo-expediente')} />
            )
          }
        />
      }
      ListFooterComponent={
        list.isFetchingNextPage ? (
          <View style={styles.footer}>
            <Skeleton height={72} />
          </View>
        ) : undefined
      }
    />
  );
}

const styles = StyleSheet.create({
  wrap: { flex: 1, padding: space.lg, gap: space.md, backgroundColor: colors.background },
  list: { backgroundColor: colors.background },
  content: { padding: space.lg, flexGrow: 1 },
  header: { gap: space.md, paddingBottom: space.md },
  chipsScroll: { marginHorizontal: -space.lg },
  chips: { gap: space.xs, paddingVertical: 2, paddingHorizontal: space.lg },
  separator: { height: space.md },
  footer: { paddingTop: space.md },
});
