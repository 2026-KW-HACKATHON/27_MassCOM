/** The installed package, not a mutable environment flag, names the account context. */
export function accountContextLabel(packageId: string | null | undefined): string {
  if (packageId === 'kr.masscom.wolgye.demo') return '체험용 계정';
  if (packageId === 'kr.masscom.wolgye.dev') return '개발용 계정';
  return '운영 계정';
}
