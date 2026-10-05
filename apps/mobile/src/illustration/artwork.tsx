import { View } from 'react-native';
import { AtlasImage, type ArtProps } from './atlas-image';
import { badgeFrame, cosmeticFrames, packFrame } from './art-catalog';
import { CharacterArt } from './character-art';
export function CosmeticArt({ id, ...props }: ArtProps & { id: string | null | undefined }) {
  if (id === 'stack-cheer') return <CharacterArt {...props} avatar="walk-rabbit" frame="cheer" />;
  const frame = id ? cosmeticFrames[id] : undefined;
  if (frame === undefined) return null;
  const image = <AtlasImage {...props} source={require('../../assets/images/experience-quality/equipment-atlas.png')} columns={5} rows={5} frame={frame} />;
  // The compass begins after this transparent gutter; exclude a speck from the adjacent cap.
  return frame === 6 ? <View style={{ width: props.size, height: props.size }}>
    <View style={{ left: props.size * .09, width: props.size * .91, height: props.size, overflow: 'hidden' }}>
      <AtlasImage {...props} style={{ left: -props.size * .09 }} source={require('../../assets/images/experience-quality/equipment-atlas.png')}
        columns={5} rows={5} frame={frame} />
    </View>
  </View> : image;
}
export function BadgeArt({ id, size, ...props }: ArtProps & { id: string | null | undefined }) {
  const frame = id ? badgeFrame(id) : undefined;
  if (frame === undefined) return null;
  const tier = id?.endsWith('gold') ? '#D8AE47' : id?.endsWith('silver') ? '#A9C5D9' : '#B67B4A';
  return <View pointerEvents="none" style={{ width: size, height: size, borderRadius: size / 2,
    borderColor: tier, borderWidth: Math.max(1, size * .025) }}>
    <AtlasImage {...props} size={size * .94} style={{ margin: size * .005 }}
      source={require('../../assets/images/experience-quality/badge-atlas.png')} columns={3} rows={3} frame={frame} />
  </View>;
}
export function PackArt({ grade, ...props }: ArtProps & { grade: string }) {
  const frame = packFrame(grade);
  return frame === undefined ? null : <AtlasImage {...props} source={require('../../assets/images/experience-quality/pack-atlas.png')}
    columns={2} rows={2} frame={frame} />;
}
