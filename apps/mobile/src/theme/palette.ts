export type AppColors = {
  label: string; secondaryLabel: string; separator: string; background: string; surface: string;
  primary: string; onPrimary: string; primaryContainer: string; onPrimaryContainer: string;
  success: string; successContainer: string; onSuccessContainer: string;
  error: string; errorContainer: string; onErrorContainer: string;
  accentContainer: string; onAccentContainer: string;
};

export const lightColors: AppColors = {
  label: '#163D46', secondaryLabel: '#48646A', separator: '#DFE7E3',
  background: '#FAFAF5', surface: '#F3F5F0', primary: '#076F64', onPrimary: '#FFFFFF',
  primaryContainer: '#E1F7EF', onPrimaryContainer: '#163D46', success: '#2D6A4F',
  successContainer: '#DDEFE5', onSuccessContainer: '#174D35', error: '#9A371D',
  errorContainer: '#FCE4DA', onErrorContainer: '#7B2718',
  accentContainer: '#F7E8C9', onAccentContainer: '#4D3516',
};

export const darkColors: AppColors = {
  label: '#F3F5F9', secondaryLabel: '#B4C6BF', separator: '#3C5550',
  background: '#112724', surface: '#1D3431', primary: '#83DCCA', onPrimary: '#103A32',
  primaryContainer: '#234C43', onPrimaryContainer: '#DFF8EF', success: '#75D6A2',
  successContainer: '#163A29', onSuccessContainer: '#D8F8E5', error: '#FFB4A1',
  errorContainer: '#512015', onErrorContainer: '#FFE2DA',
  accentContainer: '#45371B', onAccentContainer: '#F8E9CC',
};

export function colorsForScheme(
  scheme: 'light' | 'dark' | 'unspecified' | null | undefined,
): AppColors {
  return scheme === 'dark' ? darkColors : lightColors;
}
