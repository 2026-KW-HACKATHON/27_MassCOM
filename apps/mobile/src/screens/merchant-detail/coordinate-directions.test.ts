import assert from 'node:assert/strict';
import test from 'node:test';
import { coordinateWalkTargets } from './coordinate-directions';

test('owned entrance is the exact walking destination; native route uses latitude then longitude',()=>{
  const result=coordinateWalkTargets({name:'가게',destination:{latitude:37.62,longitude:127.05},origin:{latitude:37.61,longitude:127.04}});
  assert.match(result!.naver.app,/nmap:\/\/route\/walk\?slat=37\.61&slng=127\.04.*dlat=37\.62&dlng=127\.05/);
  assert.match(result!.kakao!.app,/sp=37\.61,127\.04&ep=37\.62,127\.05&by=foot/);
  assert.match(result!.kakao!.web,/\/link\/by\/walk\//);
});
test('without chosen origin, only documented Naver current-location walk is offered',()=>{
  const result=coordinateWalkTargets({name:'가게',destination:{latitude:37.62,longitude:127.05}});
  assert.equal(result!.kakao,null);assert.match(result!.naver.app,/dlat=37\.62&dlng=127\.05/);
  assert.doesNotMatch(result!.naver.app,/slat=|slng=/);
});
test('invalid destination is not silently changed into an address search',()=>{
  assert.equal(coordinateWalkTargets({name:'bad',destination:{latitude:NaN,longitude:127}}),null);
});
