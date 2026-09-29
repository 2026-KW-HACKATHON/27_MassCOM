/**
 * Screen-reader props for a mascot: an announced image when it has a label (a button that says what a tap does when it is
 * interactive), otherwise hidden decoration. A decorative hero stays tappable for sighted users but adds no focus stop.
 */
export function mascotAccessibility(label: string | undefined, interactive = false) {
  if (!label) return { accessible: false, importantForAccessibility: 'no-hide-descendants', accessibilityElementsHidden: true } as const;
  return interactive
    ? ({ accessible: true, accessibilityRole: 'button', accessibilityLabel: label, accessibilityHint: '눌러서 흔들기' } as const)
    : ({ accessible: true, accessibilityRole: 'image', accessibilityLabel: label } as const);
}
