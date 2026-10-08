import { publicDataDemoStoreName } from '@/merchant/public-data-demo-store';
import type { Bounds, MapCluster, MerchantSummary } from '../../../../api/src/real-world-contract';
import type { MapMarker } from '@/maps/tmap-view';

export const clusterMarkerId=(id:string)=>`server-${id}`;
const contains=(bounds:Bounds,point:NonNullable<MerchantSummary['position']>)=>point.latitude>=bounds.south&&point.latitude<=bounds.north&&point.longitude>=bounds.west&&point.longitude<=bounds.east;
export function clusterQueryBounds(bounds:Bounds,id?:string,zoom?:number,scope?:Bounds):Bounds {
  const cell=id?.match(/^cluster:(-?\d+):(-?\d+)$/);
  if(cell&&Number.isInteger(zoom)&&zoom!>=0&&zoom!<=20){
    const scale=2**zoom!;const y=Number(cell[1]),x=Number(cell[2]);
    const south=Math.max(scope?.south??-90,y*180/scale),north=Math.min(scope?.north??90,(y+1)*180/scale-1e-9);
    const west=Math.max(scope?.west??-180,x*360/scale),east=Math.min(scope?.east??180,(x+1)*360/scale-1e-9);
    if(south<north&&west<east)return {south,north,west,east};
  }
  const latPad=Math.max((bounds.north-bounds.south)*0.05,0.0001);
  const lonPad=Math.max((bounds.east-bounds.west)*0.05,0.0001);
  return {south:Math.max(-90,bounds.south-latPad),north:Math.min(90,bounds.north+latPad),west:Math.max(-180,bounds.west-lonPad),east:Math.min(180,bounds.east+lonPad)};
}
export function markersForDiscovery(clusters:readonly MapCluster[],merchants:readonly MerchantSummary[],visited:ReadonlySet<string>): (MapMarker & {count?:number})[] {
  const represented=new Set<string>();
  const markers: (MapMarker & {count?:number})[]=[];
  for(const cluster of clusters){
    const loaded=merchants.filter(m=>m.position&&contains(cluster.bounds,m.position));
    loaded.forEach(m=>represented.add(m.id));
    if(cluster.count===1&&loaded.length===1){const m=loaded[0]!;markers.push({id:m.id,latitude:m.position!.latitude,longitude:m.position!.longitude,title:publicDataDemoStoreName(m.id, m.name),state:visited.has(m.id)?'visited':'unvisited'});}
    else markers.push({id:clusterMarkerId(cluster.id),latitude:cluster.position.latitude,longitude:cluster.position.longitude,title:`전체 ${cluster.count}곳`,state:'external',count:cluster.count});
  }
  for(const m of merchants){if(represented.has(m.id)||!m.position)continue;markers.push({id:m.id,latitude:m.position.latitude,longitude:m.position.longitude,title:publicDataDemoStoreName(m.id, m.name),state:visited.has(m.id)?'visited':'unvisited'});}
  return markers;
}
