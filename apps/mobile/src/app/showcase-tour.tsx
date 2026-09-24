import * as Application from 'expo-application';
import { Redirect, useRouter } from 'expo-router';

import { canOpenShowcaseTour } from '@/navigation/showcase-entry';
import { FoundationScreen } from '@/screens/foundation';

export default function ShowcaseTourRoute() {
  const router = useRouter();
  if (!canOpenShowcaseTour(Application.applicationId)) return <Redirect href="/" />;

  return <FoundationScreen
    initialRole="customer"
    showcaseTour
    onExit={() => router.replace('/')}
  />;
}
