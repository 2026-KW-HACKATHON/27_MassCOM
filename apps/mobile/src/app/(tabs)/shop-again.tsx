import { Redirect } from 'expo-router';

// The second shop tab was merged into 상점 (Issue #412); links that still point here keep working.
export default function ShopAgainRoute() {
  return <Redirect href="/shop" />;
}
