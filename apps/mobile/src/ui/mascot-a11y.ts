/** Screen-reader props for a mascot: an announced image when it has a label, otherwise hidden decoration. */
export function mascotAccessibility(label: string | undefined) {
  return label
    ? ({ accessible: true, accessibilityRole: 'image', accessibilityLabel: label } as const)
    : ({ accessible: false, importantForAccessibility: 'no-hide-descendants', accessibilityElementsHidden: true } as const);
}
