export type AppColors = {
  label: string; secondaryLabel: string; separator: string; background: string; surface: string;
  primary: string; onPrimary: string; primaryContainer: string; onPrimaryContainer: string;
  success: string; successContainer: string; onSuccessContainer: string;
  error: string; errorContainer: string; onErrorContainer: string;
  accentContainer: string; onAccentContainer: string;
};

export const lightColors: AppColors = {
  label: '#102833', secondaryLabel: '#526A73', separator: '#C9D9DE',
  background: '#F4F9FA', surface: '#FFFFFF', primary: '#286585', onPrimary: '#FFFFFF',
  primaryContainer: '#D9EDF5', onPrimaryContainer: '#163B4D', success: '#2D6A4F',
  successContainer: '#DDEFE5', onSuccessContainer: '#174D35', error: '#9A371D',
  errorContainer: '#FCE4DA', onErrorContainer: '#7B2718',
  accentContainer: '#F7E8C9', onAccentContainer: '#4D3516',
};

export const darkColors: AppColors = {
  label: '#F2F7F9', secondaryLabel: '#B8C8CF', separator: '#35515C',
  background: '#071A22', surface: '#102A35', primary: '#86D1F2', onPrimary: '#052430',
  primaryContainer: '#173F50', onPrimaryContainer: '#D9F2FC', success: '#75D6A2',
  successContainer: '#163A29', onSuccessContainer: '#D8F8E5', error: '#FFB4A1',
  errorContainer: '#512015', onErrorContainer: '#FFE2DA',
  accentContainer: '#45371B', onAccentContainer: '#F8E9CC',
};

export function colorsForScheme(
  scheme: 'light' | 'dark' | 'unspecified' | null | undefined,
): AppColors {
  return scheme === 'dark' ? darkColors : lightColors;
}
