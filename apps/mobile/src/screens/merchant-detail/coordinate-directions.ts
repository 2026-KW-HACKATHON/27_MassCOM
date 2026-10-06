import type { Point } from '../../../../api/src/real-world-contract';
import { NAVER_APP_NAME, type DirectionsTargets } from '../town-map/directions';

type ExactWalkTargets = { naver: DirectionsTargets['naver']; kakao: DirectionsTargets['kakao'] | null };
const valid = (point: Point) => Number.isFinite(point.latitude) && Number.isFinite(point.longitude) &&
  point.latitude >= 31.43 && point.latitude <= 44.35 && point.longitude >= 122.37 && point.longitude <= 132;
const encoded = (name: string) => {try{return encodeURIComponent(name);}catch{return null;}};

/** Naver and Kakao official walking schemes. Destination always uses the owned entrance/building coordinate. */
export function coordinateWalkTargets({name,destination,origin}:{name:string;destination:Point;origin?:Point|null}): ExactWalkTargets | null {
  if (!valid(destination) || (origin && !valid(origin))) return null;
  const title=encoded(name);
  if (!title) return null;
  const dest=`${destination.latitude},${destination.longitude}`;
  const marker=`https://map.kakao.com/link/to/${title},${dest}`;
  const source=origin?`slat=${origin.latitude}&slng=${origin.longitude}&sname=${encoded('선택한 출발지')}&`:'';
  const naver={app:`nmap://route/walk?${source}dlat=${destination.latitude}&dlng=${destination.longitude}&dname=${title}&appname=${NAVER_APP_NAME}`,web:marker};
  const kakao=origin?{app:`kakaomap://route?sp=${origin.latitude},${origin.longitude}&ep=${dest}&by=foot`,web:`https://map.kakao.com/link/by/walk/${encoded('선택한 출발지')},${origin.latitude},${origin.longitude}/${title},${dest}`} : null;
  return {naver,kakao};
}
