import { Platform } from 'react-native';

/** The web build ships no CameraView; QR scanning falls back to manual code entry (Issue #309). */
export const canUseCamera = Platform.OS !== 'web';
