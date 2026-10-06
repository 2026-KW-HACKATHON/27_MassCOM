import type { DiscoveryEvent } from '../../../api/src/real-world-contract';
import type { DetailViewSource } from './detail-view-api';

const sent = new Set<string>();
/** New v1 event equivalent of the legacy once-per-app-session/KST-day detail view. */
export async function sendDiscoveryDetailView(api: {event: (event:DiscoveryEvent)=>Promise<unknown>}, merchantId:string, source:DetailViewSource,
  eventId:()=>string, now:Date=new Date()): Promise<void> {
  const day=new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Seoul',year:'numeric',month:'2-digit',day:'2-digit'}).format(now);
  const key=`${day}:${merchantId}`;
  if(sent.has(key))return;
  sent.add(key);
  await api.event({eventId:eventId(),merchantId,event:'DETAIL_VIEW',source});
}
