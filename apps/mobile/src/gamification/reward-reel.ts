import type { RedeemedClaim } from '@/commerce/commerce-api';

import type { Reward } from './badge-api';
import type { RaisedMedal } from './badge-rules';

type GrantedReward = RedeemedClaim['grantedRewards'][number] & { artwork?: boolean };

export type RewardReelInput = {
  grantedRewards: readonly GrantedReward[];
  raisedMedals: readonly RaisedMedal[];
  openableBox: readonly Reward[];
  mileageDelta?: number;
};

export type RewardReelItem =
  | { type: 'collectible'; reward: GrantedReward }
  | { type: 'medal'; raised: RaisedMedal }
  | { type: 'box'; reward: Reward }
  | { type: 'mileage'; amount: number };

/** Only confirmed, displayable rewards enter the reel; order matches the visit result. */
export function rewardReel(input: RewardReelInput): RewardReelItem[] {
  return [
    ...input.grantedRewards.filter((reward) => reward.artwork).sort((a, b) => a.targetVisitCount - b.targetVisitCount)
      .map((reward) => ({ type: 'collectible' as const, reward })),
    ...input.raisedMedals.map((raised) => ({ type: 'medal' as const, raised })),
    ...input.openableBox.map((reward) => ({ type: 'box' as const, reward })),
    ...(input.mileageDelta !== undefined && Number.isFinite(input.mileageDelta) && input.mileageDelta > 0
      ? [{ type: 'mileage' as const, amount: input.mileageDelta }]
      : []),
  ];
}
