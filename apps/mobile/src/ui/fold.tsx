import { useState, type ReactNode } from 'react';
import { Text, View, type LayoutChangeEvent } from 'react-native';

import { foldAccessibilityHint, foldAccessibilityLabel, foldToggleText } from './fold-text';
import { FloatingCard } from './floating-card';
import { useUiStyles } from './use-ui-styles';

type Props = {
  title: string;
  /** Shown under the title whether collapsed or expanded, e.g. "배지 4/9". */
  summary?: string;
  defaultExpanded?: boolean;
  /**
   * Controlled mode (#296 review): pass both `expanded` and `onToggle` when a caller must force this fold open
   * itself (e.g. a `focus=` deep link into a section that lives inside it). Omit both to keep the fold's own
   * internal toggle, which is the default for every other fold.
   */
  expanded?: boolean;
  onToggle?: () => void;
  /**
   * Reports this fold's own root position (#296 review), not the position of anything inside its collapsible
   * body. Collapsing only unmounts the body below; it never moves the fold's own top edge, so this fires and
   * stays valid whether the fold is expanded or not — unlike measuring something inside the body, whose `y` is
   * relative to the body and excludes this card's own header height.
   */
  onLayout?: (y: number) => void;
  children: ReactNode;
};

/**
 * Accessible disclosure (#296): a FloatingCard header toggles its content. The expanded/collapsed state is spoken
 * in the accessibility label (TalkBack) and announced to assistive tech via accessibilityState, and shown as both
 * a glyph and a text flip (더보기 ▼ / 접기 ▲), never by color alone.
 */
export function Fold({ title, summary, defaultExpanded = false, expanded: expandedProp, onToggle, onLayout, children }: Props) {
  const [internalExpanded, setInternalExpanded] = useState(defaultExpanded);
  const expanded = expandedProp ?? internalExpanded;
  const toggle = onToggle ?? (() => setInternalExpanded((value) => !value));
  const styles = useUiStyles();
  return (
    <View onLayout={onLayout ? (event: LayoutChangeEvent) => onLayout(event.nativeEvent.layout.y) : undefined}>
      <FloatingCard
        onPress={toggle}
        accessibilityLabel={foldAccessibilityLabel(title, summary, expanded)}
        accessibilityHint={foldAccessibilityHint(expanded)}
        accessibilityState={{ expanded }}
      >
        <View style={styles.foldRow}>
          <View style={styles.foldTitleGroup}>
            <Text style={styles.cardTitle}>{title}</Text>
            {summary ? <Text style={styles.foldSummary}>{summary}</Text> : null}
          </View>
          <Text accessibilityElementsHidden style={styles.foldToggle}>{foldToggleText(expanded)}</Text>
        </View>
      </FloatingCard>
      {expanded ? <View style={styles.foldBody}>{children}</View> : null}
    </View>
  );
}
