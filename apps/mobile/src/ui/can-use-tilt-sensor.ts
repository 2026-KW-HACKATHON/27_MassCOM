import { Platform } from 'react-native';

/** The tilt toggle needs a device gravity sensor; a browser/desktop has none (Issue #309). */
export const canUseTiltSensor = Platform.OS !== 'web';
