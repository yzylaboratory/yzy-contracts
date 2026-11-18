// Note: expo-clipboard is not installed in apps/mobile/package.json, so "Copiar" buttons
// are omitted per specification instructions.
import { StyleSheet, View } from 'react-native';
import { colors, radius, space } from '../../../shared/theme/tokens';
import { AppText } from '../../../shared/ui/AppText';
import type { BankAccount } from '../types';

type Props = {
  bankAccount: BankAccount;
  memo: string;
};

export function BankDetails({ bankAccount, memo }: Props) {
  return (
    <View style={styles.container}>
      <DetailRow label="Banco" value={bankAccount.bank_name} />
      <DetailRow label="Titular" value={bankAccount.account_holder} />
      <DetailRow label="Tipo de cuenta" value={bankAccount.account_type} />
      <DetailRow label="Número de cuenta" value={bankAccount.account_number} mono />
      <DetailRow label="Concepto de pago" value={memo} mono />
    </View>
  );
}

function DetailRow({ label, value, mono = false }: { label: string; value: string; mono?: boolean }) {
  return (
    <View style={styles.row}>
      <AppText variant="caption" tone="muted">
        {label}
      </AppText>
      <AppText variant="bodyStrong" style={[styles.value, mono && styles.mono]}>
        {value}
      </AppText>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    backgroundColor: colors.surfaceRaised,
    borderRadius: radius.small,
    borderWidth: 1,
    borderColor: colors.borderSubtle,
    padding: space.sm,
    gap: space.xs,
  },
  row: {
    paddingVertical: 2,
    gap: 2,
  },
  value: {
    color: colors.ink,
  },
  mono: {
    fontFamily: 'Inter_500Medium',
    letterSpacing: 0.3,
  },
});
