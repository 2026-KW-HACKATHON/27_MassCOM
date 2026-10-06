import assert from 'node:assert/strict';
import { test } from 'node:test';

import { fetchCollectiblePreview } from './collectible-preview-api';

test('공개 수집품 미리보기의 등급·그림을 계약대로 읽는다', async () => {
  const calls: string[] = [];
  const fake: typeof fetch = async (input) => {
    calls.push(String(input));
    return new Response(JSON.stringify({ merchantId: 'm 1', campaignId: 'c1', name: '방문 수집품', goals: [
      { visitCount: 1, gradeId: 'bronze', gradeName: '브론즈', shape: 'circle', theme: '가을', thumbnailDataUrl: null },
      { visitCount: 3, gradeId: 'gold', gradeName: '골드', shape: 'star', theme: '가을', thumbnailDataUrl: 'data:image/png;base64,aA==' },
    ] }), { status: 200 });
  };
  const preview = await fetchCollectiblePreview('https://api.example', 'm 1', fake);
  assert.equal(calls[0], 'https://api.example/merchants/m%201/collectible-preview');
  assert.deepEqual(preview?.goals.map((goal) => [goal.visitCount, goal.gradeName]), [[1, '브론즈'], [3, '골드']]);
  assert.equal(preview?.goals[1]?.thumbnailDataUrl, 'data:image/png;base64,aA==');
});

test('연결된 공개 수집품이 없으면 기존 캠페인 목표를 보여 줄 수 있게 null을 반환한다', async () => {
  const fake: typeof fetch = async () => new Response(JSON.stringify({ code: 'COLLECTIBLE_PREVIEW_NOT_FOUND' }), { status: 404 });
  assert.equal(await fetchCollectiblePreview('https://api.example', 'm1', fake), null);
});

test('new preview exposes publication identity while older preview remains readable', async () => {
  const base = { merchantId: 'm1', campaignId: 'c1', name: '방문', goals: [] };
  const fake = (body: object): typeof fetch => async () => Response.json(body);
  assert.equal((await fetchCollectiblePreview('https://api.example', 'm1', fake({ ...base, publicationId: 'pub-1' })))?.publicationId, 'pub-1');
  assert.equal((await fetchCollectiblePreview('https://api.example', 'm1', fake(base)))?.publicationId, undefined);
  await assert.rejects(fetchCollectiblePreview('https://api.example', 'm1', fake({ ...base, publicationId: 42 })), /응답 형식/);
});

test('서버 오류는 404와 구분해 다시 시도할 수 있게 전달한다', async () => {
  const fake: typeof fetch = async () => new Response(null, { status: 503 });
  await assert.rejects(fetchCollectiblePreview('https://api.example', 'm1', fake), /불러오지 못했습니다/);
});

test('응답이 잘못되면 소장 상태를 임의로 만들지 않는다', async () => {
  const fake: typeof fetch = async () => new Response(JSON.stringify({ merchantId: 'm1', campaignId: 'c1', name: '방문', goals: [
    { visitCount: '1', gradeId: 'gold', gradeName: '골드', shape: 'star', theme: '', thumbnailDataUrl: null },
  ] }), { status: 200 });
  await assert.rejects(fetchCollectiblePreview('https://api.example', 'm1', fake), /응답 형식/);
});

test('미리보기 그림은 인라인 이미지로 검증하고 외부 주소는 거부한다', async () => {
  for (const thumbnailDataUrl of ['https://outside.example/photo.png', 'data:text/html;base64,aA==', 'data:image/png;base64,' + 'a'.repeat(350_000)]) {
    const fake: typeof fetch = async () => new Response(JSON.stringify({ merchantId: 'm1', campaignId: 'c1', name: '방문', goals: [
      { visitCount: 1, gradeId: 'bronze', gradeName: '브론즈', shape: 'circle', theme: '', thumbnailDataUrl },
    ] }));
    await assert.rejects(fetchCollectiblePreview('https://api.example', 'm1', fake), /응답 형식/);
  }
});
