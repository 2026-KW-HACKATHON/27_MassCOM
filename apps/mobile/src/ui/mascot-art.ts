// D-045: 승인된 마스코트와 같은 화풍으로 Codex가 그린 포즈 세트. 출처는 v2/SOURCES.md.
export type MascotPose =
  | 'wave' | 'explore-map' | 'stamp' | 'gift' | 'sleep'
  | 'puzzled' | 'friends' | 'search' | 'cheer' | 'logo-badge';

export const MASCOT_POSES: readonly MascotPose[] = [
  'wave', 'explore-map', 'stamp', 'gift', 'sleep', 'puzzled', 'friends', 'search', 'cheer', 'logo-badge',
];

export const mascotArt: Record<MascotPose, number> = {
  'wave': require('../../assets/images/mascot/v2/wave.png'),
  'explore-map': require('../../assets/images/mascot/v2/explore-map.png'),
  'stamp': require('../../assets/images/mascot/v2/stamp.png'),
  'gift': require('../../assets/images/mascot/v2/gift.png'),
  'sleep': require('../../assets/images/mascot/v2/sleep.png'),
  'puzzled': require('../../assets/images/mascot/v2/puzzled.png'),
  'friends': require('../../assets/images/mascot/v2/friends.png'),
  'search': require('../../assets/images/mascot/v2/search.png'),
  'cheer': require('../../assets/images/mascot/v2/cheer.png'),
  'logo-badge': require('../../assets/images/mascot/v2/logo-badge.png'),
};

export const skyTownHeader: number = require('../../assets/images/mascot/v2/sky-town-header.png');
