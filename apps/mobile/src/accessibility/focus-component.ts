import { AccessibilityInfo, type HostInstance } from 'react-native';

/**
 * AccessibilityInfo.sendAccessibilityEvent is Android-only in React Native (iOS and
 * react-native-web both lack it) — calling it unconditionally throws "is not a function" in a
 * browser. Every screen that moves screen-reader focus to a just-opened heading routes through
 * this one guard instead of checking per call site (Issue #309, found via the web build).
 */
export function focusForAccessibility(node: HostInstance | null): void {
  if (node && typeof AccessibilityInfo.sendAccessibilityEvent === 'function') {
    AccessibilityInfo.sendAccessibilityEvent(node, 'focus');
  }
}
