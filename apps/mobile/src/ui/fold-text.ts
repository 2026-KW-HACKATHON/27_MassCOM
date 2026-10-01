/** Pure label text for `Fold` (#296): expanded state is spoken, never color-only. */
export function foldAccessibilityLabel(title: string, summary: string | undefined, expanded: boolean): string {
  return `${title}${summary ? `, ${summary}` : ''}, ${expanded ? '펼쳐짐' : '접힘'}`;
}

export function foldAccessibilityHint(expanded: boolean): string {
  return expanded ? '접으려면 두 번 탭하세요' : '펼치려면 두 번 탭하세요';
}

export function foldToggleText(expanded: boolean): string {
  return expanded ? '접기 ▲' : '더보기 ▼';
}
