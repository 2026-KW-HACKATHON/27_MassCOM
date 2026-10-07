import assert from 'node:assert/strict';
import { test } from 'node:test';
import { parsePeriods, parseExceptions, profileFromForm, errorMessage, renderRealWorldPreview, mountRealWorldMerchant, request } from '../../apps/production-web/assets/real-world-merchant.mjs';

const value = input => ({ value: input, checked: false });
function form(overrides = {}) {
  const elements = Object.fromEntries([
    'latitude', 'longitude', 'entranceLatitude', 'entranceLongitude', 'floor', 'unit', 'entranceNote',
    'verificationNote', 'exceptions', 'overrideState', 'overrideStartsAt', 'overrideExpiresAt',
    'overrideNote', 'visitInstructions', 'phone', 'website',
    ...Array.from({ length: 7 }, (_, i) => `weekday${i + 1}`),
  ].map(name => [name, value('')]));
  elements.locationConfirmed = { checked: false };
  elements.scheduleConfirmed = { checked: false };
  for (const [name, input] of Object.entries(overrides)) elements[name] = typeof input === 'boolean' ? { checked: input } : value(input);
  return { elements, querySelectorAll: () => [] };
}
const empty = { location: null, schedule: null, todayOverride: null, menuItems: [], visitInstructions: '', contact: { phone: null, website: null } };

test('weekly periods preserve breaks, overnight hours and last order; reject overlap and out-of-range order', () => {
  assert.deepEqual(parsePeriods('09:00-14:00/13:30,17:00-02:00+1/01:30+1'), [
    { startMinute: 540, endMinute: 840, lastOrderMinute: 810 },
    { startMinute: 1020, endMinute: 1560, lastOrderMinute: 1530 },
  ]);
  assert.throws(() => parsePeriods('09:00-14:00,13:00-18:00'), /겹치거나/);
  assert.throws(() => parsePeriods('09:00-18:00/19:00'), /마지막 주문/);
  assert.throws(() => parsePeriods('23:00-01:00'), /마지막 주문/);
});

test('specific day replaces all periods and rejects duplicate or invalid calendar dates', () => {
  assert.deepEqual(parseExceptions('2026-10-09 | | 휴무'), [{ date: '2026-10-09', periods: [], note: '휴무' }]);
  assert.throws(() => parseExceptions('2026-02-30 | | 휴무'), /날짜/);
  assert.throws(() => parseExceptions('2026-10-09 | | 휴무\n2026-10-09 | 09:00-10:00 | 재영업'), /한 번/);
});

test('manual owner location requires independent evidence and keeps existing verification unchanged', () => {
  const now = new Date('2026-10-06T03:00:00.000Z');
  const inputs = { latitude: '37.65', longitude: '127.06', verificationNote: '점주가 현장 확인' };
  assert.throws(() => profileFromForm(form(inputs), empty, now), /독립적으로/);
  const confirmed = profileFromForm(form({ ...inputs, locationConfirmed: true }), empty, now);
  assert.deepEqual(confirmed.location.building, { latitude: 37.65, longitude: 127.06 });
  assert.equal(confirmed.location.source, 'OWNER_DECLARED');
  assert.equal(confirmed.location.verifiedAt, now.toISOString());
  const documented = profileFromForm(form({ ...inputs, locationConfirmed: true }), empty, now, 'ADMIN_DOCUMENTED');
  assert.equal(documented.location.source, 'ADMIN_DOCUMENTED');
  const unchanged = profileFromForm(form(inputs), { ...empty, location: confirmed.location }, new Date('2026-10-07T00:00:00Z'));
  assert.equal(unchanged.location.verifiedAt, now.toISOString());
  assert.equal(unchanged.location.source, 'OWNER_DECLARED');
});

test('schedule confirmation, temporary closure and 409/403 feedback are explicit', () => {
  assert.throws(() => profileFromForm(form({ weekday1: '09:00-18:00' }), empty), /영업시간을 확인/);
  const profile = profileFromForm(form({ weekday1: '09:00-18:00', scheduleConfirmed: true,
    overrideState: 'CLOSED', overrideStartsAt: '2026-10-06T12:00', overrideExpiresAt: '2026-10-06T14:00', overrideNote: '임시 휴무' }), empty);
  assert.equal(profile.schedule.timezone, 'Asia/Seoul');
  assert.equal(profile.schedule.weekly.length, 7);
  assert.equal(profile.todayOverride.state, 'CLOSED');
  assert.equal(profile.todayOverride.startsAt, '2026-10-06T03:00:00.000Z');
  assert.match(errorMessage({ status: 409 }), /저장하지 않은 내용/);
  assert.match(errorMessage({ status: 403 }), /역할/);
  assert.match(errorMessage({ code: 'MAP_NOT_CONFIGURED' }), /지도 검색 키/);
});

test('JSONB key and weekday order do not require hours confirmation for an unrelated edit', () => {
  const inputs = { weekday1: '09:00-18:00/17:30', exceptions: '2026-10-09 | | 휴무' };
  const verifiedAt = '2026-10-06T03:00:00.000Z';
  const original = profileFromForm(form({ ...inputs, scheduleConfirmed: true }), empty, new Date(verifiedAt));
  const stored = { ...original, schedule: { ...original.schedule,
    weekly: original.schedule.weekly.map(({ weekday, periods }) => ({ periods: periods.map(p => ({
      endMinute: p.endMinute, lastOrderMinute: p.lastOrderMinute, startMinute: p.startMinute,
    })), weekday })).reverse(),
  } };
  const updated = profileFromForm(form({ ...inputs, visitInstructions: '안내만 변경' }), stored, new Date('2026-10-07T03:00:00Z'));
  assert.equal(updated.schedule.verifiedAt, verifiedAt);
  assert.equal(updated.visitInstructions, '안내만 변경');
  assert.throws(() => profileFromForm(form({ ...inputs, weekday1: '09:00-19:00' }), stored), /영업시간을 확인/);
});

test('unpublished owner preview renders private draft fields and photo without public lookup or publishing', () => {
  class Node {
    constructor(tag) { this.tag = tag; this.children = []; this.text = ''; }
    set textContent(value) { this.text = value; this.children = []; }
    get textContent() { return this.text + this.children.map(child => child.textContent).join(''); }
    append(...children) { this.children.push(...children); }
    replaceChildren(...children) { this.text = ''; this.children = children; }
  }
  const doc = { createElement: tag => new Node(tag), createTextNode: text => ({ textContent: text }) };
  const target = new Node('div');
  const draft = {
    name: '검증용 가상 같은상호', roadAddress: '서울 검증용 가상건물 1',
    location: { floor: '2층', unit: '201호', entranceNote: '후문 계단', source: 'OWNER_MEASURED',
      verificationNote: '비공개 위치 검증 기록' },
    business: { state: 'BREAK', acceptingOrders: false, lastOrderAt: null },
    todayOverride: { state: 'CLOSED', note: '오늘 임시 휴무' },
    schedule: { weekly: [{ weekday: 1, periods: [
      { startMinute: 540, endMinute: 840, lastOrderMinute: 810 },
      { startMinute: 1020, endMinute: 1560, lastOrderMinute: 1530 },
    ] }], exceptions: [{ date: '2026-10-09', periods: [], note: '한글날 휴무' }] },
    campaign: { title: '검증용 가상 캠페인', state: 'PAUSED' },
    menuItems: [{ name: '검증용 가상 메뉴', priceWon: 5000, priceNote: null }],
    visitInstructions: '후문으로 들어오세요.',
    photos: [{ id: 'photo-1', caption: '<script>사진</script>' }],
  };
  renderRealWorldPreview(doc, target, draft, 'merchant', 'unpublished-owner');
  const text = target.textContent;
  for (const expected of ['검증용 가상 같은상호', '서울 검증용 가상건물 1', '2층', '후문 계단',
    '쉬는 시간', '오늘 임시 휴무', '09:00~14:00 (마지막 주문 13:30)', '17:00~02:00+1 (마지막 주문 01:30+1)',
    '한글날 휴무', '일시 중지', '5,000원', '후문으로 들어오세요.']) assert.ok(text.includes(expected), expected);
  assert.equal(text.includes('비공개 위치 검증 기록'), false);
  const figure = target.children.find(child => child.tag === 'figure');
  const image = figure.children.find(child => child.tag === 'img');
  assert.equal(image.src, '/api/web/v1/merchant/merchants/unpublished-owner/photos/photo-1/image');
  assert.equal(image.alt, '<script>사진</script>');
  assert.equal(figure.children.find(child => child.tag === 'figcaption').textContent, '<script>사진</script>');
});

function merchantScreen(fetcher, initial) {
  class Element {
    constructor(tag = 'div') { this.tag = tag; this.children = []; this.listeners = {}; this.dataset = {}; this._value = ''; this.hidden = false; this.text = ''; }
    set textContent(text) { this.text = String(text); this.children = []; }
    get textContent() { return this.text + this.children.map(child => child.textContent).join(''); }
    set value(value) { this._value = String(value); }
    get value() { return this._value; }
    append(...children) { for (const child of children) { child.parent = this; this.children.push(child); } if (this.tag === 'select' && this.children.length === children.length) this._value = this.children[0]?.value ?? ''; }
    replaceChildren(...children) { this.children = []; this.text = ''; this._value = this.tag === 'select' ? '' : this._value; this.append(...children); }
    remove() { this.parent.children = this.parent.children.filter(child => child !== this); }
    addEventListener(name, listener) { this.listeners[name] = listener; }
    dispatch(name) { return this.listeners[name]?.({ preventDefault() {}, currentTarget: this }); }
    setAttribute() {}
    querySelector(selector) {
      const name = /^\[name="(.*)"\]$/.exec(selector)?.[1];
      const visit = node => node.name === name ? node : node.children.map(visit).find(Boolean);
      return visit(this);
    }
  }
  const nodes = new Map();
  const doc = {
    createElement: tag => new Element(tag),
    getElementById: id => { if (!nodes.has(id)) nodes.set(id, new Element(id === 'real-world-store' ? 'select' : 'div')); return nodes.get(id); },
    querySelectorAll: selector => selector === '#real-world-menu-rows [data-real-menu]'
      ? doc.getElementById('real-world-menu-rows').children : [],
  };
  const profileForm = doc.getElementById('real-world-form');
  profileForm.elements = form().elements;
  profileForm.querySelectorAll = () => doc.getElementById('real-world-menu-rows').children;
  const photoForm = doc.getElementById('real-world-photo-form');
  const photoInput = { files: [], _value: '' };
  Object.defineProperty(photoInput, 'value', {
    get() { return this._value; },
    set(value) { this._value = value; if (value === '') this.files = []; },
  });
  photoForm.elements = { photo: photoInput, kind: value('MENU'), caption: value(''), rightsConfirmed: { checked: true } };
  photoForm.reset = () => {};
  const cleanup = mountRealWorldMerchant(fetcher, doc, [{ id: initial.merchantId, name: '가게', role: 'OWNER' }]);
  return { doc, nodes, profileForm, photoForm, cleanup };
}

const merchantView = () => ({ merchantId: 'store-1', version: 1, profile: {
  ...empty, menuItems: [{ id: 'menu-a', name: 'A', priceWon: 1000, priceNote: null, photoId: 'photo-a' },
    { id: 'menu-b', name: 'B', priceWon: 2000, priceNote: null, photoId: 'photo-b' }],
}, photos: [{ id: 'photo-a', kind: 'MENU' }, { id: 'photo-b', kind: 'MENU' }], readiness: [], preview: null });
const settle = async () => { for (let i = 0; i < 12; i++) await Promise.resolve(); };

test('menu removal and addition preserve photo choices by menu ID', async () => {
  const initial = merchantView(); let saved;
  const fetcher = async (path, options) => ({ ok: true, json: async () => {
    if (options.method === 'PUT') { saved = JSON.parse(options.body); return initial; }
    return path.endsWith('/discovery-engagement') ? { counts: {} } : initial;
  } });
  const { doc, profileForm, cleanup } = merchantScreen(fetcher, initial);
  await settle();
  const rows = doc.getElementById('real-world-menu-rows');
  rows.children[0].children.at(-1).dispatch('click');
  doc.getElementById('real-world-add-menu').dispatch('click');
  assert.equal(rows.children[0].querySelector('[name="menuPhoto"]').value, 'photo-b');
  rows.children[1].querySelector('[name="menuName"]').value = 'C';
  rows.children[1].querySelector('[name="menuPhoto"]').value = 'photo-a';
  const newMenuId = rows.children[1].dataset.id;
  await profileForm.dispatch('submit');
  assert.deepEqual(saved.profile.menuItems.map(item => [item.id, item.photoId]),
    [['menu-b', 'photo-b'], [newMenuId, 'photo-a']]);
  cleanup();
});

test('photo deletion preserves unsaved profile draft and confirmation', async () => {
  const initial = merchantView(); const next = { ...initial, version: 2, photos: initial.photos.slice(1) };
  let deletes = 0;
  const fetcher = async (path, options) => ({ ok: true, json: async () =>
    options.method === 'DELETE' ? (deletes++, next) : path.endsWith('/discovery-engagement') ? { counts: {} } : initial });
  const previousConfirm = globalThis.confirm; globalThis.confirm = () => true;
  try {
    const { doc, profileForm, cleanup } = merchantScreen(fetcher, initial);
    await settle();
    assert.equal(profileForm.hidden, false);
    profileForm.elements.visitInstructions.value = '저장 전 방문 안내';
    profileForm.elements.weekday1.value = '09:00-18:00';
    profileForm.elements.scheduleConfirmed.checked = true;
    const menuName = doc.getElementById('real-world-menu-rows').children[0].querySelector('[name="menuName"]');
    menuName.value = '수정 중인 메뉴';
    const deleteButton = doc.getElementById('real-world-photos').children[0].children.at(-1);
    deleteButton.dispatch('click'); await settle();
    assert.equal(deletes, 1);
    assert.equal(profileForm.elements.visitInstructions.value, '저장 전 방문 안내');
    assert.equal(profileForm.elements.weekday1.value, '09:00-18:00');
    assert.equal(profileForm.elements.scheduleConfirmed.checked, true);
    assert.equal(menuName.value, '수정 중인 메뉴');
    cleanup();
  } finally { globalThis.confirm = previousConfirm; }
});

test('photo upload preserves unsaved profile draft and confirmation', async () => {
  const initial = merchantView(); const next = { ...initial, version: 2, photos: [...initial.photos, { id: 'photo-c', kind: 'MENU' }] };
  const fetcher = async (path, options) => ({ ok: true, json: async () =>
    options.method === 'POST' ? next : path.endsWith('/discovery-engagement') ? { counts: {} } : initial });
  const previousReader = globalThis.FileReader;
  globalThis.FileReader = class { readAsDataURL() { this.result = 'data:image/png;base64,AA=='; this.onload(); } };
  try {
    const { doc, profileForm, photoForm, cleanup } = merchantScreen(fetcher, initial);
    await settle();
    profileForm.elements.visitInstructions.value = '저장 전 방문 안내';
    profileForm.elements.weekday1.value = '09:00-18:00';
    profileForm.elements.scheduleConfirmed.checked = true;
    const menuName = doc.getElementById('real-world-menu-rows').children[0].querySelector('[name="menuName"]');
    menuName.value = '수정 중인 메뉴';
    photoForm.elements.photo.files = [{ type: 'image/png' }];
    await photoForm.dispatch('submit');
    assert.equal(profileForm.elements.visitInstructions.value, '저장 전 방문 안내');
    assert.equal(profileForm.elements.weekday1.value, '09:00-18:00');
    assert.equal(profileForm.elements.scheduleConfirmed.checked, true);
    assert.equal(menuName.value, '수정 중인 메뉴');
    cleanup();
  } finally { globalThis.FileReader = previousReader; }
});

test('request timeout includes the response body and aborts the fetch', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  let signal;
  const pending = request(async (_, options) => {
    signal = options.signal;
    return { ok: true, json: () => new Promise(() => {}) };
  }, '/profile', 'PUT', {}, 100);
  await settle(); t.mock.timers.tick(100);
  await assert.rejects(pending, /시간이 초과/);
  assert.equal(signal.aborted, true);
});

test('저장 결과 미확정 뒤 다른 편집자의 전화번호 변경은 초안을 유지하고 다시 불러오기 전 재저장을 막는다', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const initial = merchantView(), current = { ...initial, version: 2, profile: {
    ...initial.profile, visitInstructions: '저장 전 안내', contact: { phone: '02-999-9999', website: null },
  } };
  let reads = 0; const writes = [];
  const fetcher = async (path, options) => {
    if (path.endsWith('/discovery-engagement')) return { ok: true, json: async () => ({ counts: {} }) };
    if (options.method === 'PUT') {
      writes.push(JSON.parse(options.body));
      return writes.length === 1 ? { ok: true, json: () => new Promise(() => {}) }
        : { ok: true, json: async () => ({ ...current, version: 3 }) };
    }
    reads++;
    return { ok: true, json: async () => reads === 1 ? initial : current };
  };
  const { doc, profileForm, cleanup } = merchantScreen(fetcher, initial);
  await settle();
  profileForm.elements.visitInstructions.value = '저장 전 안내';
  const firstSave = profileForm.dispatch('submit');
  await settle(); t.mock.timers.tick(10_000); await firstSave;
  assert.equal(reads, 2);
  assert.equal(profileForm.elements.visitInstructions.value, '저장 전 안내');
  await profileForm.dispatch('submit');
  assert.equal(writes.length, 1, '서버 버전만 갱신한 채 이전 전화번호를 다시 보내면 안 된다');
  assert.match(doc.getElementById('real-world-status').textContent, /충돌/);
  assert.match(doc.getElementById('real-world-status').textContent, /초안.*남아/);
  assert.match(doc.getElementById('real-world-status').textContent, /다시 불러오기/);
  await doc.getElementById('real-world-refresh').dispatch('click');
  assert.equal(profileForm.elements.phone.value, '02-999-9999');
  await profileForm.dispatch('submit');
  assert.equal(writes.length, 2);
  assert.equal(writes[1].expectedVersion, 2);
  assert.equal(writes[1].profile.contact.phone, '02-999-9999');
  cleanup();
});

test('재조회한 프로필이 보낸 값과 같으면 JSONB 키 순서와 무관하게 저장 성공으로 확인하고 추가 초안도 유지한다', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const initial = merchantView(); let current = initial, reads = 0;
  const writes = [];
  const fetcher = async (path, options) => {
    if (path.endsWith('/discovery-engagement')) return { ok: true, json: async () => ({ counts: {} }) };
    if (options.method === 'PUT') {
      const sent = JSON.parse(options.body); writes.push(sent);
      // JSONB의 객체 키 순서는 요청과 달라도 값은 그대로다.
      const reorder = value => Array.isArray(value) ? value.map(reorder)
        : value && typeof value === 'object' ? Object.fromEntries(Object.entries(value).reverse().map(([k, v]) => [k, reorder(v)])) : value;
      current = { ...initial, version: writes.length + 1, profile: reorder(sent.profile) };
      return writes.length === 1 ? { ok: true, json: () => new Promise(() => {}) }
        : { ok: true, json: async () => current };
    }
    reads++; return { ok: true, json: async () => current };
  };
  const { doc, profileForm, cleanup } = merchantScreen(fetcher, initial);
  await settle();
  profileForm.elements.visitInstructions.value = '전송한 안내';
  profileForm.elements.weekday1.value = '09:00-18:00';
  profileForm.elements.scheduleConfirmed.checked = true;
  const firstSave = profileForm.dispatch('submit');
  await settle();
  profileForm.elements.visitInstructions.value = '응답 대기 중 추가 초안';
  t.mock.timers.tick(10_000); await firstSave;
  assert.equal(reads, 2);
  assert.match(doc.getElementById('real-world-status').textContent, /저장.*확인/);
  assert.doesNotMatch(doc.getElementById('real-world-status').textContent, /불확실|충돌/);
  assert.equal(profileForm.elements.visitInstructions.value, '응답 대기 중 추가 초안');
  await profileForm.dispatch('submit');
  assert.equal(writes.length, 2);
  assert.equal(writes[1].expectedVersion, 2);
  assert.equal(writes[1].profile.visitInstructions, '응답 대기 중 추가 초안');
  cleanup();
});

for (const failure of ['timeout', '500']) {
  test(`사진 등록 결과 미확정(${failure}) 뒤 목록을 재조회하고 같은 선택 파일을 다시 전송하지 않는다`, async t => {
    t.mock.timers.enable({ apis: ['setTimeout'] });
    const initial = merchantView(); let current = initial, reads = 0, uploads = 0;
    const fetcher = async (path, options) => {
      if (path.endsWith('/discovery-engagement')) return { ok: true, json: async () => ({ counts: {} }) };
      if (options.method === 'POST') {
        uploads++;
        current = { ...initial, version: uploads + 1, photos: [...initial.photos, { id: 'photo-c', kind: 'MENU' }] };
        if (uploads > 1) return { ok: true, json: async () => current };
        return failure === 'timeout' ? { ok: true, json: () => new Promise(() => {}) }
          : { ok: false, status: 500, json: async () => ({ code: 'INTERNAL_ERROR' }) };
      }
      reads++; return { ok: true, json: async () => current };
    };
    const previousReader = globalThis.FileReader;
    t.after(() => { globalThis.FileReader = previousReader; });
    globalThis.FileReader = class {
      readAsDataURL() { this.result = 'data:image/png;base64,AA=='; this.onload(); }
    };
    const { doc, profileForm, photoForm, cleanup } = merchantScreen(fetcher, initial);
    await settle();
    profileForm.elements.visitInstructions.value = '저장 전 방문 안내';
    photoForm.elements.photo.files = [{ type: 'image/png', name: 'menu.png' }];
    const upload = photoForm.dispatch('submit');
    await settle();
    if (failure === 'timeout') t.mock.timers.tick(10_000);
    await upload;
    assert.equal(reads, 2);
    assert.equal(doc.getElementById('real-world-photos').children.length, 3);
    const recoveryMessage = doc.getElementById('real-world-status').textContent;
    assert.equal(profileForm.elements.visitInstructions.value, '저장 전 방문 안내');
    const retry = photoForm.dispatch('submit');
    await settle(); t.mock.timers.tick(10_000); await retry;
    assert.equal(uploads, 1, '결과 미확정인 같은 선택 파일을 중복 등록하지 않는다');
    assert.equal(photoForm.elements.photo.files.length, 0);
    assert.match(recoveryMessage, /사진/);
    assert.match(recoveryMessage, /목록.*확인/);
    photoForm.elements.photo.files = [{ type: 'image/png', name: 'other.png' }];
    await photoForm.dispatch('submit');
    assert.equal(uploads, 2, '목록 확인 후 새로 선택한 사진은 등록할 수 있다');
    cleanup();
  });
}

test('사진 등록 뒤 재조회도 실패하면 선택 파일을 비우고 명시적 다시 불러오기까지 쓰기를 막는다', async t => {
  const initial = merchantView(); let reads = 0, uploads = 0;
  const fetcher = async (path, options) => {
    if (path.endsWith('/discovery-engagement')) return { ok: true, json: async () => ({ counts: {} }) };
    if (options.method === 'POST') { uploads++; throw new TypeError('응답 유실'); }
    if (++reads === 2) throw new TypeError('재조회 연결 실패');
    return { ok: true, json: async () => initial };
  };
  const previousReader = globalThis.FileReader;
  t.after(() => { globalThis.FileReader = previousReader; });
  globalThis.FileReader = class { readAsDataURL() { this.result = 'data:image/png;base64,AA=='; this.onload(); } };
  const { doc, profileForm, photoForm, cleanup } = merchantScreen(fetcher, initial);
  await settle();
  profileForm.elements.visitInstructions.value = '유지할 초안';
  photoForm.elements.photo.files = [{ type: 'image/png' }];
  await photoForm.dispatch('submit');
  assert.equal(reads, 2);
  assert.equal(photoForm.elements.photo.files.length, 0);
  assert.equal(profileForm.elements.visitInstructions.value, '유지할 초안');
  assert.match(doc.getElementById('real-world-status').textContent, /정보 다시 불러오기/);
  await photoForm.dispatch('submit');
  assert.equal(uploads, 1);
  await doc.getElementById('real-world-refresh').dispatch('click');
  await photoForm.dispatch('submit');
  assert.equal(uploads, 1, '재조회 성공 뒤에도 이전 선택 파일을 재전송하지 않는다');
  cleanup();
});

test('failed version refresh prevents another save with stale version', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const initial = merchantView(); let reads = 0, writes = 0;
  const fetcher = async (path, options) => {
    if (path.endsWith('/discovery-engagement')) return { ok: true, json: async () => ({ counts: {} }) };
    if (options.method === 'PUT') { writes++; return new Promise(() => {}); }
    reads++;
    if (reads === 1) return { ok: true, json: async () => initial };
    throw new Error('network down');
  };
  const { doc, profileForm, cleanup } = merchantScreen(fetcher, initial);
  await settle();
  const firstSave = profileForm.dispatch('submit');
  await settle(); t.mock.timers.tick(10_000); await firstSave;
  await profileForm.dispatch('submit');
  assert.equal(writes, 1);
  assert.match(doc.getElementById('real-world-status').textContent, /정보 다시 불러오기/);
  cleanup();
});
