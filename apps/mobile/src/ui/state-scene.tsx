import { Text, View } from 'react-native';

import type { MascotPose } from './mascot-art';
import { BounceButton } from './bounce-button';
import { FloatingCard } from './floating-card';
import { Mascot } from './mascot';
import { useUiStyles } from './use-ui-styles';

const poseByKind: Record<'empty' | 'error' | 'loading', MascotPose> = { empty: 'sleep', error: 'puzzled', loading: 'search' };

type Props = {
  kind: 'empty' | 'error' | 'loading';
  title: string;
  body?: string;
  action?: { label: string; onPress: () => void; disabled?: boolean };
  /** Draw the card surface the text is tested against. Only a caller that already sits the scene inside its own card turns this off. */
  framed?: boolean;
};

export function StateScene({ kind, title, body, action, framed = true }: Props) {
  const styles = useUiStyles();
  const content = (
    <View style={styles.sceneContent} accessibilityLiveRegion={kind === 'empty' ? 'none' : 'polite'}>
      <Mascot pose={poseByKind[kind]} size={132} />
      <Text style={styles.sceneTitle}>{title}</Text>
      {body ? <Text style={styles.sceneBody}>{body}</Text> : null}
      {action ? <BounceButton label={action.label} onPress={action.onPress} disabled={action.disabled} variant="secondary" /> : null}
    </View>
  );
  return framed ? <FloatingCard>{content}</FloatingCard> : content;
}
