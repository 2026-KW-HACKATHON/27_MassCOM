import test from 'node:test';
import assert from 'node:assert/strict';
import { editableDraft, normalizeMp3DataUrl } from '../../apps/production-web/assets/collectible-editor.mjs';

test('게시 후 다시 저장은 불변 게시 프로젝트를 쓰지 않고 새 초안에 버전을 이어 간다', async () => {
  const published = { id: 'immutable/source', status: 'PUBLISHED', version: 7, project: { name: '획득 당시 이름' } };
  const original = structuredClone(published);
  const draft = { id: 'next-draft', status: 'DRAFT', version: 1, project: structuredClone(published.project) };
  let copies = 0;
  const request = async (path, options) => {
    assert.equal(path, '/projects/immutable%2Fsource/copy');
    assert.equal(options.method, 'POST');
    assert.deepEqual(options.body, { expectedVersion: 7 });
    copies += 1;
    return draft;
  };
  const editable = await editableDraft(request, '/projects', published);
  editable.project.name = '수정 이름';
  assert.equal(editable.id, 'next-draft');
  assert.deepEqual(published, original);
  assert.equal(await editableDraft(request, '/projects', editable), editable);
  assert.equal(await editableDraft(request, '/projects', null), null);
  assert.equal(copies, 1);
});

test('복사 충돌은 기존 게시 버전과 편집 내용을 덮어쓰지 않고 전파한다', async () => {
  const published = { id: 'published', status: 'PUBLISHED', version: 9 };
  await assert.rejects(editableDraft(async () => { throw new Error('COLLECTIBLE_VERSION_CONFLICT'); }, '/projects', published), /COLLECTIBLE_VERSION_CONFLICT/);
  assert.equal(published.version, 9);
});

test('MP3의 파일 MIME 별칭과 빈 타입을 동일한 서버 재생 계약으로 정규화한다', () => {
  for (const mime of ['audio/mpeg', 'audio/mp3', 'application/octet-stream', '']) {
    const result = normalizeMp3DataUrl(`data:${mime};base64,//tQAAA=`);
    assert.equal(result, 'data:audio/mpeg;base64,//tQAAA=');
  }
});
