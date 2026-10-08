import { useAuthSession } from '@/auth/auth-provider';
import { useDiscovery } from '@/discovery/discovery-provider';
import { AvatarPortrait } from '@/illustration/avatar-portrait';
import { selectedCompanion } from '@/shop/selected-companion';
import { equippedClothingArt } from '@/shop/wardrobe';

import { Mascot } from './mascot';
import type { MascotPose } from './mascot-art';

export function AccountCompanion({ pose, size, interactive = false, breathe = true }: {
  pose: MascotPose; size: number; interactive?: boolean; breathe?: boolean;
}) {
  const auth = useAuthSession();
  const { strip } = useDiscovery();
  const shop = auth.credential ? strip.shop : undefined;
  const avatar = selectedCompanion(shop);
  if (!avatar) return <Mascot pose={pose} size={size} interactive={interactive} breathe={breathe} />;
  return <AvatarPortrait avatar={avatar} clothing={equippedClothingArt(shop)} size={size}
    reaction={pose === 'cheer' || pose === 'gift' || pose === 'stamp' ? 'cheer' : pose === 'puzzled' ? 'concerned' : pose === 'friends' ? 'wave' : 'idle'}
    interactive={interactive} animated={breathe} />;
}
