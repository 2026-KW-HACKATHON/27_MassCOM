import type { ReactNode } from 'react';
import { Dimensions, Modal, Platform, View, useWindowDimensions } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';

/**
 * Edge-to-edge Android modal that really covers the screen. With translucent system bars the
 * modal's root view can come out shorter than the window (seen on a 3-button-navigation Galaxy),
 * leaving the tab bar showing below it, so the content is pinned to the physical screen height.
 * The modal is its own window: children measure insets from this SafeAreaProvider.
 * On web, bound the provider to the viewport so long results scroll inside the dialog.
 */
export function FullScreenModal({ visible, animationType, onRequestClose, children }: {
  visible: boolean;
  animationType: 'fade' | 'slide' | 'none';
  onRequestClose: () => void;
  children: ReactNode;
}) {
  const { height } = useWindowDimensions();
  const web = Platform.OS === 'web';
  return (
    <Modal
      visible={visible}
      transparent
      animationType={animationType}
      statusBarTranslucent
      navigationBarTranslucent
      onRequestClose={onRequestClose}
    >
      <SafeAreaProvider style={web ? { height, maxHeight: height, minHeight: 0 } : undefined}>
        <View style={{ flex: 1, minHeight: web ? 0 : Dimensions.get('screen').height, height: web ? height : undefined }}>{children}</View>
      </SafeAreaProvider>
    </Modal>
  );
}
