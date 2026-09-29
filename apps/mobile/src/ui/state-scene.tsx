import { Text, View } from 'react-native';

import type { MascotPose } from './mascot-art';
import { Mascot } from './mascot';
import { BounceButton } from './bounce-button';
import { useUiStyles } from './use-ui-styles';

const poseByKind: Record<'empty' | 'error' | 'loading', MascotPose> = { empty: 'sleep', error: 'puzzled', loading: 'search' };

type Props = { kind: 'empty' | 'error' | 'loading'; title: string; body?: string; action?: { label: string; onPress: () => void; disabled?: boolean } };

export function StateScene({ kind, title, body, action }: Props) {
  const styles = useUiStyles();
  return (
    <View style={{ alignItems: 'center', gap: 10, paddingVertical: 24 }} accessibilityLiveRegion={kind === 'loading' ? 'polite' : 'none'}>
      <Mascot pose={poseByKind[kind]} size={132} />
      <Text style={styles.sceneTitle}>{title}</Text>
      {body ? <Text style={styles.sceneBody}>{body}</Text> : null}
      {action ? <BounceButton label={action.label} onPress={action.onPress} disabled={action.disabled} variant="secondary" /> : null}
    </View>
  );
}
