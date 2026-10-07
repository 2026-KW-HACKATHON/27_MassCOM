import { Modal, Pressable, Text, View, useColorScheme } from 'react-native';
import { useMotionEnabled } from '@/motion/use-motion';
import { worldForScheme } from '@/theme/world';
import { useUiStyles } from './use-ui-styles';

/** App-owned confirmation works identically on native and web, including keyboard/back cancellation. */
export function ConfirmDialog({ visible, title, message, confirmLabel, cancelLabel = '취소', onConfirm, onCancel }: {
  visible: boolean; title: string; message: string; confirmLabel: string; cancelLabel?: string;
  onConfirm: () => void; onCancel: () => void;
}) {
  const world = worldForScheme(useColorScheme());
  const styles = useUiStyles();
  const motion = useMotionEnabled();
  return <Modal visible={visible} transparent animationType={motion ? 'fade' : 'none'} onRequestClose={onCancel}>
    <View style={{ flex: 1, backgroundColor: '#102C3AC0', justifyContent: 'center', padding: 24 }}>
      <View accessibilityViewIsModal onAccessibilityEscape={onCancel} style={{ width: '100%', maxWidth: 420, alignSelf: 'center',
        backgroundColor: world.card, borderRadius: 24, padding: 22, gap: 18 }}>
        <Text accessibilityRole="header" style={styles.cardTitle}>{title}</Text>
        <Text style={styles.cardBody}>{message}</Text>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 10 }}>
          <Pressable accessibilityRole="button" onPress={onCancel} style={[styles.secondaryButton, { flexGrow: 1 }]}><Text style={styles.secondaryButtonText}>{cancelLabel}</Text></Pressable>
          <Pressable accessibilityRole="button" onPress={onConfirm} style={[styles.primaryButton, { flexGrow: 1 }]}><Text style={styles.primaryButtonText}>{confirmLabel}</Text></Pressable>
        </View>
      </View>
    </View>
  </Modal>;
}
