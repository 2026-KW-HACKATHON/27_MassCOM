import { useAuthSession } from '@/auth/auth-provider';
import { publicApiConfig } from '@/config/public-api-runtime';
import { AuthRequiredRoute } from '@/screens/auth-required/route';
import { DemoConfigurationRequired } from '@/screens/demo-configuration-required';
import { BackHeader } from '@/ui/back-header';
import { SkyBackdrop } from '@/ui/sky-backdrop';
import { SkyScrollView } from '@/ui/sky-scroll-view';
import { CoursesScreen } from './index';

export function CoursesRoute({ courseId }: { courseId?: string }) {
  const auth = useAuthSession();
  const header = <BackHeader title={courseId ? '코스 상세' : '동네 코스'} />;
  if (!auth.credential || !auth.accountId) return <SkyBackdrop><AuthRequiredRoute header={header} /></SkyBackdrop>;
  if (!publicApiConfig.available) return <SkyBackdrop><SkyScrollView header={header}>
    <DemoConfigurationRequired title="동네 코스 설정이 필요합니다." missing={['EXPO_PUBLIC_API_URL']} />
  </SkyScrollView></SkyBackdrop>;
  return <CoursesScreen key={`${auth.accountId}:${courseId ?? 'list'}`} apiUrl={publicApiConfig.apiUrl}
    credential={auth.credential} onSessionInvalid={auth.invalidateSession} courseId={courseId} />;
}
