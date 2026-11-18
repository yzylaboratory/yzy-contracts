import { Pressable, StyleSheet, View } from 'react-native';
import { AppText } from './AppText';
import { colors, radius, touch } from '../theme/tokens';

type Option<T extends string> = { value: T; label: string };
type Props<T extends string> = { options: readonly Option<T>[]; value: T; onChange: (value: T) => void; accessibilityLabel: string };

export function SegmentedControl<T extends string>({ options, value, onChange, accessibilityLabel }: Props<T>) {
  return (
    <View accessibilityRole="tablist" accessibilityLabel={accessibilityLabel} style={styles.track}>
      {options.map((option) => {
        const selected = option.value === value;
        return (
          <Pressable
            key={option.value}
            accessibilityRole="tab"
            accessibilityLabel={option.label}
            accessibilityState={{ selected }}
            onPress={() => onChange(option.value)}
            style={[styles.segment, selected && styles.selected]}
          >
            <AppText variant="label" tone={selected ? 'inverse' : 'secondary'}>
              {option.label}
            </AppText>
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  track: {
    flexDirection: 'row',
    borderRadius: radius.control,
    backgroundColor: colors.surfaceMuted,
    padding: 4,
    gap: 4,
  },
  segment: {
    flex: 1,
    minHeight: touch.minTarget,
    borderRadius: radius.small,
    alignItems: 'center',
    justifyContent: 'center',
  },
  selected: { backgroundColor: colors.ink },
});
