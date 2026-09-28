import type { ReactNode } from 'react';
import { Dimensions, Modal, View } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';

/**
 * Edge-to-edge Android modal that really covers the screen. With translucent system bars the
 * modal's root view can come out shorter than the window (seen on a 3-button-navigation Galaxy),
 * leaving the tab bar showing below it, so the content is pinned to the physical screen height.
 * The modal is its own window: children measure insets from this SafeAreaProvider.
 */
export function FullScreenModal({ visible, animationType, onRequestClose, children }: {
  visible: boolean;
  animationType: 'fade' | 'slide';
  onRequestClose: () => void;
  children: ReactNode;
}) {
  return (
    <Modal
      visible={visible}
      transparent
      animationType={animationType}
      statusBarTranslucent
      navigationBarTranslucent
      onRequestClose={onRequestClose}
    >
      <SafeAreaProvider>
        <View style={{ flex: 1, minHeight: Dimensions.get('screen').height }}>{children}</View>
      </SafeAreaProvider>
    </Modal>
  );
}
