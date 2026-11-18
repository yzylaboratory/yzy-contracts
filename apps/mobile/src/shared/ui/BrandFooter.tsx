import { StyleSheet, Text } from 'react-native';
import { colors, fonts } from '../theme/tokens';

export function BrandFooter() {
  return (
    <Text style={styles.text}>
      YZY Contracts powered by <Text style={styles.strong}>YZY LABS SRL</Text>
    </Text>
  );
}

const styles = StyleSheet.create({
  text: { fontFamily: fonts.body, fontSize: 12, color: colors.textSecondary, textAlign: 'center' },
  strong: { fontFamily: fonts.bodySemibold, color: colors.ink },
});
