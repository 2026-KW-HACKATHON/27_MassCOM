import type { Studio } from '@/studio/studio-api';

type Goal = {merchantId:string;campaignId:string;publicationId:string;targetVisitCount:1|3|5};
export async function saveCollectibleGoal(api:{getMine:()=>Promise<{studio:Studio}>;save:(studio:Studio)=>Promise<unknown>},
  goal:Goal,isCurrent:()=>boolean):Promise<boolean> {
  const mine=await api.getMine();
  if(!isCurrent())return false;
  await api.save({...mine.studio,goal:{kind:'collectible',...goal}});
  return isCurrent();
}
