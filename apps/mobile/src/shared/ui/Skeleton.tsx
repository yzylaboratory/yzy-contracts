import { useEffect, useRef } from 'react';
import { AccessibilityInfo, Animated, Easing, StyleSheet, View } from 'react-native';
import { colors, radius } from '../theme/tokens';

// Loading placeholder. Pulses gently, and stays static when reduce motion is on.
export function Skeleton({ height = 72 }: { height?: number }) {
  const opacity = useRef(new Animated.Value(0.5)).current;

  useEffect(() => {
    let loop: Animated.CompositeAnimation | null = null;
    let active = true;
    AccessibilityInfo.isReduceMotionEnabled().then((reduce) => {
      if (!active || reduce) return;
      loop = Animated.loop(
        Animated.sequence([
          Animated.timing(opacity, { toValue: 1, duration: 800, easing: Easing.out(Easing.cubic), useNativeDriver: true }),
          Animated.timing(opacity, { toValue: 0.5, duration: 800, easing: Easing.out(Easing.cubic), useNativeDriver: true }),
        ]),
      );
      loop.start();
    });
    return () => {
      active = false;
      loop?.stop();
    };
  }, [opacity]);

  return (
    <Animated.View style={[styles.block, { height, opacity }]}>
      <View />
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  block: { borderRadius: radius.card, backgroundColor: colors.surfaceMuted, width: '100%' },
});
