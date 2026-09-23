export type AppColors = {
  label: string; secondaryLabel: string; separator: string; background: string; surface: string;
  primary: string; onPrimary: string; primaryContainer: string; onPrimaryContainer: string;
  success: string; successContainer: string; onSuccessContainer: string;
  error: string; errorContainer: string; onErrorContainer: string;
  accentContainer: string; onAccentContainer: string;
};

export const lightColors: AppColors = {
  label: '#192331', secondaryLabel: '#58677D', separator: '#DDE3EC',
  background: '#FFFFFF', surface: '#F5F7FA', primary: '#2456D6', onPrimary: '#FFFFFF',
  primaryContainer: '#EBF1FF', onPrimaryContainer: '#192331', success: '#2D6A4F',
  successContainer: '#DDEFE5', onSuccessContainer: '#174D35', error: '#9A371D',
  errorContainer: '#FCE4DA', onErrorContainer: '#7B2718',
  accentContainer: '#F7E8C9', onAccentContainer: '#4D3516',
};

export const darkColors: AppColors = {
  label: '#F3F5F9', secondaryLabel: '#A6B0C0', separator: '#343C49',
  background: '#14171D', surface: '#20252F', primary: '#9BB8FF', onPrimary: '#14254A',
  primaryContainer: '#25334F', onPrimaryContainer: '#D9F2FC', success: '#75D6A2',
  successContainer: '#163A29', onSuccessContainer: '#D8F8E5', error: '#FFB4A1',
  errorContainer: '#512015', onErrorContainer: '#FFE2DA',
  accentContainer: '#45371B', onAccentContainer: '#F8E9CC',
};

export function colorsForScheme(
  scheme: 'light' | 'dark' | 'unspecified' | null | undefined,
): AppColors {
  return scheme === 'dark' ? darkColors : lightColors;
}
