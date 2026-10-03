// 보조 문구가 길어져도 QR 자체와 완료 버튼의 공간을 줄이지 않는다.
export const minimumClaimQrSize = 180;

export function claimQrSizeForArea(width: number, height: number): number {
  return Math.max(minimumClaimQrSize, Math.min(320, width - 16, height - 16));
}
