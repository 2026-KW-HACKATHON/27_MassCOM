import { useState, type ReactNode } from 'react';
import { Text, View } from 'react-native';

import { foldAccessibilityHint, foldAccessibilityLabel, foldToggleText } from './fold-text';
import { FloatingCard } from './floating-card';
import { useUiStyles } from './use-ui-styles';

type Props = {
  title: string;
  /** Shown under the title whether collapsed or expanded, e.g. "배지 4/9". */
  summary?: string;
  defaultExpanded?: boolean;
  children: ReactNode;
};

/**
 * Accessible disclosure (#296): a FloatingCard header toggles its content. The expanded/collapsed state is spoken
 * in the accessibility label (TalkBack) and shown as both a glyph and a text flip (더보기 ▼ / 접기 ▲), never by
 * color alone.
 */
export function Fold({ title, summary, defaultExpanded = false, children }: Props) {
  const [expanded, setExpanded] = useState(defaultExpanded);
  const styles = useUiStyles();
  return (
    <View>
      <FloatingCard
        onPress={() => setExpanded((value) => !value)}
        accessibilityLabel={foldAccessibilityLabel(title, summary, expanded)}
        accessibilityHint={foldAccessibilityHint(expanded)}
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
