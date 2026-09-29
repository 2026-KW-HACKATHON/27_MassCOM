import { forwardRef, type ReactNode } from 'react';
import { ScrollView, StyleSheet, View, type ScrollViewProps } from 'react-native';

type Props = ScrollViewProps & {
  /** Drawn first inside the scroll content (AppHeader / BackHeader), so it scrolls away with everything below it. */
  header: ReactNode;
  /** Reports the header's height, for screens that scroll to a section measured inside the content. */
  onHeaderLayout?: (height: number) => void;
};

/** A scroll view whose header, sky art included, is part of the content; `contentContainerStyle` styles what sits below it. */
export const SkyScrollView = forwardRef<ScrollView, Props>(function SkyScrollView(
  { header, onHeaderLayout, contentContainerStyle, children, ...rest },
  ref,
) {
  return (
    <ScrollView ref={ref} {...rest} contentContainerStyle={styles.container}>
      <View onLayout={onHeaderLayout ? (event) => onHeaderLayout(event.nativeEvent.layout.height) : undefined}>{header}</View>
      {/* Grows to fill what the header leaves, so content that centres itself (a sign-in prompt) still centres. */}
      <View style={[styles.grow, contentContainerStyle]}>{children}</View>
    </ScrollView>
  );
});

const styles = StyleSheet.create({
  container: { flexGrow: 1 },
  grow: { flexGrow: 1 },
});
