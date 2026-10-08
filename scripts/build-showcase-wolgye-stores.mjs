#!/usr/bin/env node
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const station = { lat: 37.6341068, lng: 127.0589231 };
const outputPath = fileURLToPath(new URL('../apps/api/src/showcase/wolgye-stores.json', import.meta.url));
const attribution = '출처: 소상공인시장진흥공단 상가(상권)정보(공공데이터포털, 2026-06-30 기준)';

function distanceM({ lat, lng }) {
  const radians = Math.PI / 180;
  const deltaLat = (lat - station.lat) * radians;
  const deltaLng = (lng - station.lng) * radians;
  const arc = Math.sin(deltaLat / 2) ** 2 +
    Math.cos(station.lat * radians) * Math.cos(lat * radians) * Math.sin(deltaLng / 2) ** 2;
  return 2 * 6371000 * Math.asin(Math.sqrt(arc));
}

function categoryOf({ category_mid: mid, category_small: small }) {
  if (small === '카페') return '카페';
  if (small === '빵/도넛') return '베이커리';
  if (small === '김밥/만두/분식') return '분식';
  return { 한식: '한식', 중식: '중식', 일식: '일식', 서양식: '양식', 비알코올: '카페', 주점: '주점' }[mid] ?? '기타';
}

export function selectWolgyeStores(rows) {
  if (!Array.isArray(rows)) throw new Error('입력은 점포 배열이어야 합니다');
  const candidates = rows.map(row => {
    if (row.source !== 'SEMAS' || !/^[A-Za-z0-9]+$/.test(row.source_ids?.semas ?? '') ||
        !row.name?.trim() || !row.road_address?.trim() ||
        !row.category_mid?.trim() || !row.category_small?.trim() ||
        (row.branch != null && typeof row.branch !== 'string') ||
        !Number.isFinite(row.lat) || row.lat < -90 || row.lat > 90 ||
        !Number.isFinite(row.lng) || row.lng < -180 || row.lng > 180) {
      throw new Error('SEMAS 점포의 필수 필드가 없습니다');
    }
    if (row.data_date !== '2026-06-30') throw new Error('SEMAS 기준일이 출처 표기의 2026-06-30과 다릅니다');
    return { row, distanceM: distanceM(row) };
  }).sort((a, b) => a.distanceM - b.distanceM || a.row.source_ids.semas.localeCompare(b.row.source_ids.semas));

  const stores = [];
  const names = new Set();
  const categoryCounts = new Map();
  for (const { row, distanceM: distance } of candidates) {
    if (/구내식당|유흥\s*주점/.test(row.category_small ?? '')) continue;
    const name = [row.name.trim(), row.branch?.trim()].filter(Boolean).join(' ');
    if (names.has(name) || (categoryCounts.get(row.category_mid) ?? 0) >= 6) continue;
    names.add(name);
    categoryCounts.set(row.category_mid, (categoryCounts.get(row.category_mid) ?? 0) + 1);
    stores.push({
      id: `showcase-wolgye-${row.source_ids.semas}`,
      name,
      category: categoryOf(row),
      categoryMid: row.category_mid,
      roadAddress: row.road_address,
      lat: row.lat,
      lng: row.lng,
      distanceM: Math.round(distance),
      sourceId: row.source_ids.semas,
      dataDate: row.data_date,
    });
    if (stores.length === 30) break;
  }
  if (stores.length !== 30) throw new Error(`선정 가능한 점포가 ${stores.length}개뿐입니다 (30개 필요)`);
  return { attribution, stores };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  if (process.argv.length !== 3) throw new Error('사용법: node scripts/build-showcase-wolgye-stores.mjs <wolgye-restaurants.json>');
  const result = selectWolgyeStores(JSON.parse(readFileSync(process.argv[2], 'utf8')));
  writeFileSync(outputPath, `${JSON.stringify(result, null, 2)}\n`);
  console.log(`${result.stores.length}개 점포를 ${outputPath}에 기록했습니다`);
}
