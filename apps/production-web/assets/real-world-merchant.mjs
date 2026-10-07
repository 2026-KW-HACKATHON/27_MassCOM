const base = (id, channel) => `/api/web/v1/${channel}/merchants/${encodeURIComponent(id)}`;
const weekdays = ['월', '화', '수', '목', '금', '토', '일'];
const mounted = new WeakMap();
const fields = form => form.elements;
const optional = value => value.trim() || null;
// JSONB는 객체 키 순서를 보존하지 않으므로 값 비교에만 정렬을 사용한다.
const profileKey = profile => JSON.stringify(profile, (_, value) => value && typeof value === 'object' && !Array.isArray(value)
  ? Object.fromEntries(Object.keys(value).sort().map(key => [key, value[key]])) : value);

/** @param {unknown} [body] */
export async function request(fetcher, path, method = 'GET', body, timeoutMs = 10_000) {
  const controller = new AbortController();
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => {
      controller.abort();
      reject(Object.assign(new Error('요청 시간이 초과되었습니다. 다시 시도해 주세요.'), { code: 'REQUEST_TIMEOUT' }));
    }, timeoutMs);
  });
  try {
    return await Promise.race([(async () => {
      const response = await fetcher(path, {
        method, credentials: 'same-origin', cache: 'no-store', signal: controller.signal,
        headers: body === undefined ? { Accept: 'application/json' } : { Accept: 'application/json', 'Content-Type': 'application/json' },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      });
      if (!response.ok) {
        const error = Object.assign(new Error('request failed'), { status: response.status, code: '' });
        try { error.code = (await response.json()).code; } catch { /* status is enough */ }
        throw error;
      }
      return response.json();
    })(), timeout]);
  } finally { clearTimeout(timer); }
}

/** @returns {never} */
function invalid(message) { throw new Error(message); }
function minute(text, end = false) {
  const match = /^(\d{2}):(\d{2})(\+1)?$/.exec(text.trim());
  if (!match || Number(match[1]) > (end && !match[3] ? 24 : 23) || Number(match[2]) > 59 ||
      (Number(match[1]) === 24 && Number(match[2]) !== 0)) invalid('시간은 HH:MM 또는 다음 날 HH:MM+1로 적어 주세요.');
  return Number(match[1]) * 60 + Number(match[2]) + (match[3] ? 1440 : 0);
}

export function parsePeriods(text) {
  if (!text.trim()) return [];
  const periods = text.split(',').map(part => {
    const match = /^(.*?)\s*-\s*(.*?)(?:\s*\/\s*(.*))?$/.exec(part.trim());
    if (!match) invalid('영업 구간은 09:00-18:00 형식으로 적어 주세요.');
    const startMinute = minute(match[1]);
    const endMinute = minute(match[2], true);
    const lastOrderMinute = match[3] ? minute(match[3], true) : null;
    if (startMinute >= endMinute || endMinute - startMinute > 1440 || endMinute > 2880 ||
        lastOrderMinute !== null && (lastOrderMinute < startMinute || lastOrderMinute > endMinute)) {
      invalid('영업 시작·종료·마지막 주문 시간을 확인해 주세요.');
    }
    return { startMinute, endMinute, lastOrderMinute };
  }).sort((a, b) => a.startMinute - b.startMinute);
  if (periods.length > 12 || periods.some((item, i) => i && item.startMinute < periods[i - 1].endMinute)) {
    invalid('같은 날의 영업 구간이 겹치거나 12개를 넘습니다.');
  }
  return periods;
}

function formatMinute(value) {
  const next = value >= 1440;
  const minuteOfDay = value - (next ? 1440 : 0);
  return `${String(Math.floor(minuteOfDay / 60)).padStart(2, '0')}:${String(minuteOfDay % 60).padStart(2, '0')}${next ? '+1' : ''}`;
}
const formatPeriods = periods => periods.map(item => `${formatMinute(item.startMinute)}-${formatMinute(item.endMinute)}${item.lastOrderMinute === null ? '' : `/${formatMinute(item.lastOrderMinute)}`}`).join(',');

export function parseExceptions(text) {
  if (!text.trim()) return [];
  const dates = new Set();
  const exceptions = text.split(/\r?\n/).filter(line => line.trim()).map(line => {
    const parts = line.split('|');
    if (parts.length !== 3) invalid('특정일은 날짜 | 영업 구간 | 안내 형식으로 적어 주세요.');
    const date = parts[0].trim();
    const parsed = Date.parse(`${date}T00:00:00Z`);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !Number.isFinite(parsed) ||
        new Date(parsed).toISOString().slice(0, 10) !== date || dates.has(date)) {
      invalid('특정일의 날짜를 확인해 주세요. 같은 날짜는 한 번만 적습니다.');
    }
    dates.add(date);
    const note = optional(parts[2]);
    if (note && note.length > 300) invalid('특정일 안내는 300자 이하로 적어 주세요.');
    return { date, periods: parsePeriods(parts[1]), note };
  });
  if (exceptions.length > 366) invalid('특정일 변경은 366개까지 저장할 수 있어요.');
  return exceptions;
}

const point = (lat, lon) => ({ latitude: Number(lat), longitude: Number(lon) });
function checkedPoint(lat, lon, label) {
  if (!lat && !lon) return null;
  if (!lat || !lon || !Number.isFinite(Number(lat)) || !Number.isFinite(Number(lon)) ||
      Math.abs(Number(lat)) > 90 || Math.abs(Number(lon)) > 180) invalid(`${label}의 위도와 경도를 확인해 주세요.`);
  return point(lat, lon);
}

function overrideFromForm(input) {
  if (!input.overrideState.value) return null;
  const startsAt = Date.parse(`${input.overrideStartsAt.value}:00+09:00`);
  const expiresAt = Date.parse(`${input.overrideExpiresAt.value}:00+09:00`);
  const note = input.overrideNote.value.trim();
  if (!Number.isFinite(startsAt) || !Number.isFinite(expiresAt) || startsAt >= expiresAt ||
      expiresAt - startsAt > 48 * 3600_000 || !note || note.length > 300) {
    invalid('임시 변경의 시작·종료(최대 48시간)와 안내를 확인해 주세요.');
  }
  return { state: input.overrideState.value, startsAt: new Date(startsAt).toISOString(), expiresAt: new Date(expiresAt).toISOString(), note };
}

export function profileFromForm(form, previous, now = new Date(), source = 'OWNER_DECLARED') {
  const input = fields(form);
  const building = checkedPoint(input.latitude.value, input.longitude.value, '건물');
  const entrance = checkedPoint(input.entranceLatitude.value, input.entranceLongitude.value, '입구');
  if (!building && entrance) invalid('입구를 저장하려면 건물 위치도 적어 주세요.');
  const oldLocation = previous.location;
  const locationNote = input.verificationNote.value.trim();
  const locationChanged = building && (!oldLocation || JSON.stringify({ building, entrance, floor: optional(input.floor.value), unit: optional(input.unit.value), entranceNote: optional(input.entranceNote.value), verificationNote: locationNote }) !==
    JSON.stringify({ building: oldLocation.building, entrance: oldLocation.entrance, floor: oldLocation.floor, unit: oldLocation.unit, entranceNote: oldLocation.entranceNote, verificationNote: oldLocation.verificationNote }));
  if (locationChanged && (!input.locationConfirmed.checked || !locationNote || locationNote.length > 500)) {
    invalid('실제 위치를 독립적으로 확인하고 근거를 적어 주세요.');
  }
  const location = building ? {
    building, entrance, floor: optional(input.floor.value), unit: optional(input.unit.value),
    entranceNote: optional(input.entranceNote.value), source: locationChanged ? source : oldLocation.source,
    verificationNote: locationNote, verifiedAt: locationChanged ? now.toISOString() : oldLocation.verifiedAt,
  } : null;

  const weekly = weekdays.map((_, i) => ({ weekday: i + 1, periods: parsePeriods(input[`weekday${i + 1}`].value) }));
  const exceptions = parseExceptions(input.exceptions.value);
  const scheduleChanged = !previous.schedule || weekly.some(day => formatPeriods(day.periods) !==
    formatPeriods(previous.schedule.weekly.find(old => old.weekday === day.weekday)?.periods ?? [])) ||
    exceptions.length !== previous.schedule.exceptions.length || exceptions.some(day => {
      const old = previous.schedule.exceptions.find(item => item.date === day.date);
      return !old || old.note !== day.note || formatPeriods(old.periods) !== formatPeriods(day.periods);
    });
  const hasSchedule = input.scheduleConfirmed.checked || previous.schedule && !scheduleChanged;
  if (scheduleChanged && !input.scheduleConfirmed.checked && (weekly.some(day => day.periods.length) || exceptions.length)) {
    invalid('점포의 실제 영업시간을 확인해 주세요.');
  }
  const schedule = hasSchedule ? { timezone: 'Asia/Seoul', weekly, exceptions,
    verifiedAt: scheduleChanged ? now.toISOString() : previous.schedule.verifiedAt } : null;

  const menuItems = [...form.querySelectorAll('[data-real-menu]')].map(row => {
    const name = row.querySelector('[name="menuName"]').value.trim();
    const rawPrice = row.querySelector('[name="menuPrice"]').value.trim();
    const priceNote = optional(row.querySelector('[name="menuPriceNote"]').value);
    if (!name && !rawPrice && !priceNote) return null;
    if (!name || name.length > 100 || rawPrice && (!/^\d+$/.test(rawPrice) || !Number.isSafeInteger(Number(rawPrice))) ||
        priceNote && priceNote.length > 120) invalid('메뉴명·가격·가격 안내를 확인해 주세요.');
    return { id: row.dataset.id, name, priceWon: rawPrice ? Number(rawPrice) : null,
      priceNote, photoId: row.querySelector('[name="menuPhoto"]').value || null };
  }).filter(Boolean);
  if (menuItems.length > 100) invalid('메뉴는 100개까지 저장할 수 있어요.');
  const website = optional(input.website.value);
  if (website && !/^https:\/\/[^\s/]+(?:\/[^\s]*)?$/i.test(website)) invalid('공식 웹사이트는 https 주소로 적어 주세요.');
  return { location, schedule, todayOverride: overrideFromForm(input), menuItems,
    visitInstructions: input.visitInstructions.value.trim(),
    contact: { phone: optional(input.phone.value), website } };
}

/** @param {{id?: string, name?: string, priceWon?: number|null, priceNote?: string|null, photoId?: string|null}} [item] */
function menuRow(doc, item = {}) {
  const row = doc.createElement('div'); row.dataset.realMenu = '';
  row.dataset.id = item.id || globalThis.crypto.randomUUID();
  row.className = 'real-world-menu-row';
  for (const [name, label, value, type] of [
    ['menuName', '메뉴명', item.name ?? '', 'text'], ['menuPrice', '가격(원)', item.priceWon ?? '', 'number'],
    ['menuPriceNote', '가격 안내', item.priceNote ?? '', 'text'],
  ]) {
    const holder = doc.createElement('label'); holder.textContent = label;
    const field = doc.createElement('input'); field.name = name; field.type = type; field.value = String(value);
    if (type === 'number') { field.min = '0'; field.step = '1'; }
    holder.append(field); row.append(holder);
  }
  const photo = doc.createElement('label'); photo.textContent = '메뉴 사진';
  const select = doc.createElement('select'); select.name = 'menuPhoto';
  const none = doc.createElement('option'); none.value = ''; none.textContent = '없음'; select.append(none);
  photo.append(select); row.append(photo);
  const remove = doc.createElement('button'); remove.type = 'button'; remove.textContent = '메뉴 삭제';
  remove.addEventListener('click', () => row.remove()); row.append(remove);
  return row;
}

function fill(doc, form, view) {
  const p = view.profile, input = fields(form), loc = p.location, schedule = p.schedule;
  for (const [name, value] of Object.entries({
    latitude: loc?.building.latitude, longitude: loc?.building.longitude,
    entranceLatitude: loc?.entrance?.latitude, entranceLongitude: loc?.entrance?.longitude,
    floor: loc?.floor, unit: loc?.unit, entranceNote: loc?.entranceNote, verificationNote: loc?.verificationNote,
    visitInstructions: p.visitInstructions, phone: p.contact.phone, website: p.contact.website,
  })) input[name].value = value == null ? '' : String(value);
  input.locationConfirmed.checked = false;
  for (let i = 0; i < 7; i++) input[`weekday${i + 1}`].value = formatPeriods(schedule?.weekly.find(day => day.weekday === i + 1)?.periods ?? []);
  input.exceptions.value = (schedule?.exceptions ?? []).map(e => `${e.date} | ${formatPeriods(e.periods)} | ${e.note ?? ''}`).join('\n');
  input.scheduleConfirmed.checked = false;
  input.overrideState.value = p.todayOverride?.state ?? '';
  for (const [name, value] of [['overrideStartsAt', p.todayOverride?.startsAt], ['overrideExpiresAt', p.todayOverride?.expiresAt]]) {
    input[name].value = value ? localDateTime(value) : '';
  }
  input.overrideNote.value = p.todayOverride?.note ?? '';
  const rows = doc.getElementById('real-world-menu-rows'); rows.replaceChildren();
  for (const item of p.menuItems) rows.append(menuRow(doc, item));
  updatePhotoOptions(doc, view.photos, p.menuItems);
}

function localDateTime(value) {
  return new Date(Date.parse(value) + 9 * 3600_000).toISOString().slice(0, 16);
}

function updatePhotoOptions(doc, photos, items) {
  const rows = [...doc.querySelectorAll('#real-world-menu-rows [data-real-menu]')];
  const saved = items && new Map(items.map(item => [item.id, item.photoId]));
  rows.forEach(row => {
    const select = row.querySelector('[name="menuPhoto"]');
    const selected = saved ? saved.get(row.dataset.id) ?? '' : select.value;
    select.replaceChildren();
    const none = doc.createElement('option'); none.value = ''; none.textContent = '없음'; select.append(none);
    for (const photo of photos.filter(photo => photo.kind === 'MENU')) {
      const option = doc.createElement('option'); option.value = photo.id; option.textContent = photo.caption || '메뉴 사진'; select.append(option);
    }
    select.value = photos.some(photo => photo.kind === 'MENU' && photo.id === selected) ? selected : '';
  });
}

function showPhotos(doc, photos, onDelete, channel, merchantId, editable) {
  const list = doc.getElementById('real-world-photos'); list.replaceChildren();
  for (const photo of photos) {
    const li = doc.createElement('li');
    const img = doc.createElement('img');
    img.src = `${base(merchantId, channel)}/photos/${encodeURIComponent(photo.id)}/image`;
    img.alt = photo.caption || '실제 점포 사진';
    img.loading = 'lazy'; img.width = 120; li.append(img);
    const text = doc.createElement('span'); text.textContent = `실제 촬영 사진 · ${photo.kind} · ${photo.caption || '설명 없음'}`; li.append(text);
    if (editable) {
      const remove = doc.createElement('button'); remove.type = 'button'; remove.textContent = '사진 삭제';
      remove.addEventListener('click', () => onDelete(photo.id)); li.append(remove);
    }
    list.append(li);
  }
  if (!photos.length) list.textContent = '등록된 실제 사진이 없습니다.';
}

function showReadiness(doc, readiness) {
  const list = doc.getElementById('real-world-readiness'); list.replaceChildren();
  for (const step of readiness) {
    const item = doc.createElement('li');
    const key = String(step.field);
    const targetId = key.includes('location') || key.includes('entrance') ? 'real-world-location'
      : key.includes('schedule') || key.includes('hours') ? 'real-world-schedule'
      : key.includes('photo') ? 'real-world-photos-title'
      : key.includes('menu') ? 'real-world-menu'
      : key.includes('override') ? 'real-world-override' : 'real-world-form';
    const target = doc.getElementById(targetId);
    if (!step.ready && target) {
      const link = doc.createElement('a'); link.href = `#${target.id}`; link.textContent = `수정: ${step.label}`; item.append(link);
    } else item.textContent = `${step.ready ? '완료' : '확인 필요'} · ${step.label}`;
    list.append(item);
  }
}

export function renderRealWorldPreview(doc, target, merchant, channel, merchantId, photos = merchant.photos) {
  target.replaceChildren();
  const previewPeriods = periods => periods.map(period =>
    `${formatMinute(period.startMinute)}~${formatMinute(period.endMinute)}${period.lastOrderMinute === null ? '' : ` (마지막 주문 ${formatMinute(period.lastOrderMinute)})`}`).join(' / ');
  const line = (label, value) => {
    const row = doc.createElement('p');
    const title = doc.createElement('strong'); title.textContent = `${label} · `;
    row.append(title, doc.createTextNode(String(value))); target.append(row);
  };
  const state = { OPEN: '영업 중', CLOSED: '영업 종료', BREAK: '쉬는 시간', UNKNOWN: '영업 상태 미확인' };
  const campaign = { ACTIVE: '진행 중', PAUSED: '일시 중지', ENDED: '종료', SCHEDULED: '예정' };
  const source = { OWNER_DECLARED: '점주 확인', OWNER_MEASURED: '점주 현장 측정', ADMIN_DOCUMENTED: '관리자 확인' };
  line('점포', merchant.name);
  line('주소', merchant.roadAddress);
  line('위치', merchant.location
    ? [merchant.location.floor, merchant.location.unit, merchant.location.entranceNote].filter(Boolean).join(' · ') || '건물 위치 확인됨'
    : '좌표 미확인');
  if (merchant.location) line('위치 출처', source[merchant.location.source] ?? '확인됨');
  line('현재 영업', `${state[merchant.business.state] ?? state.UNKNOWN}${merchant.business.acceptingOrders === false ? ' · 주문 마감' : ''}`);
  if (merchant.business.lastOrderAt) line('마지막 주문', new Date(merchant.business.lastOrderAt).toLocaleString('ko-KR', { timeZone: 'Asia/Seoul' }));
  if (merchant.todayOverride) line('임시 변경', `${merchant.todayOverride.state === 'OPEN' ? '영업' : '휴무'} · ${merchant.todayOverride.note}`);
  if (merchant.schedule) {
    for (const day of merchant.schedule.weekly) line(`${weekdays[day.weekday - 1]}요일`, previewPeriods(day.periods) || '휴무');
    for (const exception of merchant.schedule.exceptions) line(`${exception.date} 변경`, `${previewPeriods(exception.periods) || '휴무'}${exception.note ? ` · ${exception.note}` : ''}`);
  } else line('영업시간', '확인된 일정 없음');
  line('캠페인', merchant.campaign ? `${merchant.campaign.title} · ${campaign[merchant.campaign.state] ?? merchant.campaign.state}` : '진행 중인 캠페인 없음');
  for (const item of merchant.menuItems) line('메뉴', `${item.name} · ${item.priceWon === null ? item.priceNote || '가격 문의' : `${item.priceWon.toLocaleString('ko-KR')}원`}${item.priceNote && item.priceWon !== null ? ` · ${item.priceNote}` : ''}`);
  if (!merchant.menuItems.length) line('메뉴', '등록된 메뉴 없음');
  line('방문 안내', merchant.visitInstructions || '등록된 방문 안내 없음');
  if (merchant.contact?.phone) line('연락처', merchant.contact.phone);
  if (merchant.contact?.website) line('웹사이트', merchant.contact.website);
  if (photos.length) line('사진 출처', '점주 등록 사진');
  for (const photo of photos) {
    const figure = doc.createElement('figure'), image = doc.createElement('img'), caption = doc.createElement('figcaption');
    image.src = `${base(merchantId, channel)}/photos/${encodeURIComponent(photo.id)}/image`;
    image.alt = photo.caption || '점포 사진'; image.loading = 'lazy'; image.width = 240;
    caption.textContent = photo.caption || '점포 사진'; figure.append(image, caption); target.append(figure);
  }
  if (!photos.length) line('사진', '등록된 사진 없음');
}

export function errorMessage(error) {
  if (error.status === 409) return '다른 변경이 먼저 저장되었습니다. 저장하지 않은 내용이 남아 있습니다. 다시 불러온 뒤 수정해 주세요.';
  if (error.status === 403) return '현재 역할은 실제 점포 정보를 수정할 수 없습니다. 권한을 다시 확인해 주세요.';
  if (error.code === 'MAP_NOT_CONFIGURED') return '지도 검색 키가 설정되지 않았습니다. 독립적으로 확인한 실제 위치는 직접 입력할 수 있습니다.';
  return error.message && error.message !== 'request failed' ? error.message : '처리하지 못했습니다. 다시 시도해 주세요.';
}

function mountRealWorldProfile(fetcher, doc, merchants, channel) {
  const panel = doc.getElementById('real-world-merchant');
  if (!panel) return () => {};
  const existing = mounted.get(panel);
  if (existing) return existing.configure(merchants);
  const select = doc.getElementById('real-world-store'), status = doc.getElementById('real-world-status');
  const form = doc.getElementById('real-world-form');
  const weekly = doc.getElementById('real-world-weekly');
  for (let i = 0; i < 7; i++) {
    const label = doc.createElement('label'); label.textContent = `${weekdays[i]}요일 구간`;
    const input = doc.createElement('input'); input.name = `weekday${i + 1}`;
    input.setAttribute('aria-label', `${weekdays[i]}요일 영업 구간`);
    input.placeholder = '09:00-18:00'; label.append(input); weekly.append(label);
  }
  let view, generation = 0, busy = false, conflict = false, members = merchants;
  const conflictMessage = '서버 값과 초안이 달라 충돌 상태입니다. 저장하지 않은 초안은 폼에 남아 있습니다. 필요한 내용을 복사한 뒤 정보 다시 불러오기로 서버 값을 확인해 주세요. 다시 불러오면 폼이 서버 값으로 바뀝니다.';
  const load = async () => {
    const token = ++generation, id = select.value;
    view = undefined; busy = false; form.hidden = true;
    doc.getElementById('real-world-photo-form').hidden = true;
    doc.getElementById('real-world-candidates-form').hidden = true;
    for (const name of ['real-world-photos', 'real-world-readiness', 'real-world-engagement', 'real-world-candidates-list', 'real-world-reports']) {
      doc.getElementById(name)?.replaceChildren();
    }
    doc.getElementById('real-world-preview').textContent = '';
    status.textContent = '실제 정보를 불러오는 중입니다.';
    try {
      const next = await request(fetcher, `${base(id, channel)}/real-world-profile`);
      if (token !== generation || id !== select.value) return;
      view = next; conflict = false; fill(doc, form, next); showReadiness(doc, next.readiness);
      form.hidden = channel === 'merchant' && members.find(item => item.id === id)?.role !== 'OWNER';
      showPhotos(doc, next.photos, deletePhoto, channel, id, !form.hidden);
      doc.getElementById('real-world-photo-form').hidden = form.hidden;
      doc.getElementById('real-world-candidates-form').hidden = form.hidden;
      status.textContent = form.hidden ? '직원은 실제 정보를 조회할 수 있지만 수정은 점주에게 요청해 주세요.' : '실제 정보를 불러왔습니다.';
      void engagement(id, token);
      if (channel === 'admin') void reports(id, token);
    } catch (error) {
      if (token === generation) { view = undefined; form.hidden = true; status.textContent = errorMessage(error); }
    }
  };
  const saveView = (next, keepDraft = false) => {
    view = next; doc.getElementById('real-world-preview').replaceChildren();
    if (keepDraft) updatePhotoOptions(doc, next.photos); else fill(doc, form, next);
    showReadiness(doc, next.readiness); showPhotos(doc, next.photos, deletePhoto, channel, select.value, !form.hidden);
  };
  const reconcileWrite = async (id, token, error, sentProfile) => {
    if (error.status && error.status < 500) {
      if (error.status === 409) conflict = true;
      status.textContent = conflict ? conflictMessage : errorMessage(error); return;
    }
    const expectedProfile = sentProfile ?? view.profile;
    status.textContent = '저장 결과를 확인하는 중입니다.';
    try {
      const latest = await request(fetcher, `${base(id, channel)}/real-world-profile`);
      if (token !== generation || id !== select.value) return;
      saveView(latest, true);
      conflict = profileKey(expectedProfile) !== profileKey(latest.profile);
      status.textContent = conflict ? conflictMessage : sentProfile
        ? '서버 값이 보낸 값과 같아 실제 정보 저장을 확인했습니다. 폼의 추가 초안은 유지했습니다.'
        : '사진 처리 결과가 불확실합니다. 사진 목록을 다시 불러왔습니다. 목록을 확인한 뒤 필요한 사진만 다시 선택해 주세요. 초안은 유지했습니다.';
    } catch {
      if (token !== generation || id !== select.value) return;
      view = undefined;
      status.textContent = '저장 결과를 확인하지 못했습니다. 정보 다시 불러오기로 서버 상태를 확인해 주세요.';
    }
  };
  const engagement = async (id, token) => {
    const list = doc.getElementById('real-world-engagement'); list.replaceChildren();
    try {
      const result = await request(fetcher, `${base(id, channel)}/discovery-engagement`);
      if (token !== generation) return;
      for (const [label, value] of [['지도 선택', result.counts.mapSelect], ['상세 조회', result.counts.detailView],
        ['길찾기 열기', result.counts.directionsOpen], ['목표 저장', result.counts.goalSave]]) {
        const dt = doc.createElement('dt'); dt.textContent = label;
        const dd = doc.createElement('dd'); dd.textContent = String(value); list.append(dt, dd);
      }
    } catch { if (token === generation) list.textContent = '익명 반응을 불러오지 못했습니다.'; }
  };
  const deletePhoto = async photoId => {
    if (!view || busy || form.hidden) return;
    if (conflict) { status.textContent = conflictMessage; return; }
    if (!globalThis.confirm?.('이 실제 사진을 삭제할까요?')) return;
    const token = generation, id = select.value;
    busy = true; status.textContent = '실제 사진을 삭제하는 중입니다.';
    try {
      const next = await request(fetcher, `${base(id, channel)}/photos/${encodeURIComponent(photoId)}`, 'DELETE', { expectedVersion: view.version });
      if (token !== generation || id !== select.value) return;
      saveView(next, true); status.textContent = '실제 사진을 삭제했습니다.';
    } catch (error) { if (token === generation) await reconcileWrite(id, token, error); }
    finally { if (token === generation) busy = false; }
  };
  const reports = async (id, token) => {
    const panel = doc.getElementById('real-world-admin-reports');
    const status = doc.getElementById('real-world-reports-status');
    const list = doc.getElementById('real-world-reports');
    if (!panel) return;
    panel.hidden = false; list.replaceChildren(); status.textContent = '제보를 불러오는 중입니다.';
    try {
      const result = await request(fetcher, `${base(id, channel)}/reports`);
      if (token !== generation) return;
      for (const report of result.reports) {
        const li = doc.createElement('li');
        const summary = doc.createElement('p');
        summary.textContent = `${report.kind} · ${report.status} · ${report.note}`; li.append(summary);
        if (report.status === 'OPEN') {
          const form = doc.createElement('form');
          const label = doc.createElement('label'); label.textContent = '검토 결과';
          const select = doc.createElement('select'); select.name = 'status';
          for (const [value, text] of [['RESOLVED', '수정 확인 후 해결'], ['REJECTED', '반려']]) {
            const option = doc.createElement('option'); option.value = value; option.textContent = text; select.append(option);
          }
          label.append(select);
          const note = doc.createElement('label'); note.textContent = '처리 근거';
          const input = doc.createElement('textarea'); input.name = 'resolution'; input.maxLength = 500; input.required = true; note.append(input);
          const button = doc.createElement('button'); button.type = 'submit'; button.textContent = '제보 처리';
          form.append(label, note, button);
          form.addEventListener('submit', async event => {
            event.preventDefault(); button.disabled = true;
            try {
              await request(fetcher, `${base(id, channel)}/reports/${encodeURIComponent(report.id)}/resolve`, 'POST',
                { status: select.value, resolution: input.value.trim() });
              if (token === generation) { status.textContent = '제보 처리 결과를 저장했습니다.'; void reports(id, token); }
            } catch (error) { if (token === generation) status.textContent = errorMessage(error); }
            finally { button.disabled = false; }
          });
          li.append(form);
        }
        list.append(li);
      }
      status.textContent = result.reports.length ? '제보를 불러왔습니다.' : '접수된 정정 제보가 없습니다.';
    } catch (error) { if (token === generation) status.textContent = errorMessage(error); }
  };
  {
    select.addEventListener('change', load);
    doc.getElementById('real-world-refresh').addEventListener('click', load);
    doc.getElementById('real-world-add-menu').addEventListener('click', () => {
      const row = menuRow(doc); doc.getElementById('real-world-menu-rows').append(row);
      updatePhotoOptions(doc, view?.photos ?? []);
    });
    doc.getElementById('real-world-clear-location').addEventListener('click', () => {
      for (const name of ['latitude', 'longitude', 'entranceLatitude', 'entranceLongitude', 'floor', 'unit', 'entranceNote', 'verificationNote']) fields(form)[name].value = '';
    });
    doc.getElementById('real-world-clear-schedule').addEventListener('click', () => {
      for (let i = 1; i <= 7; i++) fields(form)[`weekday${i}`].value = '';
      fields(form).exceptions.value = ''; fields(form).scheduleConfirmed.checked = false;
    });
    form.addEventListener('submit', async event => {
      event.preventDefault(); if (!view || busy) return;
      if (conflict) { status.textContent = conflictMessage; return; }
      const token = generation, id = select.value;
      let profile;
      try { profile = profileFromForm(form, view.profile, new Date(), channel === 'admin' ? 'ADMIN_DOCUMENTED' : 'OWNER_DECLARED'); }
      catch (error) { status.textContent = error.message; return; }
      busy = true; status.textContent = '실제 정보를 저장하는 중입니다.';
      try {
        const next = await request(fetcher, `${base(id, channel)}/real-world-profile`, 'PUT', { expectedVersion: view.version, profile });
        if (token !== generation || id !== select.value) return;
        saveView(next); status.textContent = '실제 정보를 저장했습니다.';
      } catch (error) { if (token === generation) await reconcileWrite(id, token, error, profile); }
      finally { if (token === generation) busy = false; }
    });
    doc.getElementById('real-world-photo-form').addEventListener('submit', async event => {
      event.preventDefault(); if (!view || busy) return;
      if (conflict) { status.textContent = conflictMessage; return; }
      const token = generation, id = select.value;
      const photoForm = event.currentTarget, input = fields(photoForm), file = input.photo.files?.[0];
      if (!file || !['image/jpeg', 'image/png', 'image/webp'].includes(file.type) || !input.rightsConfirmed.checked) {
        status.textContent = 'JPEG·PNG·WebP 사진과 게시 권리 확인이 필요합니다.'; return;
      }
      const version = view.version;
      let uploadStarted = false;
      busy = true; status.textContent = '실제 사진을 등록하는 중입니다.';
      try {
        const dataUrl = await new Promise((resolve, reject) => {
          const reader = new FileReader(); reader.onload = () => resolve(reader.result); reader.onerror = reject; reader.readAsDataURL(file);
        });
        if (token !== generation || id !== select.value) return;
        uploadStarted = true;
        const next = await request(fetcher, `${base(id, channel)}/photos`, 'POST', {
          expectedVersion: version, kind: input.kind.value, caption: optional(input.caption.value),
          rightsConfirmed: true, mimeType: file.type, base64: String(dataUrl).split(',')[1],
        });
        if (token !== generation || id !== select.value) return;
        saveView(next, true); photoForm.reset(); status.textContent = '실제 사진을 등록했습니다.';
      } catch (error) {
        if (token === generation) {
          if (uploadStarted && (!error.status || error.status >= 500)) input.photo.value = '';
          await reconcileWrite(id, token, error);
        }
      }
      finally { if (token === generation) busy = false; }
    });
    doc.getElementById('real-world-candidates-form').addEventListener('submit', async event => {
      event.preventDefault();
      const id = select.value, token = generation, address = fields(event.currentTarget).address.value.trim();
      const candidateStatus = doc.getElementById('real-world-candidates-status');
      const list = doc.getElementById('real-world-candidates-list'); list.replaceChildren();
      try {
        const result = await request(fetcher, `${base(id, channel)}/location-candidates`, 'POST', { address });
        if (token !== generation || id !== select.value) return;
        for (const candidate of result.candidates ?? []) {
          const item = doc.createElement('li');
          item.textContent = `${candidate.name} · ${candidate.roadAddress} · 참고용 외부 지도 후보 (점포 위치로 자동 저장되지 않음)`;
          list.append(item);
        }
        candidateStatus.textContent = list.children.length ? '검색 후보입니다. 실제 위치는 별도로 확인하세요.' : '검색 후보가 없습니다.';
      } catch (error) { if (token === generation) candidateStatus.textContent = errorMessage(error); }
    });
    doc.getElementById('real-world-preview-link').addEventListener('click', event => {
      event.preventDefault();
      const target = doc.getElementById('real-world-preview'), id = select.value, token = generation;
      if (token !== generation || !view || view.merchantId !== id) { target.textContent = '점포 정보를 먼저 불러와 주세요.'; return; }
      if (!view.preview) { target.textContent = '미리보기 정보를 불러오지 못했습니다.'; return; }
      renderRealWorldPreview(doc, target, view.preview, channel, id, view.photos);
    });
  }
  const cleanup = () => {
    generation++; view = undefined; busy = false; panel.hidden = true; form.hidden = true; form.reset?.(); select.replaceChildren();
    doc.getElementById('real-world-photo-form').reset?.();
    doc.getElementById('real-world-candidates-form').reset?.();
    for (const name of ['real-world-menu-rows', 'real-world-photos', 'real-world-readiness', 'real-world-engagement',
      'real-world-candidates-list', 'real-world-reports']) doc.getElementById(name)?.replaceChildren();
    for (const name of ['real-world-status', 'real-world-preview', 'real-world-candidates-status', 'real-world-reports-status']) {
      const node = doc.getElementById(name); if (node) node.textContent = '';
    }
    const reportsPanel = doc.getElementById('real-world-admin-reports'); if (reportsPanel) reportsPanel.hidden = true;
  };
  const configure = next => {
    members = next; const previous = select.value; select.replaceChildren();
    for (const merchant of next) {
      const option = doc.createElement('option'); option.value = merchant.id;
      option.textContent = `${merchant.name} · ${merchant.role === 'OWNER' ? '점주' : '직원'}`; select.append(option);
    }
    if (next.some(item => item.id === previous)) select.value = previous;
    panel.hidden = next.length === 0;
    if (next.length) void load(); else cleanup();
    return cleanup;
  };
  mounted.set(panel, { configure });
  return configure(merchants);
}

export const mountRealWorldMerchant = (fetcher, doc, merchants) => mountRealWorldProfile(fetcher, doc, merchants, 'merchant');
export const mountRealWorldAdmin = (fetcher, doc, merchants) => mountRealWorldProfile(fetcher, doc, merchants, 'admin');
