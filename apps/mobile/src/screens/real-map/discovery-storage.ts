import { accountStorageTag } from '@/wallet/account-scope';

const NAV_KEY = '@masscom:discovery:navigation';
const COURSE_KEY = '@masscom:discovery:course';

type Storage = Pick<typeof import('@react-native-async-storage/async-storage').default, 'getItem' | 'removeItem'>;

export function discoveryStorageKeys(scope: { accountId: string; apiUrl: string; packageId: string }) {
  const tag = accountStorageTag(`${scope.packageId}:${new URL(scope.apiUrl).origin}:${scope.accountId}`);
  return { navigation: `${NAV_KEY}:v2:${tag}`, course: `${COURSE_KEY}:v2:${tag}` };
}

export async function loadDiscoveryStorage(storage: Storage, keys: ReturnType<typeof discoveryStorageKeys> | null) {
  // 공용 키는 누구의 기록인지 알 수 없으므로 복원하지 않고 지운다.
  await Promise.all([storage.removeItem(NAV_KEY), storage.removeItem(COURSE_KEY)]);
  return keys ? Promise.all([storage.getItem(keys.navigation), storage.getItem(keys.course)]) : [null, null];
}
