import type { Point } from '../../../../api/src/real-world-contract';
import type { CourseStop } from './course';

export function routePlanKey(origin: (Point & {basis?:string}) | null, stops: readonly CourseStop[]): string {
  return JSON.stringify([origin?.latitude,origin?.longitude,origin?.basis,stops.map(stop=>[stop.merchantId,stop.dwellMinutes])]);
}
export function createRouteRequestGate() {
  let generation=0;let active:AbortController|null=null;let key='';
  return {
    begin(controller:AbortController,planKey:string) {active?.abort();active=controller;key=planKey;return ++generation;},
    invalidate() {generation++;active?.abort();active=null;key='';},
    isCurrent(token:number,planKey:string) {return token===generation&&key===planKey&&!active?.signal.aborted;},
  };
}
