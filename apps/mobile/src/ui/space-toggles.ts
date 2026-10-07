/**
 * 웹 전용: react-native-web Pressable은 Space를 button·menuitem 역할에서만 누름으로 보므로 checkbox·radio·switch는 Space를 직접 받아 누른 것으로 처리한다.
 * 호출하는 쪽이 `Platform.OS === 'web'`일 때만 `onKeyDown`으로 붙인다(네이티브는 그대로). 토글 쪽에서 비활성·저장 중 가드를 유지한다.
 */
export const spaceToggles = (toggle: () => void) => (event: {
  key: string; repeat?: boolean; ctrlKey?: boolean; altKey?: boolean; metaKey?: boolean;
  target?: unknown; currentTarget?: unknown; preventDefault: () => void;
}) => {
  // 단축키 조합이거나 안쪽 포커스 가능한 자식(링크 등)에서 올라온 키는 이 행의 것이 아니다: 막지도 토글하지도 않는다.
  if (event.ctrlKey || event.altKey || event.metaKey || event.target !== event.currentTarget) return;
  if (event.key !== ' ' && event.key !== 'Spacebar') return;
  event.preventDefault(); // 페이지 스크롤 방지
  if (!event.repeat) toggle();
};
