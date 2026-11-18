import type { ReactNode } from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';
import { type Edge, SafeAreaView } from 'react-native-safe-area-context';
import { colors, space } from '../theme/tokens';

type Props = {
  children: ReactNode;
  // Stack screens with a native header skip the top inset; the header already handles it.
  withTopInset?: boolean;
  // Tab roots: the native tab bar already sits above the system navigation bar.
  inTabs?: boolean;
  scroll?: boolean;
  footer?: ReactNode;
};

export function Screen({ children, withTopInset = false, inTabs = false, scroll = true, footer }: Props) {
  const edges: Edge[] = ['left', 'right'];
  if (withTopInset) edges.push('top');
  if (!inTabs) edges.push('bottom');
  const body = scroll ? (
    <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
      {children}
    </ScrollView>
  ) : (
    <View style={[styles.content, styles.fill]}>{children}</View>
  );
  return (
    <SafeAreaView style={styles.root} edges={edges}>
      <View style={styles.fill}>{body}</View>
      {footer ? <View style={styles.footer}>{footer}</View> : null}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.background },
  fill: { flex: 1 },
  content: { padding: space.lg, gap: space.md, flexGrow: 1 },
  footer: {
    paddingHorizontal: space.lg,
    paddingTop: space.sm,
    paddingBottom: space.md,
    backgroundColor: colors.background,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.borderSubtle,
  },
});
