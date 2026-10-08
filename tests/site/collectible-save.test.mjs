import test from 'node:test';
import assert from 'node:assert/strict';
import { editableDraft, normalizeMp3DataUrl, validatePublish } from '../../apps/production-web/assets/collectible-editor.mjs';
import { createProject } from '../../apps/production-web/assets/collectible-model.mjs';

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


test('게시 검증은 자동 방문 보상 매핑과 정확한 1·3·5회 활성 캠페인을 요구한다', () => {
  const validCampaign = { id: 'campaign-a', status: 'ACTIVE', goals: [1, 3, 5] };
  const project = createProject({ name: '월계 식당 방문 수집품', campaignId: 'campaign-a' });
  project.photo.originalDataUrl = 'data:image/png;base64,AAAA';
  project.rewardGrades = { 1: 'bronze', 3: 'silver', 5: 'gold' };
  assert.equal(validatePublish(project, [validCampaign]), '');

  assert.match(validatePublish({ ...project, campaignId: '' }, [validCampaign]), /게시할 캠페인을 하나로 정할 수 없어요/);
  assert.match(validatePublish(project, [{ ...validCampaign, goals: [1, 3] }]), /게시할 캠페인을 하나로 정할 수 없어요/);
  assert.match(validatePublish({ ...project, rewardGrades: { 1: 'silver', 3: 'gold', 5: 'bronze' } }, [validCampaign]), /1회 브론즈·3회 실버·5회 골드/);
  assert.match(validatePublish({ ...project, grades: project.grades.map(grade => grade.id === 'bronze' ? { ...grade, enabled: false } : grade) }, [validCampaign]), /1회 브론즈·3회 실버·5회 골드/);
  assert.match(validatePublish({ ...project, grades: project.grades.filter(grade => grade.id !== 'prism') }, [validCampaign]), /브론즈·실버·골드·프리즘 네 기본 등급/);
  assert.match(validatePublish({ ...project, grades: project.grades.map(grade => grade.id === 'prism' ? { ...grade, enabled: false } : grade) }, [validCampaign]), /브론즈·실버·골드·프리즘 네 기본 등급/);
});

test('16등급 기존 초안은 저장할 수 있지만 기본 등급을 넣을 자리가 없으면 게시를 안내한다', () => {
  const campaign = { id: 'campaign-a', status: 'ACTIVE', goals: [1, 3, 5] };
  const project = createProject({ campaignId: campaign.id });
  project.photo.originalDataUrl = 'data:image/png;base64,AAAA';
  project.grades = [...project.grades.filter(grade => grade.id !== 'prism'), ...Array.from({ length: 13 }, (_, i) => ({ id: `extra-${i}`, name: `추가 ${i}`, kind: 'special', enabled: true }))];
  assert.equal(project.grades.length, 16);
  assert.equal(validatePublish(project, [campaign]), '기본 4등급을 위해 추가 등급을 하나 줄여 주세요');
});
