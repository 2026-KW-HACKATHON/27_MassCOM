import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { selectWolgyeStores } from '../../scripts/build-showcase-wolgye-stores.mjs';

const station = { lat: 37.6341068, lng: 127.0589231 };

function row(id, mid, small, offset, name = `가게 ${id}`) {
  return {
    name, branch: null, category_mid: mid, category_small: small,
    road_address: '서울특별시 노원구 월계로53길 89',
    lat: station.lat + offset * 0.00001, lng: station.lng,
    dist_from_station_m: 99999, // The builder must recompute distance from coordinates.
    source: 'SEMAS', source_ids: { semas: `MA${id}` }, data_date: '2026-06-30',
  };
}

function campusRows(count = 300) {
  return Array.from({ length: count }, (_, index) => ({
    ...row(`near${index}`, '한식', '백반/한정식', 0),
    lat: 37.6206 + index * 0.000001,
    lng: 127.0567,
  }));
}

test('preserves the original 30 and adds 300 distinct shops closest to Kwangwoon University', () => {
  const groups = [
    ['한식', '백반/한정식'], ['중식', '중국집'], ['일식', '일식 회/초밥'],
    ['서양식', '경양식'], ['기타 간이', '김밥/만두/분식'],
  ];
  const rows = groups.flatMap(([mid, small], group) =>
    Array.from({ length: 6 }, (_, index) => row(`${group}${index}`, mid, small, group * 6 + index + 5)));
  rows.push(row('extra', '한식', '백반/한정식', 1));
  rows.push(row('duplicate', '중식', '중국집', 2, '가게 10'));
  rows.push(row('cafeteria', '기타 간이', '구내식당', 0));
  rows.push(row('nightclub', '주점', '일반 유흥 주점', 0));
  rows.push(...campusRows());

  const { attribution, stores } = selectWolgyeStores(rows.reverse());
  assert.match(attribution, /소상공인시장진흥공단.*2026-06-30/);
  assert.equal(stores.length, 330);
  assert.equal(stores[0].sourceId, 'MAextra');
  assert.equal(stores[0].distanceM, 1);
  assert.equal(stores.slice(0, 30).filter(store => store.categoryMid === '한식').length, 6);
  assert.equal(stores.slice(0, 30).filter(store => store.categoryMid === '중식').length, 6);
  assert.equal(new Set(stores.map(store => store.id)).size, 330);
  assert.equal(stores[30].sourceId, 'MAnear0');
  assert.equal(stores[329].sourceId, 'MAnear299');
  assert.ok(stores.every(store => !['MAcafeteria', 'MAnightclub', 'MA05'].includes(store.sourceId)));
  assert.deepEqual(stores.slice(0, 1).map(({ id, category, dataDate }) => ({ id, category, dataDate })), [
    { id: 'showcase-wolgye-MAextra', category: '한식', dataDate: '2026-06-30' },
  ]);
  assert.equal(stores.find(store => store.sourceId === 'MA40')?.category, '분식');
  assert.equal(stores.find(store => store.sourceId === 'MA30')?.category, '양식');
});

test('adds a branch to the visible name and rejects incomplete source data', () => {
  const rows = [...Array.from({ length: 30 }, (_, index) => row(String(index), '한식', '백반/한정식', index + 1)), ...campusRows()];
  for (let index = 0; index < rows.length; index++) rows[index].category_mid = `group-${index}`;
  rows[0].branch = '월계점';
  rows[0].category_small = '빵/도넛';
  rows[1].category_mid = '비알코올';
  rows[1].category_small = '카페';
  const stores = selectWolgyeStores(rows).stores;
  assert.equal(stores[0].name, '가게 0 월계점');
  assert.equal(stores[0].category, '베이커리');
  assert.equal(stores[1].category, '카페');
  rows[0].source_ids.semas = '';
  assert.throws(() => selectWolgyeStores(rows), /필수 필드/);
  rows[0].source_ids.semas = 'MA0';
  rows[0].data_date = '2026-10-31';
  assert.throws(() => selectWolgyeStores(rows), /기준일.*2026-06-30/);
  rows[0].data_date = '2026-06-30';
  rows[0].lat = 91;
  assert.throws(() => selectWolgyeStores(rows), /필수 필드/);
  rows[0].lat = station.lat + 0.00001;
  rows[1].source_ids.semas = rows[0].source_ids.semas;
  assert.throws(() => selectWolgyeStores(rows), /ID가 중복/);
});

test('the public source catalog retains all original 30 records and nearby coverage', () => {
  const catalog = JSON.parse(readFileSync(new URL('../../apps/api/src/showcase/wolgye-stores.json', import.meta.url)));
  assert.equal(catalog.stores.length, 330);
  assert.equal(createHash('sha256').update(JSON.stringify(catalog.stores.slice(0, 30))).digest('hex'),
    '18f9b580882e5ca1a2b67a26060f846c3951ef6042dce0f00535db5ae467141d');
  assert.equal(new Set(catalog.stores.map(store => store.sourceId)).size, 330);
  assert.ok(catalog.stores.every(store => store.dataDate === '2026-06-30' &&
    store.lat >= 37.61 && store.lat <= 37.64 && store.lng >= 127.04 && store.lng <= 127.07));
  assert.ok(catalog.stores.slice(30).some(store => store.roadAddress.includes('월계')));
});
