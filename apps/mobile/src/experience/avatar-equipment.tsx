import { View } from 'react-native';
import type { ExperienceProfile } from './experience-api';
import { CosmeticArt } from '@/illustration/artwork';
import { CharacterArt } from '@/illustration/character-art';

type Equipment = Pick<ExperienceProfile, 'cosmetics'>;
type Anchor = { hatX: number; headSeat: number; handX: number; handY: number; waveRight?: boolean };
const anchors: Readonly<Record<string, Anchor>> = {
  'cook-cat': { hatX: .28, headSeat: .23, handX: .27, handY: .65, waveRight: true },
  'cafe-bear': { hatX: .28, headSeat: .22, handX: .27, handY: .61 },
  'walk-rabbit': { hatX: .28, headSeat: .40, handX: .24, handY: .65, waveRight: true },
  'bakery-squirrel': { hatX: .27, headSeat: .25, handX: .26, handY: .63, waveRight: true },
  'flower-hedgehog': { hatX: .27, headSeat: .26, handX: .26, handY: .61 },
  'book-owl': { hatX: .28, headSeat: .24, handX: .25, handY: .65 },
  'tteok-tiger': { hatX: .28, headSeat: .25, handX: .25, handY: .64, waveRight: true },
  'market-raccoon': { hatX: .28, headSeat: .24, handX: .25, handY: .63, waveRight: true },
  'laundry-seal': { hatX: .28, headSeat: .27, handX: .23, handY: .65 },
};

export function AvatarEquipment({ avatar, equipment, size, frame = 0, layer = 'all', onLoad, onError }: {
  avatar: string | null; equipment?: Equipment; size: number; frame?: 0 | 1 | 2 | 3;
  layer?: 'back' | 'front' | 'all'; onLoad?: (slot: string) => void; onError?: () => void;
}) {
  if (!avatar || !equipment) return null;
  const anchor = anchors[avatar] ?? anchors['cook-cat']!;
  const { hat, bag, prop } = equipment.cosmetics;
  // Measured painted lower edge inside each hat cell; the empty sprite padding is not the brim.
  const brim = hat === 'silver-hat' ? .988 : hat === 'gold-hat' ? .857 :
    hat === 'bronze-hat' ? .904 : hat?.startsWith('regular') ? .908 : hat?.startsWith('steady') ? .892 : .920;
  const handX = frame === 2 ? .18 : frame === 1 && anchor.waveRight ? .51 : anchor.handX;
  const handY = frame === 2 ? .34 : frame === 3 ? .62 : anchor.handY;
  return <View pointerEvents="none" style={{ position: 'absolute', width: size, height: size }}>
    {layer !== 'front' && bag ? <View style={{ position: 'absolute', left: size * .64, top: size * .48 }}>
      <CosmeticArt id={bag} size={size * .33} onLoad={() => onLoad?.('bag')} onError={onError} />
    </View> : null}
    {layer !== 'back' && hat ? <View style={{ position: 'absolute', left: size * anchor.hatX,
      top: size * (anchor.headSeat - .47 * brim + (frame === 3 ? .035 : 0)), transform: [{ rotate: frame === 3 ? '-5deg' : '0deg' }] }}>
      <CosmeticArt id={hat} size={size * .47} onLoad={() => onLoad?.('hat')} onError={onError} />
    </View> : null}
    {layer !== 'back' && prop ? <View style={{ position: 'absolute', left: size * (handX - .095), top: size * (handY - .08) }}>
      <CosmeticArt id={prop} size={size * .33} onLoad={() => onLoad?.('prop')} onError={onError} />
    </View> : null}
    {layer !== 'back' && prop ? <View style={{ position: 'absolute', left: size * handX, top: size * handY,
      width: size * .15, height: size * .13, borderRadius: size * .065, overflow: 'hidden' }}>
      <CharacterArt avatar={avatar} frame={frame} size={size}
        style={{ position: 'absolute', left: -size * handX, top: -size * handY }} />
    </View> : null}
  </View>;
}
