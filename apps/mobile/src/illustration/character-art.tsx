import { Image, View } from 'react-native';
import { AtlasImage, type ArtProps } from './atlas-image';
import { characterFrame, type CharacterFrame } from './art-catalog';
const characters: Readonly<Record<string, number>> = {
  'cook-cat': require('../../assets/images/experience-quality/characters/cook-cat-poses.png'),
  'cafe-bear': require('../../assets/images/experience-quality/characters/cafe-bear-poses.png'),
  'walk-rabbit': require('../../assets/images/experience-quality/characters/walk-rabbit-poses.png'),
  'bakery-squirrel': require('../../assets/images/experience-quality/characters/bakery-squirrel-poses.png'),
  'flower-hedgehog': require('../../assets/images/experience-quality/characters/flower-hedgehog-poses.png'),
  'book-owl': require('../../assets/images/experience-quality/characters/book-owl-poses.png'),
  'tteok-tiger': require('../../assets/images/experience-quality/characters/tteok-tiger-poses.png'),
  'market-raccoon': require('../../assets/images/experience-quality/characters/market-raccoon-poses.png'),
  'laundry-seal': require('../../assets/images/experience-quality/characters/laundry-seal-poses.png'),
};
const mascot = {
  calm: require('../../assets/images/mascot/v2/wave.png'),
  joy: require('../../assets/images/mascot/v2/cheer.png'),
  worried: require('../../assets/images/mascot/v2/puzzled.png'),
};
export function CharacterArt({ avatar, frame = 'calm', ...props }: ArtProps & { avatar: string | null; frame?: CharacterFrame }) {
  const index = characterFrame(frame);
  const source = avatar ? characters[avatar] : undefined;
  return source ? <AtlasImage {...props} source={source} columns={2} rows={2} frame={index} />
    : <View style={[{ width: props.size, height: props.size }, props.style]}><Image source={index === 2 ? mascot.joy : index === 3 ? mascot.worried : mascot.calm}
      resizeMode="contain" accessible={false} onLoad={props.onLoad} onError={props.onError}
      style={{ width: props.size, height: props.size }} /></View>;
}
