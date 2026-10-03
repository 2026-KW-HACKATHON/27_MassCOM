import { AccessibilityInfo, Platform, findNodeHandle, type Text } from 'react-native';

/** 웹에는 네이티브 태그가 없으므로 DOM 포커스, 앱에는 스크린리더 포커스를 보낸다. */
export function focusMerchantHeading(heading: Text | null) {
  if (!heading) return;
  if (Platform.OS === 'web') {
    const node = heading as unknown as { setAttribute?: (name: string, value: string) => void; focus?: () => void };
    node.setAttribute?.('tabindex', '-1');
    node.focus?.();
    return;
  }
  const tag = findNodeHandle(heading);
  if (tag != null) AccessibilityInfo.setAccessibilityFocus(tag);
}
