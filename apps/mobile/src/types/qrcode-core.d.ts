// Only the pure-JS encoder is used; the package's canvas/file renderers do not run on React Native.
declare module 'qrcode/lib/core/qrcode' {
  export function create(
    text: string,
    options?: { errorCorrectionLevel?: 'L' | 'M' | 'Q' | 'H' },
  ): { modules: { size: number; get(row: number, column: number): number | boolean } };
}
