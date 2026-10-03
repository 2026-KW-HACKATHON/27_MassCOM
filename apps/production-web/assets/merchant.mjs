import { clearCollectibleDrafts } from './collectible-assist.mjs';

const merchantRequests = new WeakMap();
const merchantClaimResolutions = new WeakMap();
const merchantClaimSlots = new WeakMap();
// bindMerchant이 둔 최근 목록 읽기 함수. loadMerchant가 점포 권한을 확인하고 구역을 연 뒤 부른다.
const reversalRefreshers = new WeakMap();
// bindMerchant이 둔 가게 현황 읽기 함수(#330). loadMerchant가 구역을 연 뒤 최근 목록과 함께 부른다.
const overviewRefreshers = new WeakMap();
const feedbackRefreshers = new WeakMap();
const creators = new WeakMap();
const creatorScopes = new WeakMap();
// 지금 제작기가 열려 있는 점포 ID.
const creatorStores = new WeakMap();
const merchantMemberships = new WeakMap();

// reason은 제작기의 dispose(reason)에 그대로 전달된다: 'discard'(사용자가 지금 초안을 명시적으로 버림),
// 생략(평범한 이동 — 미디어 없는 편집 값만 기기에 남겨 둔다). 로그아웃·계정 전환으로 그 계정의 모든 점포 보관본을
// 지우는 일은 제작기가 열려 있지 않아도 일어나야 하므로 clearDrafts(scope)로 따로 호출한다.
function closeCreator(doc, reason) {
  creators.get(doc)?.(reason);
  creators.delete(doc);
  creatorStores.delete(doc);
  doc.getElementById('merchant-creator-editor')?.replaceChildren();
}

// 기기 저장소 인자를 생략해(clearCollectibleDrafts가 전역 기기 저장소를 기본값으로 쓴다) 이 화면의 소스에는
// 그 저장소 이름이 남지 않는다(점주 쿠폰 화면은 마크업·텍스트 노드 렌더링만 쓴다는 시험이 그 문구를 금지한다).
function clearDrafts(scope) {
  if (!scope) return;
  try { clearCollectibleDrafts(undefined, scope); } catch { /* 저장 공간이 없어도 로그아웃·전환은 계속한다 */ }
}

// 제작기 권한은 서버가 MANAGE_ART로 판정한다(기본은 점포의 점주만, 응답에는 싣지 않는다). 이 화면이 아는 것은 역할뿐이라
// 점주 점포만 고르게 하고, 서버가 권한 payload(`canManageArt`)를 보내는 환경이 생기면 그 값도 따른다.
const canCreate = member => member.role === 'OWNER' || member.canManageArt === true;
const creatorDenied = '이 점포의 그림 제작 권한이 없어요. 점주 권한을 확인해 주세요.';
const discardMessage = '저장하지 않은 편집이 있어요. 지금 제작기를 다시 열거나 다른 점포로 바꾸면 사라져요. 계속할까요?';

// 제작기가 게시할 캠페인은 점주 권한으로 읽는 전용 API에서만 받는다. 공개 /merchants는 운영 프록시가
// 캠페인·점포 ID를 지우므로 쓰지 않는다(이 점포의 공개·ACTIVE·기간 안 캠페인과 그 목표만 온다).
export async function loadCreatorCampaigns(fetcher, merchantId) {
  const result = await request(fetcher, `/api/web/merchant/merchants/${encodeURIComponent(merchantId)}/collectible-campaigns`);
  if (!Array.isArray(result?.campaigns)) throw new Error('invalid campaign data');
  return result.campaigns;
}

export function configureCreator(fetcher, doc, mine, { confirm = message => globalThis.confirm?.(message) === true } = {}) {
  const panel = doc.getElementById('merchant-creator');
  const select = doc.getElementById('merchant-creator-store');
  const open = doc.getElementById('merchant-creator-open');
  if (!panel || !select || !open) return;
  const scope = mine.accountScope ?? '';
  const previousScope = creatorScopes.get(doc);
  // 계정 자체가 바뀔 때만 닫고 그 계정의 보관본을 지운다. 같은 계정의 점포·역할 목록만 바뀐 호출(매번 /me를 다시
  // 읽을 때 일어난다)은 제작기를 닫지도, 자동 저장·복원을 막지도 않는다.
  if (previousScope !== undefined && previousScope !== scope) { closeCreator(doc); clearDrafts(previousScope); }
  creatorScopes.set(doc, scope);
  const makers = mine.merchants.filter(canCreate);
  select.replaceChildren();
  for (const merchant of makers) {
    const option = doc.createElement('option'); option.value = merchant.id; option.textContent = merchant.name; select.append(option);
  }
  panel.hidden = makers.length === 0;
  if (makers.length === 0) closeCreator(doc);
  // 같은 계정의 목록만 다시 읽었으면 열려 있는 제작기의 점포를 계속 고른 상태로 둔다. 그 점포의 제작 권한이 사라졌으면 닫는다.
  const mountedStore = creatorStores.get(doc);
  if (mountedStore) {
    if (makers.some(merchant => merchant.id === mountedStore)) select.value = mountedStore;
    else closeCreator(doc);
  }
  // 저장하지 않은 편집이 있으면 제작기를 다시 열거나 점포를 바꾸기 전에 묻는다. 거절하면 그대로 둔다.
  const isDirty = () => creators.get(doc)?.isDirty?.() === true;
  const keepEdits = () => isDirty() && !confirm(discardMessage);
  select.onchange = () => {
    const mounted = creatorStores.get(doc);
    if (!mounted || select.value === mounted) return;
    const discarding = isDirty();
    if (keepEdits()) { select.value = mounted; return; }
    // 고른 점포와 열려 있는 제작기가 어긋나지 않게, 바꾸기로 했으면 지금 제작기를 닫는다.
    // 저장하지 않은 편집을 명시적으로 버리기로 한 것이므로(discarding) 그 초안의 기기 보관본도 지운다.
    closeCreator(doc, discarding ? 'discard' : undefined);
  };
  open.onclick = async () => {
    const currentRequest = merchantRequests.get(doc);
    const merchant = makers.find(member => member.id === select.value);
    if (!merchant) return;
    const discarding = isDirty();
    if (keepEdits()) return;
    open.disabled = true;
    try {
      const module = await import('./collectible-editor.mjs');
      if (merchantRequests.get(doc) !== currentRequest) return;
      closeCreator(doc, discarding ? 'discard' : undefined);
      let denied = false;
      // 등록(creators.set) 전에는 undefined로 남아 있어, 이 호출이 지금 막 여는 바로 그 제작기임을 안다.
      let cleanupRef;
      const cleanup = await module.mountCollectibleEditor(doc.getElementById('merchant-creator-editor'), {
        merchantId: merchant.id, merchantName: merchant.name, accountScope: mine.accountScope,
        merchantArtUrl: merchant.artUrl ?? '',
        loadCampaigns: () => loadCreatorCampaigns(fetcher, merchant.id),
        request: (path, options = {}) => request(fetcher, path, options.method ?? 'GET', options.body),
        onNotice: message => { doc.getElementById('merchant-status').textContent = message; },
        // 목록이 403이면 이 계정은 이 점포의 제작 권한이 없다(예: 직원). 제작기를 닫고 이유를 알린다.
        // merchantRequests는 같은 계정의 /me 새로 고침마다도 올라가므로, 그 값으로 판정하면 제작기를 열어 둔 채로
        // 같은 계정의 /me가 한 번만 더 와도 그 뒤에 온 403을 영영 놓친다(실측, PR #289 후속). 등록 전이면(아래
        // cleanupRef가 아직 비어 있으면) 지금 여는 이 호출이 맞으므로 항상 처리하고, 등록 후에는 지금도 이
        // 인스턴스가 그대로 열려 있는 제작기일 때만(다른 점포로 바뀌었거나 닫혔으면 무시) 처리한다.
        onAccessDenied: () => {
          if (cleanupRef !== undefined && creators.get(doc) !== cleanupRef) return;
          denied = true;
          closeCreator(doc);
          doc.getElementById('merchant-status').textContent = creatorDenied;
        },
      });
      cleanupRef = cleanup;
      // 권한 거절이 등록(creators.set)보다 먼저 도착했다면 방금 만든 제작기를 여기서 닫는다.
      if (denied) { cleanup?.(); doc.getElementById('merchant-creator-editor')?.replaceChildren(); return; }
      if (merchantRequests.get(doc) !== currentRequest) { cleanup?.(); return; }
      creators.set(doc, cleanup);
      creatorStores.set(doc, merchant.id);
    } catch (error) {
      if (merchantRequests.get(doc) === currentRequest) doc.getElementById('merchant-status').textContent = error.status === 403
        ? creatorDenied : '제작기를 열지 못했어요. 다시 시도해 주세요.';
    } finally { open.disabled = false; }
  };
}

const isStaffCoupon = coupon => coupon !== null && typeof coupon === 'object'
  && typeof coupon.couponId === 'string' && coupon.couponId !== ''
  && typeof coupon.title === 'string' && coupon.title !== '' && typeof coupon.detail === 'string'
  && typeof coupon.expiresAt === 'string' && !Number.isNaN(Date.parse(coupon.expiresAt));

const kstMonthDay = new Intl.DateTimeFormat('en-US', { timeZone: 'Asia/Seoul', month: 'numeric', day: 'numeric' });
// 앱·도감과 같은 "~10월 29일까지". 브라우저 시간대가 아니라 한국 날짜로 센다.
function expiryLabel(expiresAt) {
  const parts = kstMonthDay.formatToParts(new Date(expiresAt));
  const part = type => parts.find(item => item.type === type)?.value;
  return `~${part('month')}월 ${part('day')}일까지`;
}

const visitCancelReasons = [
  ['WRONG_CUSTOMER', '다른 손님으로 잘못 확인했어요'],
  ['DUPLICATE', '같은 방문을 두 번 확인했어요'],
  ['NOT_A_REAL_VISIT', '실제 방문·이용이 아니었어요'],
  ['OTHER', '기타'],
];
const reasonLabels = new Map(visitCancelReasons);
const kstClock = new Intl.DateTimeFormat('ko-KR', { timeZone: 'Asia/Seoul', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
const clockLabel = iso => kstClock.format(new Date(iso));
const isDateText = value => typeof value === 'string' && !Number.isNaN(Date.parse(value));

const isRecentVisit = visit => visit !== null && typeof visit === 'object'
  && typeof visit.visitEventId === 'string' && visit.visitEventId !== '' && isDateText(visit.occurredAt)
  && typeof visit.customerLabel === 'string' && visit.customerLabel !== ''
  && (visit.status === 'VALID' || visit.status === 'CANCELED') && typeof visit.progressCounted === 'boolean'
  && typeof visit.canCancel === 'boolean'
  && (visit.cancellationReason === null || typeof visit.cancellationReason === 'string');

const isRecentRedemption = coupon => coupon !== null && typeof coupon === 'object'
  && typeof coupon.couponId === 'string' && coupon.couponId !== '' && typeof coupon.title === 'string'
  && isDateText(coupon.redeemedAt) && typeof coupon.customerLabel === 'string' && coupon.customerLabel !== ''
  && isDateText(coupon.undoUntil) && typeof coupon.canUndo === 'boolean';

// 실패 코드를 점원이 바로 할 수 있는 말로 바꾼다. 원인을 모르면 재시도를 안내한다.
export function visitCancelMessage(error) {
  if (error.status === 401) return '점포 권한을 확인하지 못했어요. 다시 로그인해 주세요.';
  switch (error.code) {
    case 'MERCHANT_ACCESS_DENIED': return '이 점포의 방문 확인 권한이 없어요.';
    case 'VISIT_NOT_FOUND': return '이 점포에서 찾을 수 없는 방문이에요. 목록을 새로 불러왔어요.';
    case 'VISIT_CANCEL_WINDOW_CLOSED': return '방문한 날이 지나 취소할 수 없어요.';
    case 'VISIT_REWARD_ALREADY_MINTED': return '이 방문으로 받은 NFT를 이미 발행했거나 발행 중이라 취소할 수 없어요.';
    case 'VISIT_REWARD_MINT_IN_PROGRESS': return 'NFT 발행이 막 시작돼 지금은 취소할 수 없어요. 잠시 뒤 다시 시도해 주세요.';
    case 'INVALID_REVERSAL_REASON': return '취소 사유를 골라 주세요.';
    case 'INVALID_REVERSAL_NOTE': return '메모는 100자 이하로 쓰고 연락처·이메일·주소는 적지 마세요.';
    case 'ACCOUNT_DELETED': return '계정이 삭제돼 처리할 수 없어요.';
    default: return '방문을 취소하지 못했어요. 잠시 후 다시 시도해 주세요.';
  }
}

export function couponUndoMessage(error) {
  if (error.status === 401) return '점포 권한을 확인하지 못했어요. 다시 로그인해 주세요.';
  switch (error.code) {
    case 'MERCHANT_ACCESS_DENIED': return '이 점포의 쿠폰 처리 권한이 없어요.';
    case 'COUPON_NOT_FOUND': return '이 점포에서 찾을 수 없는 쿠폰이에요. 목록을 새로 불러왔어요.';
    case 'COUPON_UNDO_WINDOW_CLOSED': return '사용 처리 후 10분이 지나 되돌릴 수 없어요.';
    case 'COUPON_NOT_REDEEMED': return '사용 처리된 쿠폰이 아니라서 되돌릴 게 없어요.';
    case 'COUPON_SELF_UNDO': return '본인 쿠폰은 직접 되돌릴 수 없어요. 다른 직원에게 요청해 주세요.';
    case 'COUPON_REQUIREMENT_LOST': return '방문 기록이 바뀌어 고객의 배지 조건이 사라져서 되돌릴 수 없어요. 쿠폰은 사용 완료로 남아요.';
    case 'ACCOUNT_DELETED': return '계정이 삭제돼 처리할 수 없어요.';
    default: return '쿠폰 사용을 되돌리지 못했어요. 잠시 후 다시 시도해 주세요.';
  }
}

// ---- 가게 현황(#330): 요약 카드와 오픈 준비 체크리스트의 글자·검증 도우미 ----
const readinessStateLabels = {
  DONE: '완료', NEEDS_SETUP: '설정 필요', CHECK: '확인 필요', WAITING_APPROVAL: '승인 대기', SCHEDULED: '공개 예정',
};
export const readinessStateLabel = state => readinessStateLabels[state] ?? '확인 필요';

// 개인정보 처리방침에 공개된 운영팀 문의처를 그대로 안내한다.
export const operatorContact = 'choijunhuk2007@gmail.com';
export function readinessRequestText(merchant, step, steps = []) {
  let missing = step.hint || `${step.label} 확인`;
  if (step.key === 'basic') {
    const fields = step.hint.match(/비어 있는 항목:\s*([^。]+?)\.\s*운영팀/);
    if (fields) missing = `${fields[1]} 입력`;
  } else if (step.key === 'menu') missing = '메뉴 1개 이상 등록';
  else if (step.key === 'visible') {
    const prerequisites = steps.filter(item => item.state !== 'DONE' && item.key !== 'visible')
      .map(item => `${item.label}: ${item.hint || '확인 필요'}`);
    missing = [step.hint || '고객 앱 공개 확인', ...prerequisites].join('\n');
  }
  return `가게 운영 요청\n가게: ${merchant.name}\n가게 ID: ${merchant.id}\n요청 항목: ${step.label}\n필요한 내용: ${missing}`;
}

const campaignPhaseLabels = {
  LIVE: '진행 중', SCHEDULED: '시작 전', NOT_PUBLIC: '고객에게 비공개', EXPIRED: '기간 종료', DRAFT: '초안', PAUSED: '일시정지', ENDED: '종료',
};
export const campaignPhaseLabel = phase => campaignPhaseLabels[phase] ?? '확인 필요';

// 지난주 대비는 서버가 비교가 공정하다고 판단했을 때만(comparison이 null이 아닐 때) 보인다.
export function overviewComparisonText(comparison) {
  if (!comparison) return null;
  if (comparison.delta > 0) return `지난주 대비 +${comparison.delta}건`;
  if (comparison.delta < 0) return `지난주 대비 −${Math.abs(comparison.delta)}건`;
  return '지난주 대비 변화 없음';
}

const weekdayNames = ['일', '월', '화', '수', '목', '금', '토'];
// 'YYYY-MM-DD'(서버가 센 한국 날짜)를 시간대 변환 없이 읽는다.
function dateParts(date) {
  const [year, month, day] = date.split('-').map(Number);
  return { month, day, weekday: weekdayNames[new Date(Date.UTC(year, month - 1, day)).getUTCDay()] };
}
export function dayLabel(date) {
  const { month, day, weekday } = dateParts(date);
  return `${month}/${day}(${weekday})`;
}
const businessDateLabel = date => {
  const { month, day, weekday } = dateParts(date);
  return `${month}월 ${day}일(${weekday})`;
};
// 막대 길이(%). 0건이면 0%, 0이 아니면 보이도록 최소 1%.
export function barWidthPercent(count, max) {
  if (!(max > 0) || !(count > 0)) return 0;
  return Math.max(1, Math.round((count / max) * 100));
}
const monthDayLabel = iso => {
  const parts = kstMonthDay.formatToParts(new Date(iso));
  const part = type => parts.find(item => item.type === type)?.value;
  return `${part('month')}월 ${part('day')}일`;
};

const isCount = value => Number.isInteger(value) && value >= 0;
const isDateOnly = value => typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value);
const isOverviewStep = step => step !== null && typeof step === 'object' && typeof step.key === 'string'
  && typeof step.label === 'string' && Object.hasOwn(readinessStateLabels, step.state) && typeof step.hint === 'string';
const isOverviewCampaign = campaign => campaign !== null && typeof campaign === 'object' && typeof campaign.title === 'string'
  && Object.hasOwn(campaignPhaseLabels, campaign.phase) && isDateText(campaign.startsAt) && isDateText(campaign.endsAt);
const isOverview = value => value !== null && typeof value === 'object' && isDateOnly(value.businessDate)
  && value.visits !== null && typeof value.visits === 'object'
  && ['today', 'thisWeek', 'lastWeek', 'total'].every(key => isCount(value.visits[key]))
  && Array.isArray(value.visits.last7Days) && value.visits.last7Days.length === 7
  && value.visits.last7Days.every(day => day !== null && typeof day === 'object' && isDateOnly(day.date) && isCount(day.count))
  && (value.comparison === null || (typeof value.comparison === 'object' && Number.isInteger(value.comparison.delta)))
  && isCount(value.couponsRedeemedThisWeek) && isCount(value.repeatVisitors)
  && (value.weekVisitors === undefined || (value.weekVisitors !== null && isCount(value.weekVisitors.first) && isCount(value.weekVisitors.repeat)))
  && (value.weekCollectibles === undefined || (Array.isArray(value.weekCollectibles) && value.weekCollectibles.every(grade =>
    grade !== null && typeof grade.gradeId === 'string' && typeof grade.gradeName === 'string' && isCount(grade.count))))
  && (value.weekCoupons === undefined || (value.weekCoupons !== null && isCount(value.weekCoupons.issued) && isCount(value.weekCoupons.redeemed)))
  && (value.weekDetailViews === undefined || isCount(value.weekDetailViews))
  && (value.campaign === null || isOverviewCampaign(value.campaign))
  && value.readiness !== null && typeof value.readiness === 'object' && typeof value.readiness.message === 'string'
  && Array.isArray(value.readiness.steps) && value.readiness.steps.length > 0 && value.readiness.steps.every(isOverviewStep);

async function request(fetcher, path, method = 'GET', body) {
  const response = await fetcher(path, {
    method, credentials: 'same-origin', cache: 'no-store',
    headers: body === undefined ? { Accept: 'application/json' } : {
      Accept: 'application/json', 'Content-Type': 'application/json',
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  if (!response.ok) {
    const error = new Error('merchant request failed');
    error.status = response.status;
    const retryAfter = Number(response.headers?.get?.('Retry-After'));
    if (Number.isFinite(retryAfter) && retryAfter > 0) error.retryAfterSeconds = Math.ceil(retryAfter);
    try { error.code = (await response.json()).code; } catch { /* status is enough */ }
    throw error;
  }
  return response.status === 204 ? undefined : response.json();
}

export async function loadMerchant(fetcher, doc) {
  const requestId = (merchantRequests.get(doc) ?? 0) + 1;
  merchantRequests.set(doc, requestId);
  merchantMemberships.delete(doc);
  merchantClaimResolutions.delete(doc);
  merchantClaimSlots.delete(doc);
  const status = doc.getElementById('merchant-status');
  const login = doc.getElementById('merchant-login');
  const logout = doc.getElementById('merchant-logout');
  const content = doc.getElementById('merchant-content');
  const list = doc.getElementById('merchant-memberships');
  const select = doc.querySelector('#merchant-registration select');
  const code = doc.getElementById('merchant-code');
  const claimForm = doc.getElementById('merchant-claim-form');
  const claimSelect = doc.getElementById('merchant-claim-merchant');
  content.hidden = true;
  login.hidden = true;
  logout.hidden = true;
  list.replaceChildren();
  select.replaceChildren();
  code.textContent = '';
  claimForm.hidden = true;
  claimSelect.replaceChildren();
  doc.getElementById('merchant-claim-token').value = '';
  doc.getElementById('merchant-claim-reference').value = '';
  doc.getElementById('merchant-claim-confirm').checked = false;
  doc.getElementById('merchant-claim-submit').disabled = true;
  doc.getElementById('merchant-claim-result').textContent = '';
  doc.getElementById('merchant-coupon').hidden = true;
  doc.getElementById('merchant-coupon-list').replaceChildren();
  doc.getElementById('merchant-coupon-status').textContent = '';
  doc.getElementById('merchant-claim-issued-qr').src = '';
  doc.getElementById('merchant-claim-issued-qr').hidden = true;
  doc.getElementById('merchant-claim-reissue').hidden = true;
  doc.getElementById('merchant-claim-reissue-confirm').checked = false;
  doc.getElementById('merchant-claim-reissue-submit').disabled = true;
  const reversalPanel = doc.getElementById('merchant-reversal');
  const reversalSelect = doc.getElementById('merchant-reversal-merchant');
  if (reversalPanel) reversalPanel.hidden = true;
  reversalSelect?.replaceChildren();
  for (const id of ['merchant-visit-list', 'merchant-redemption-list']) doc.getElementById(id)?.replaceChildren();
  for (const id of ['merchant-visit-status', 'merchant-redemption-status']) {
    const node = doc.getElementById(id);
    if (node) node.textContent = '';
  }
  const overviewPanel = doc.getElementById('merchant-overview');
  const overviewPicker = doc.getElementById('merchant-overview-picker');
  const overviewSelect = doc.getElementById('merchant-overview-merchant');
  if (overviewPanel) overviewPanel.hidden = true;
  overviewSelect?.replaceChildren();
  for (const id of ['merchant-overview-cards', 'merchant-readiness-list']) doc.getElementById(id)?.replaceChildren();
  for (const id of ['merchant-overview-status', 'merchant-readiness-message']) {
    const node = doc.getElementById(id);
    if (node) node.textContent = '';
  }
  const overviewRefresh = doc.getElementById('merchant-overview-refresh');
  if (overviewRefresh) overviewRefresh.disabled = false;
  const feedbackPanel = doc.getElementById('merchant-feedback');
  if (feedbackPanel) feedbackPanel.hidden = true;
  for (const id of ['merchant-feedback-tags', 'merchant-feedback-suggestions', 'merchant-feedback-notes']) {
    doc.getElementById(id)?.replaceChildren();
  }
  const feedbackStatus = doc.getElementById('merchant-feedback-status');
  if (feedbackStatus) feedbackStatus.textContent = '';
  try {
    const [mine, eligible] = await Promise.all([
      request(fetcher, '/api/web/merchant/me'),
      request(fetcher, '/api/web/merchant/registration-merchants'),
    ]);
    if (merchantRequests.get(doc) !== requestId) return;
    if (!Array.isArray(mine.merchants) || !Array.isArray(eligible.merchants)) throw new Error('invalid merchant data');
    merchantMemberships.set(doc, mine.merchants);
    configureCreator(fetcher, doc, mine);
    for (const merchant of mine.merchants) {
      const item = doc.createElement('p');
      item.textContent = `${merchant.name} · ${merchant.role === 'OWNER' ? '점주' : '직원'}`;
      list.append(item);
      const option = doc.createElement('option');
      option.value = merchant.id;
      option.textContent = merchant.name;
      claimSelect.append(option);
      if (reversalSelect) {
        const reversalOption = doc.createElement('option');
        reversalOption.value = merchant.id;
        reversalOption.textContent = merchant.name;
        reversalSelect.append(reversalOption);
      }
      if (overviewSelect) {
        const overviewOption = doc.createElement('option');
        overviewOption.value = merchant.id;
        overviewOption.textContent = merchant.name;
        overviewSelect.append(overviewOption);
      }
    }
    if (reversalPanel) reversalPanel.hidden = mine.merchants.length === 0;
    if (overviewPanel) overviewPanel.hidden = mine.merchants.length === 0;
    if (feedbackPanel) feedbackPanel.hidden = mine.merchants.length === 0;
    // 점포가 하나뿐이면 점포 고르기는 보이지 않아도 된다.
    if (overviewPicker) overviewPicker.hidden = mine.merchants.length <= 1;
    claimForm.hidden = mine.merchants.length === 0;
    if (!mine.merchants.length) list.textContent = '아직 승인된 점포가 없습니다.';
    for (const merchant of eligible.merchants) {
      if (mine.merchants.some(member => member.id === merchant.id)) continue;
      const option = doc.createElement('option');
      option.value = merchant.id;
      option.textContent = merchant.name;
      select.append(option);
    }
    const registration = doc.getElementById('merchant-registration');
    registration.hidden = select.children.length === 0;
    registration.querySelector('button').disabled = false;
    content.hidden = false;
    logout.hidden = false;
    status.textContent = '점포 권한을 확인했습니다.';
    // 구역이 열리면 가게 현황과 최근 방문·쿠폰 사용을 바로 읽는다(실패해도 점포 화면은 그대로다).
    if (mine.merchants.length > 0) await Promise.all([
      overviewRefreshers.get(doc)?.(), feedbackRefreshers.get(doc)?.(), reversalRefreshers.get(doc)?.(),
    ]);
  } catch (error) {
    if (merchantRequests.get(doc) !== requestId) return;
    if (error.status === 401) {
      closeCreator(doc);
      login.hidden = false;
      status.textContent = error.code === 'WEB_AUTH_ACCOUNT_NOT_FOUND'
        ? '고객 앱에서 이 Google 계정으로 먼저 로그인해 주세요.' : 'Google 계정으로 로그인해 주세요.';
    } else status.textContent = '점포 정보를 불러오지 못했습니다. 새로고침해 주세요.';
  }
}

export function bindMerchant(fetcher, doc) {
  const status = doc.getElementById('merchant-status');
  const code = doc.getElementById('merchant-code');
  const claimForm = doc.getElementById('merchant-claim-form');
  const claimMerchant = doc.getElementById('merchant-claim-merchant');
  const claimToken = doc.getElementById('merchant-claim-token');
  const claimReference = doc.getElementById('merchant-claim-reference');
  const claimConfirm = doc.getElementById('merchant-claim-confirm');
  const claimSubmit = doc.getElementById('merchant-claim-submit');
  const claimResolve = doc.getElementById('merchant-claim-resolve');
  const claimResult = doc.getElementById('merchant-claim-result');
  const claimQr = doc.getElementById('merchant-claim-issued-qr');
  const reissue = doc.getElementById('merchant-claim-reissue');
  const reissueConfirm = doc.getElementById('merchant-claim-reissue-confirm');
  const reissueSubmit = doc.getElementById('merchant-claim-reissue-submit');
  const scanButton = doc.getElementById('merchant-claim-scan');
  const scanCancel = doc.getElementById('merchant-claim-scan-cancel');
  const video = doc.getElementById('merchant-claim-video');
  const couponPanel = doc.getElementById('merchant-coupon');
  const couponLookup = doc.getElementById('merchant-coupon-lookup');
  const couponList = doc.getElementById('merchant-coupon-list');
  const couponStatus = doc.getElementById('merchant-coupon-status');
  let cameraStream;
  let scanId = 0;
  let issuing = false;
  let couponBusy = false;
  let coupons = [];
  let couponButtons = [];
  const syncCouponControls = () => {
    couponLookup.disabled = issuing || couponBusy;
    for (const button of couponButtons) button.disabled = issuing || couponBusy;
  };
  const setIssuing = active => {
    issuing = active;
    for (const control of [claimMerchant, claimToken, claimReference, claimConfirm, claimResolve, scanButton]) {
      control.disabled = active;
    }
    claimSubmit.disabled = active || !merchantClaimResolutions.has(doc) || !claimConfirm.checked;
    reissueSubmit.disabled = active || !merchantClaimSlots.has(doc) || !reissueConfirm.checked;
    syncCouponControls();
  };
  const resetCoupons = () => {
    couponBusy = false;
    coupons = [];
    couponButtons = [];
    couponPanel.hidden = true;
    couponList.replaceChildren();
    couponStatus.textContent = '';
    syncCouponControls();
  };
  const clearSlot = () => {
    if (merchantClaimSlots.has(doc)) {
      claimQr.src = '';
      claimQr.hidden = true;
    }
    merchantClaimSlots.delete(doc);
    reissue.hidden = true;
    reissueConfirm.checked = false;
    reissueSubmit.disabled = true;
  };
  const showSlot = (issued, merchantId) => {
    if (typeof issued.claimSlotId !== 'string' || !Number.isSafeInteger(issued.tokenVersion) || issued.tokenVersion < 1) return;
    merchantClaimSlots.set(doc, { merchantId, claimSlotId: issued.claimSlotId, tokenVersion: issued.tokenVersion });
    reissueConfirm.checked = false;
    reissueSubmit.disabled = true;
    reissue.hidden = false;
  };
  const showToken = issued => {
    claimResult.textContent = `방문 코드: ${issued.token} · 만료: ${new Date(issued.expiresAt).toLocaleTimeString('ko-KR')}${
      issued.qrRenderFailed || !issued.qrSvgDataUrl ? ' · QR 그림을 만들지 못했습니다. 방문 코드를 고객 앱에 직접 입력해 주세요.' : ''}`;
    if (/^data:image\/svg\+xml;base64,[A-Za-z0-9+/=]+$/.test(issued.qrSvgDataUrl ?? '')) {
      claimQr.src = issued.qrSvgDataUrl;
      claimQr.hidden = false;
    }
  };
  const stopCamera = () => {
    scanId += 1;
    cameraStream?.getTracks().forEach(track => track.stop());
    cameraStream = undefined;
    video.srcObject = null;
    video.hidden = true;
    scanCancel.hidden = true;
    scanButton.disabled = false;
  };
  const invalidateClaim = () => {
    merchantClaimResolutions.delete(doc);
    resetCoupons();
    claimConfirm.checked = false;
    claimSubmit.disabled = true;
    claimQr.src = '';
    claimQr.hidden = true;
  };
  claimMerchant.addEventListener('change', () => { invalidateClaim(); clearSlot(); });
  claimToken.addEventListener('input', () => { invalidateClaim(); clearSlot(); });
  claimReference.addEventListener('input', clearSlot);
  reissueConfirm.addEventListener('change', () => {
    reissueSubmit.disabled = issuing || !merchantClaimSlots.has(doc) || !reissueConfirm.checked;
  });
  scanCancel.addEventListener('click', stopCamera);
  scanButton.addEventListener('click', async () => {
    if (issuing) return;
    stopCamera();
    invalidateClaim();
    clearSlot();
    const view = doc.defaultView;
    const Detector = view?.BarcodeDetector;
    if (!Detector?.getSupportedFormats || !view?.navigator?.mediaDevices?.getUserMedia) {
      claimResult.textContent = '이 기기에서는 카메라 QR 읽기를 사용할 수 없습니다. QR 내용을 직접 입력해 주세요.';
      return;
    }
    const currentScan = scanId;
    scanButton.disabled = true;
    try {
      if (!(await Detector.getSupportedFormats()).includes('qr_code')) {
        throw new Error('QR detection unsupported');
      }
      const detector = new Detector({ formats: ['qr_code'] });
      const stream = await view.navigator.mediaDevices.getUserMedia({
        video: { facingMode: { ideal: 'environment' } }, audio: false,
      });
      if (currentScan !== scanId) {
        stream.getTracks().forEach(track => track.stop());
        return;
      }
      cameraStream = stream;
      video.srcObject = stream;
      video.hidden = false;
      scanCancel.hidden = false;
      await video.play();
      const scan = async () => {
        if (currentScan !== scanId) return;
        try {
          const codes = await detector.detect(video);
          if (currentScan !== scanId) return;
          const token = codes.find(code => code.format === 'qr_code' && typeof code.rawValue === 'string')?.rawValue;
          if (token) {
            stopCamera();
            claimToken.value = token;
            invalidateClaim();
            claimResult.textContent = '고객 QR을 읽었습니다. 고객 QR 확인을 눌러 주세요.';
          } else view.requestAnimationFrame(scan);
        } catch {
          if (currentScan !== scanId) return;
          stopCamera();
          claimResult.textContent = '카메라로 QR을 읽지 못했습니다. QR 내용을 직접 입력해 주세요.';
        }
      };
      view.requestAnimationFrame(scan);
    } catch {
      if (currentScan !== scanId) return;
      stopCamera();
      claimResult.textContent = '카메라를 사용할 수 없습니다. QR 내용을 직접 입력해 주세요.';
    }
  });
  claimConfirm.addEventListener('change', () => {
    claimSubmit.disabled = issuing || !merchantClaimResolutions.has(doc) || !claimConfirm.checked;
  });
  claimResolve.addEventListener('click', async () => {
    if (issuing) return;
    invalidateClaim();
    claimResult.textContent = '';
    const merchantId = claimMerchant.value;
    const token = claimToken.value.trim();
    if (!merchantId || !token) {
      claimResult.textContent = '점포와 고객 QR 내용을 입력해 주세요.';
      return;
    }
    const requestId = merchantRequests.get(doc);
    try {
      const result = await request(fetcher,
        `/api/web/merchant/merchants/${encodeURIComponent(merchantId)}/customer-identities/resolve`,
        'POST', { customerIdentityToken: token });
      if (merchantRequests.get(doc) !== requestId || claimMerchant.value !== merchantId || claimToken.value.trim() !== token) return;
      merchantClaimResolutions.set(doc, { merchantId, token });
      claimResult.textContent = `고객 QR 확인 완료 · 만료: ${new Date(result.expiresAt).toLocaleTimeString('ko-KR')}`;
      couponPanel.hidden = false;
    } catch (error) {
      if (merchantRequests.get(doc) !== requestId) return;
      claimResult.textContent = error.code === 'CUSTOMER_IDENTITY_EXPIRED'
        ? '고객 QR이 만료되었습니다. 고객에게 새 QR을 요청해 주세요.'
        : '고객 QR을 확인하지 못했습니다. 새 QR이나 점포 권한을 확인해 주세요.';
    }
  });
  const renderCoupons = () => {
    couponList.replaceChildren();
    couponButtons = coupons.map(coupon => {
      const item = doc.createElement('li');
      const text = doc.createElement('p');
      text.className = 'coupon-text';
      text.textContent = `${coupon.title}${coupon.detail ? ` · ${coupon.detail}` : ''} · ${expiryLabel(coupon.expiresAt)}`;
      const button = doc.createElement('button');
      button.type = 'button';
      button.className = 'collection-action';
      button.textContent = `${coupon.title} 사용 처리`;
      button.disabled = issuing || couponBusy;
      button.addEventListener('click', () => redeemCoupon(coupon));
      item.append(text, button);
      couponList.append(item);
      return button;
    });
  };
  const couponContext = () => {
    const resolved = merchantClaimResolutions.get(doc);
    return resolved && resolved.merchantId === claimMerchant.value && resolved.token === claimToken.value.trim()
      ? { resolved, requestId: merchantRequests.get(doc) } : undefined;
  };
  const couponFailure = (error, coupon) => {
    if (error.code === 'CUSTOMER_IDENTITY_EXPIRED' || error.code === 'CUSTOMER_IDENTITY_UNAVAILABLE') {
      invalidateClaim();
      claimResult.textContent = error.code === 'CUSTOMER_IDENTITY_EXPIRED'
        ? '고객 QR이 만료되었습니다. 고객에게 새 QR을 요청해 주세요.'
        : '이 고객 QR은 사용할 수 없습니다. 고객에게 새 QR을 요청해 주세요.';
      return;
    }
    if (error.code === 'COUPON_EXPIRED' && coupon) {
      coupons = coupons.filter(item => item.couponId !== coupon.couponId);
      renderCoupons();
    }
    couponStatus.textContent = error.code === 'COUPON_EXPIRED' ? '유효기간이 지난 쿠폰이에요.'
      : error.code === 'COUPON_NOT_FOUND' ? '이 점포에서 쓸 수 없는 쿠폰이에요. 쿠폰을 다시 확인해 주세요.'
        : error.code === 'COUPON_SELF_REDEEM' ? '본인 쿠폰은 직접 사용 처리할 수 없어요. 다른 직원에게 요청해 주세요.'
          : error.code === 'ACCOUNT_DELETED' ? '고객 계정이 삭제돼 쿠폰을 사용할 수 없어요.'
            : error.status === 401 ? '점포 권한을 확인하지 못했습니다. 다시 로그인해 주세요.'
              : error.code === 'MERCHANT_ACCESS_DENIED' ? '이 점포의 쿠폰 처리 권한이 없어요.'
                : '쿠폰을 처리하지 못했어요. 잠시 후 다시 시도해 주세요.';
  };
  const couponStale = context => merchantRequests.get(doc) !== context.requestId
    || merchantClaimResolutions.get(doc) !== context.resolved;
  const redeemCoupon = async coupon => {
    const context = couponContext();
    if (!context || issuing || couponBusy) return;
    const confirmed = doc.defaultView?.confirm?.(`${coupon.title}\n고객이 이 혜택을 지금 받나요? 되돌릴 수 없어요.`);
    if (confirmed !== true) return;
    couponBusy = true;
    syncCouponControls();
    couponStatus.textContent = '쿠폰을 처리하는 중이에요.';
    try {
      const result = await request(fetcher,
        `/api/web/merchant/merchants/${encodeURIComponent(context.resolved.merchantId)}/coupons/${encodeURIComponent(coupon.couponId)}/redeem`,
        'POST', { customerIdentityToken: context.resolved.token });
      if (couponStale(context)) return;
      if (!result || result.status !== 'REDEEMED') throw new Error('invalid coupon redeem response');
      coupons = coupons.filter(item => item.couponId !== coupon.couponId);
      renderCoupons();
      couponBusy = false;
      syncCouponControls();
      couponStatus.textContent = result.replayed === true ? '이미 사용 처리된 쿠폰이에요.' : '쿠폰 사용을 처리했어요.';
      couponLookup.focus?.();
    } catch (error) {
      if (!couponStale(context)) couponFailure(error, coupon);
    } finally {
      if (!couponStale(context)) { couponBusy = false; syncCouponControls(); }
    }
  };
  couponLookup.addEventListener('click', async () => {
    const context = couponContext();
    if (!context || issuing || couponBusy) return;
    couponBusy = true;
    coupons = [];
    renderCoupons();
    syncCouponControls();
    couponStatus.textContent = '쿠폰을 확인하는 중이에요.';
    try {
      const result = await request(fetcher,
        `/api/web/merchant/merchants/${encodeURIComponent(context.resolved.merchantId)}/coupons/lookup`,
        'POST', { customerIdentityToken: context.resolved.token });
      if (couponStale(context)) return;
      if (!result || !Array.isArray(result.coupons) || !result.coupons.every(isStaffCoupon)) {
        throw new Error('invalid coupon lookup response');
      }
      coupons = result.coupons.map(({ couponId, title, detail, expiresAt }) => ({ couponId, title, detail, expiresAt }));
      renderCoupons();
      couponStatus.textContent = coupons.length ? `사용할 수 있는 쿠폰 ${coupons.length}장을 찾았어요.` : '이 점포에서 쓸 수 있는 쿠폰이 없어요';
    } catch (error) {
      if (!couponStale(context)) couponFailure(error);
    } finally {
      if (!couponStale(context)) { couponBusy = false; syncCouponControls(); }
    }
  });
  const reversalSelect = doc.getElementById('merchant-reversal-merchant');
  const reversalRefresh = doc.getElementById('merchant-reversal-refresh');
  const visitList = doc.getElementById('merchant-visit-list');
  const visitStatus = doc.getElementById('merchant-visit-status');
  const redemptionList = doc.getElementById('merchant-redemption-list');
  const redemptionStatus = doc.getElementById('merchant-redemption-status');
  let reversalBusy = false;
  let reversalGeneration = 0;
  let reversalButtons = [];
  const setReversalBusy = active => {
    reversalBusy = active;
    for (const button of reversalButtons) button.disabled = active;
    if (reversalRefresh) reversalRefresh.disabled = active;
  };
  const resetReversal = () => {
    reversalGeneration += 1;
    reversalButtons = [];
    visitList?.replaceChildren();
    redemptionList?.replaceChildren();
    if (visitStatus) visitStatus.textContent = '';
    if (redemptionStatus) redemptionStatus.textContent = '';
  };
  const reversalBase = merchantId => `/api/web/merchant/merchants/${encodeURIComponent(merchantId)}`;
  const visitLabel = visit => visit.status === 'CANCELED'
    ? `취소됨${visit.cancellationReason ? ` · ${reasonLabels.get(visit.cancellationReason) ?? '사유 기록됨'}` : ''}`
    : visit.progressCounted ? '진행 반영' : '기록만(진행에 세지 않음)';
  const cancelVisit = async (merchantId, visit, reason, note) => {
    if (reversalBusy || !merchantId) return;
    const confirmed = doc.defaultView?.confirm?.(
      `${clockLabel(visit.occurredAt)} ${visit.customerLabel} 방문을 취소할까요?\n이 방문으로 받은 미전송 보상 권리는 함께 취소되고 조건이 깨진 미사용 쿠폰은 무효가 돼요.`);
    if (confirmed !== true) {
      visitStatus.textContent = '취소했어요. 방문 기록은 그대로예요.';
      return;
    }
    const requestId = merchantRequests.get(doc);
    setReversalBusy(true);
    visitStatus.textContent = '방문을 취소하는 중이에요.';
    try {
      const trimmed = note.trim();
      const result = await request(fetcher, `${reversalBase(merchantId)}/visits/${encodeURIComponent(visit.visitEventId)}/cancel`,
        'POST', { reason, ...(trimmed ? { note: trimmed } : {}) });
      if (merchantRequests.get(doc) !== requestId) return;
      if (!result || result.status !== 'CANCELED') throw new Error('invalid cancel response');
      const effects = [];
      if (result.revokedRewardCount > 0) effects.push(`보상 권리 ${result.revokedRewardCount}개 취소`);
      if (result.voidedCouponCount > 0) effects.push(`미사용 쿠폰 ${result.voidedCouponCount}장 무효`);
      visitStatus.textContent = `${result.replayed === true ? '이미 취소된 방문이에요.' : '방문을 취소했어요.'}${effects.length ? ` (${effects.join(', ')})` : ''}`;
      setReversalBusy(false);
      await refreshReversal({ keepVisitStatus: true });
    } catch (error) {
      if (merchantRequests.get(doc) === requestId) {
        visitStatus.textContent = visitCancelMessage(error);
        if (error.code === 'VISIT_CANCEL_WINDOW_CLOSED' || error.code === 'VISIT_NOT_FOUND') {
          setReversalBusy(false);
          await refreshReversal({ keepVisitStatus: true });
        }
      }
    } finally {
      if (merchantRequests.get(doc) === requestId) setReversalBusy(false);
    }
  };
  const undoCoupon = async (merchantId, coupon) => {
    if (reversalBusy || !merchantId) return;
    const confirmed = doc.defaultView?.confirm?.(
      `${coupon.title} · ${coupon.customerLabel}\n쿠폰 사용을 되돌릴까요? 고객이 다시 사용할 수 있게 돼요.`);
    if (confirmed !== true) {
      redemptionStatus.textContent = '취소했어요. 쿠폰은 사용 완료 그대로예요.';
      return;
    }
    const requestId = merchantRequests.get(doc);
    setReversalBusy(true);
    redemptionStatus.textContent = '쿠폰 사용을 되돌리는 중이에요.';
    try {
      const result = await request(fetcher,
        `${reversalBase(merchantId)}/coupons/${encodeURIComponent(coupon.couponId)}/undo-redeem`, 'POST', {});
      if (merchantRequests.get(doc) !== requestId) return;
      if (!result || result.status !== 'ISSUED') throw new Error('invalid undo response');
      redemptionStatus.textContent = result.replayed === true ? '이미 되돌린 쿠폰이에요.' : '쿠폰 사용을 되돌렸어요. 고객이 다시 사용할 수 있어요.';
      setReversalBusy(false);
      await refreshReversal({ keepRedemptionStatus: true });
    } catch (error) {
      if (merchantRequests.get(doc) === requestId) {
        redemptionStatus.textContent = couponUndoMessage(error);
        if (['COUPON_UNDO_WINDOW_CLOSED', 'COUPON_NOT_REDEEMED', 'COUPON_NOT_FOUND', 'COUPON_REQUIREMENT_LOST'].includes(error.code)) {
          setReversalBusy(false);
          await refreshReversal({ keepRedemptionStatus: true });
        }
      }
    } finally {
      if (merchantRequests.get(doc) === requestId) setReversalBusy(false);
    }
  };
  const renderVisits = (merchantId, visits) => {
    visitList.replaceChildren();
    for (const visit of visits) {
      const item = doc.createElement('li');
      const text = doc.createElement('p');
      text.className = 'reversal-text';
      text.textContent = `${clockLabel(visit.occurredAt)} · ${visit.customerLabel} · ${visitLabel(visit)}`;
      item.append(text);
      if (visit.canCancel) {
        const form = doc.createElement('form');
        form.className = 'reversal-form';
        const reasonLabel = doc.createElement('label');
        reasonLabel.textContent = '취소 사유 ';
        const reason = doc.createElement('select');
        reason.name = 'reason';
        for (const [value, label] of visitCancelReasons) {
          const option = doc.createElement('option');
          option.value = value;
          option.textContent = label;
          reason.append(option);
        }
        reason.value = visitCancelReasons[0][0];
        reasonLabel.append(reason);
        const noteLabel = doc.createElement('label');
        noteLabel.textContent = '메모(선택, 100자까지 · 연락처·이메일·주소·이름은 적지 마세요) ';
        const note = doc.createElement('input');
        note.name = 'note';
        note.type = 'text';
        note.maxLength = 100;
        note.autocomplete = 'off';
        note.value = '';
        noteLabel.append(note);
        const submit = doc.createElement('button');
        submit.type = 'submit';
        submit.className = 'danger';
        submit.textContent = '방문 취소';
        submit.setAttribute('aria-label', `${clockLabel(visit.occurredAt)} ${visit.customerLabel} 방문 취소`);
        submit.disabled = reversalBusy;
        reversalButtons.push(submit);
        form.append(reasonLabel, noteLabel, submit);
        form.addEventListener('submit', async event => {
          event.preventDefault?.();
          await cancelVisit(merchantId, visit, reason.value, note.value);
        });
        item.append(form);
      }
      visitList.append(item);
    }
  };
  const renderRedemptions = (merchantId, coupons) => {
    redemptionList.replaceChildren();
    for (const coupon of coupons) {
      const item = doc.createElement('li');
      const text = doc.createElement('p');
      text.className = 'reversal-text';
      text.textContent = `${coupon.title} · ${coupon.customerLabel} · ${clockLabel(coupon.redeemedAt)} 사용${coupon.redeemedByMe ? ' (내가 처리)' : ''}`;
      item.append(text);
      if (coupon.canUndo) {
        const hint = doc.createElement('p');
        hint.className = 'reversal-meta';
        hint.textContent = `${clockLabel(coupon.undoUntil)}까지 되돌릴 수 있어요.`;
        const button = doc.createElement('button');
        button.type = 'button';
        button.className = 'danger';
        button.textContent = '사용 되돌리기';
        button.setAttribute('aria-label', `${coupon.title} ${coupon.customerLabel} 사용 되돌리기`);
        button.disabled = reversalBusy;
        button.addEventListener('click', () => undoCoupon(merchantId, coupon));
        reversalButtons.push(button);
        item.append(hint, button);
      } else {
        const closed = doc.createElement('p');
        closed.className = 'reversal-meta';
        // 기한이 남았는데 되돌릴 수 없으면 본인 쿠폰(실제 점포)이라서다.
        closed.textContent = Date.parse(coupon.undoUntil) > Date.now() ? '본인 쿠폰은 되돌릴 수 없어요.' : '되돌리기 시간이 지났어요.';
        item.append(closed);
      }
      redemptionList.append(item);
    }
  };
  const refreshReversal = async (keep = {}) => {
    if (!reversalSelect || !visitList || !redemptionList) return;
    const merchantId = reversalSelect.value;
    if (!merchantId) return;
    const generation = ++reversalGeneration;
    const requestId = merchantRequests.get(doc);
    reversalButtons = [];
    if (!keep.keepVisitStatus) visitStatus.textContent = '최근 방문을 불러오는 중이에요.';
    if (!keep.keepRedemptionStatus) redemptionStatus.textContent = '최근 쿠폰 사용을 불러오는 중이에요.';
    const stale = () => generation !== reversalGeneration || merchantRequests.get(doc) !== requestId || reversalSelect.value !== merchantId;
    const [visitResult, redemptionResult] = await Promise.allSettled([
      request(fetcher, `${reversalBase(merchantId)}/recent-visits`),
      request(fetcher, `${reversalBase(merchantId)}/recent-coupon-redemptions`),
    ]);
    if (stale()) return;
    try {
      if (visitResult.status !== 'fulfilled') throw visitResult.reason;
      const value = visitResult.value;
      if (!value || !Array.isArray(value.visits) || !value.visits.every(isRecentVisit)) throw new Error('invalid visits');
      renderVisits(merchantId, value.visits);
      if (!keep.keepVisitStatus) visitStatus.textContent = value.visits.length ? `오늘 방문 ${value.visits.length}건이에요.` : '오늘 확인한 방문이 없어요.';
    } catch (error) {
      visitList.replaceChildren();
      visitStatus.textContent = error.status === 403 || error.status === 401
        ? '이 점포의 방문 목록을 볼 권한이 없어요.' : '최근 방문을 불러오지 못했어요. 다시 시도해 주세요.';
    }
    try {
      if (redemptionResult.status !== 'fulfilled') throw redemptionResult.reason;
      const value = redemptionResult.value;
      if (!value || !Array.isArray(value.coupons) || !value.coupons.every(isRecentRedemption)) throw new Error('invalid coupons');
      renderRedemptions(merchantId, value.coupons);
      if (!keep.keepRedemptionStatus) redemptionStatus.textContent = value.coupons.length ? '' : '최근 24시간 안에 사용 처리한 쿠폰이 없어요.';
    } catch (error) {
      redemptionList.replaceChildren();
      redemptionStatus.textContent = error.status === 403 || error.status === 401
        ? '이 점포의 쿠폰 사용 목록을 볼 권한이 없어요.' : '최근 쿠폰 사용을 불러오지 못했어요. 다시 시도해 주세요.';
    }
  };
  reversalRefresh?.addEventListener('click', () => refreshReversal());

  // ---- 가게 현황(#330): 선택한 점포의 요약 카드와 오픈 준비 체크리스트. 점포 선택은 최근 방문 목록과 같은 값을 쓴다. ----
  const overviewSelect = doc.getElementById('merchant-overview-merchant');
  const overviewRefresh = doc.getElementById('merchant-overview-refresh');
  const overviewStatus = doc.getElementById('merchant-overview-status');
  const overviewCards = doc.getElementById('merchant-overview-cards');
  const readinessMessage = doc.getElementById('merchant-readiness-message');
  const readinessList = doc.getElementById('merchant-readiness-list');
  let overviewGeneration = 0;
  const resetOverview = () => {
    overviewGeneration += 1;
    overviewCards?.replaceChildren();
    readinessList?.replaceChildren();
    if (readinessMessage) readinessMessage.textContent = '';
    if (overviewStatus) overviewStatus.textContent = '';
    if (overviewRefresh) overviewRefresh.disabled = false;
  };
  const textNode = (tag, className, text) => {
    const node = doc.createElement(tag);
    node.className = className;
    node.textContent = text;
    return node;
  };
  // 방문 고객 의견(#334)은 가게 현황의 점포 선택을 따른다. 공개 목록과 달리 점주에게는 모든 개수를 보여 준다.
  const feedbackStatus = doc.getElementById('merchant-feedback-status');
  const feedbackTags = doc.getElementById('merchant-feedback-tags');
  const feedbackSuggestions = doc.getElementById('merchant-feedback-suggestions');
  const feedbackNotes = doc.getElementById('merchant-feedback-notes');
  let feedbackGeneration = 0;
  const resetFeedback = () => {
    feedbackGeneration += 1;
    feedbackTags?.replaceChildren();
    feedbackSuggestions?.replaceChildren();
    feedbackNotes?.replaceChildren();
    if (feedbackStatus) feedbackStatus.textContent = '';
  };
  const isFeedbackCount = item => item !== null && typeof item === 'object'
    && typeof item.code === 'string' && typeof item.label === 'string' && isCount(item.count);
  const isFeedbackNote = item => item !== null && typeof item === 'object'
    && typeof item.customerLabel === 'string' && isDateOnly(item.date) && typeof item.text === 'string';
  const refreshFeedback = async () => {
    if (!overviewSelect || !feedbackStatus || !feedbackTags || !feedbackSuggestions || !feedbackNotes) return;
    const merchantId = overviewSelect.value;
    if (!merchantId) return;
    const generation = ++feedbackGeneration;
    const requestId = merchantRequests.get(doc);
    const stale = () => generation !== feedbackGeneration || merchantRequests.get(doc) !== requestId || overviewSelect.value !== merchantId;
    feedbackStatus.textContent = '방문 고객 의견을 불러오는 중이에요.';
    try {
      const summary = await request(fetcher, `${reversalBase(merchantId)}/visitor-feedback`);
      if (stale()) return;
      if (!summary || !Array.isArray(summary.tags) || !summary.tags.every(isFeedbackCount)
        || !Array.isArray(summary.suggestions) || !summary.suggestions.every(isFeedbackCount)
        || !Array.isArray(summary.notes) || !summary.notes.every(isFeedbackNote)) throw new Error('invalid feedback');
      feedbackTags.replaceChildren();
      feedbackTags.append(...summary.tags.map(item => textNode('li', '', `${item.label} · ${item.count}명`)));
      feedbackSuggestions.replaceChildren();
      feedbackSuggestions.append(...summary.suggestions.map(item => textNode('li', '', `${item.label} · ${item.count}명`)));
      feedbackNotes.replaceChildren();
      feedbackNotes.append(...summary.notes.map(item => {
        const [, month, day] = item.date.split('-').map(Number);
        return textNode('li', '', `${item.customerLabel} · ${month}/${day} · ${item.text}`);
      }));
      feedbackStatus.textContent = summary.tags.length || summary.suggestions.length || summary.notes.length
        ? '' : '아직 받은 의견이 없어요.';
    } catch (error) {
      if (stale()) return;
      resetFeedback();
      feedbackStatus.textContent = error.status === 403 || error.status === 401
        ? '이 점포의 현황을 볼 권한이 없어요.' : '가게 현황을 불러오지 못했어요. 다시 시도해 주세요.';
    }
  };
  // 접근 가능한 이름은 보이는 글자를 그대로 포함한다. 화면 전체에서 그 글자가 하나뿐이면 aria-label을 달지 않고,
  // 같은 글자의 링크가 여럿이면 `보이는 글자 (카드 이름)`으로 구분한다.
  const cardLink = (target, text, cardLabel) => {
    const link = doc.createElement('a');
    link.className = 'overview-card-link';
    link.setAttribute('href', target);
    if (cardLabel) link.setAttribute('aria-label', `${text} (${cardLabel})`);
    link.textContent = text;
    return link;
  };
  const overviewCard = (label, body, extras = []) => {
    const card = doc.createElement('li');
    card.className = 'overview-card';
    card.append(textNode('p', 'overview-card-label', label), ...body, ...extras);
    return card;
  };
  const valueCard = (label, value, { notes = [], link } = {}) => overviewCard(label,
    [textNode('p', 'overview-card-value', value), ...notes.map(note => textNode('p', 'overview-card-note', note))],
    link ? [cardLink(link.target, link.text, link.distinguishBy ? label : undefined)] : []);
  const visitLink = { target: '#merchant-visit-title', text: '방문 기록 보기', distinguishBy: true };
  const renderOverview = overview => {
    const { visits, comparison, campaign, readiness } = overview;
    const max = Math.max(...visits.last7Days.map(day => day.count));
    const days = doc.createElement('ol');
    days.className = 'overview-days';
    days.setAttribute('aria-label', '최근 7일 방문 수');
    for (const day of visits.last7Days) {
      const row = doc.createElement('li');
      const bar = doc.createElement('span');
      bar.className = 'overview-bar';
      bar.setAttribute('aria-hidden', 'true');
      const fill = doc.createElement('span');
      fill.className = 'overview-bar-fill';
      // CSP(style-src 'self')가 막는 것은 style 속성이다. CSSOM으로 너비만 정한다.
      fill.style.setProperty('width', `${barWidthPercent(day.count, max)}%`);
      bar.append(fill);
      row.append(textNode('span', 'overview-day', dayLabel(day.date)), bar, textNode('span', 'overview-day-count', `${day.count}건`));
      days.append(row);
    }
    const visibleStep = readiness.steps.find(step => step.key === 'visible');
    const comparisonText = overviewComparisonText(comparison);
    overviewCards.replaceChildren();
    overviewCards.append(
      valueCard('오늘 방문', `${visits.today}건`, { link: { target: visitLink.target, text: '오늘 방문 기록 보기' } }),
      valueCard('이번 주 방문', `${visits.thisWeek}건`, {
        notes: comparisonText ? [comparisonText, '지난주 같은 시각까지와 비교해요.'] : [],
        link: visitLink,
      }),
      overviewCard('최근 7일', [days], [cardLink(visitLink.target, visitLink.text, '최근 7일')]),
      valueCard('누적 방문', `${visits.total}건`, { link: visitLink }),
      valueCard('이번 주 쿠폰 사용', `${overview.couponsRedeemedThisWeek}장`, {
        link: { target: '#merchant-redemption-title', text: '쿠폰 사용 내역 보기' },
      }),
      valueCard('재방문 고객(2일 이상)', `${overview.repeatVisitors}명`, {
        notes: ['서로 다른 날 2번 이상 방문한 손님이에요. 전체 기간 기준이에요.'],
      }),
      valueCard('캠페인 상태', campaign ? campaignPhaseLabel(campaign.phase) : '캠페인 없음', {
        notes: [
          ...(campaign ? [`${campaign.title} · ${monthDayLabel(campaign.startsAt)}부터 ${monthDayLabel(campaign.endsAt)}까지`] : []),
          '캠페인 변경은 운영팀에 요청해 주세요.',
        ],
      }),
      valueCard('고객 앱 공개', visibleStep?.state === 'DONE' ? '고객 앱에 보여요'
        : visibleStep?.state === 'WAITING_APPROVAL' ? '운영팀 승인 대기' : '아직 안 보여요', { notes: [readiness.message] }),
    );
    // API 추가 배포 전에는 0으로 꾸미지 않고 새 항목만 아직 집계되지 않았다고 알린다.
    overviewCards.append(
      valueCard('이번 주 첫 방문 / 재방문', overview.weekVisitors
        ? `${overview.weekVisitors.first}건 / ${overview.weekVisitors.repeat}건` : '집계 준비 중', {
        notes: ['방문 인증 기준이며 매출과 다를 수 있어요', '한국 시간 이번 주 기준이에요. 이전 날짜에 이 가게 방문 인증이 있으면 재방문, 없으면 첫 방문으로 세요. 사람 수가 아니라 방문 건수예요.'],
      }),
      overviewCard('이번 주 받은 수집품(등급별)', overview.weekCollectibles === undefined
        ? [textNode('p', 'overview-card-note', '집계 준비 중')]
        : overview.weekCollectibles.length === 0 ? [textNode('p', 'overview-card-note', '이번 주 받은 수집품이 없어요.')]
          : overview.weekCollectibles.map(grade => textNode('p', 'overview-card-note', `${grade.gradeName} ${grade.count}개`))),
      valueCard('쿠폰 발급·사용(이번 주)', overview.weekCoupons
        ? `발급 ${overview.weekCoupons.issued}장 · 사용 ${overview.weekCoupons.redeemed}장` : '집계 준비 중', {
        notes: ['이번 주 발급한 쿠폰과 이번 주 사용한 쿠폰을 각각 세요. 이전 주에 발급된 쿠폰 사용도 포함해요.'],
      }),
      valueCard('가게 상세 조회(이번 주)', overview.weekDetailViews === undefined ? '집계 준비 중' : `${overview.weekDetailViews}회`, {
        notes: ['조회는 사람 수가 아니라 열람 횟수예요(조회와 방문은 같은 사람으로 연결하지 않아요)'],
      }),
    );
    readinessMessage.textContent = readiness.message;
    readinessList.replaceChildren();
    readinessList.append(...readiness.steps.map(step => {
      const item = doc.createElement('li');
      item.className = 'readiness-step';
      const badge = textNode('span', `readiness-badge readiness-${step.state.toLowerCase().replaceAll('_', '-')}`, readinessStateLabel(step.state));
      item.append(textNode('span', 'readiness-label', step.label), badge);
      if (step.hint) item.append(textNode('span', 'readiness-hint', step.hint));
      if (step.state !== 'DONE') {
        const merchant = merchantMemberships.get(doc)?.find(member => member.id === overviewSelect.value);
        if (step.key === 'members') {
          const link = cardLink('#merchant-registration-title', '직원 등록 요청으로 이동');
          link.className = 'collection-action secondary readiness-action';
          item.append(link);
        } else if (step.key === 'reward' && merchant && canCreate(merchant)) {
          const button = doc.createElement('button');
          button.type = 'button'; button.className = 'readiness-action'; button.textContent = '수집품 만들기';
          button.addEventListener('click', async () => {
            const select = doc.getElementById('merchant-creator-store');
            const opener = doc.getElementById('merchant-creator-open');
            if (!select || !opener || opener.disabled) return;
            const previous = select.value;
            select.value = merchant.id;
            select.onchange?.();
            if (select.value !== merchant.id) return;
            button.disabled = true;
            try {
              await opener.onclick?.();
              if (creatorStores.get(doc) === merchant.id) jumpTo(doc.getElementById('merchant-creator-title'));
              else select.value = previous;
            } finally { button.disabled = false; }
          });
          item.append(button);
        } else {
          const button = doc.createElement('button');
          button.type = 'button'; button.className = 'readiness-action secondary';
          button.textContent = '운영팀에 보낼 내용 복사';
          const notice = textNode('p', 'readiness-copy-status', '');
          notice.setAttribute('role', 'status'); notice.setAttribute('aria-live', 'polite');
          const label = doc.createElement('label'); label.className = 'readiness-copy-fallback'; label.hidden = true;
          label.append(textNode('span', '', '운영팀에 보낼 내용(선택해서 복사)'));
          const fallback = doc.createElement('textarea'); fallback.readOnly = true;
          label.append(fallback);
          button.addEventListener('click', async () => {
            if (button.disabled || !merchant) return;
            const generation = overviewGeneration;
            const requestId = merchantRequests.get(doc);
            const text = readinessRequestText(merchant, step, readiness.steps);
            button.disabled = true; label.hidden = true;
            try {
              const clipboard = doc.defaultView?.navigator?.clipboard ?? globalThis.navigator?.clipboard;
              if (!clipboard?.writeText) throw new Error('clipboard unavailable');
              await clipboard.writeText(text);
              if (generation !== overviewGeneration || requestId !== merchantRequests.get(doc)) return;
              notice.textContent = `복사했어요. 운영팀 ${operatorContact}으로 보내 주세요.`;
            } catch {
              if (generation !== overviewGeneration || requestId !== merchantRequests.get(doc)) return;
              fallback.value = text; label.hidden = false;
              notice.textContent = `자동 복사를 사용할 수 없어요. 아래 내용을 선택해 복사한 뒤 운영팀 ${operatorContact}으로 보내 주세요.`;
              fallback.focus(); fallback.select?.();
            } finally { button.disabled = false; }
          });
          item.append(button, notice, label);
        }
      }
      return item;
    }));
  };
  const refreshOverview = async () => {
    if (!overviewSelect || !overviewCards || !readinessList || !readinessMessage || !overviewStatus) return;
    const merchantId = overviewSelect.value;
    if (!merchantId) return;
    const generation = ++overviewGeneration;
    const requestId = merchantRequests.get(doc);
    const stale = () => generation !== overviewGeneration || merchantRequests.get(doc) !== requestId || overviewSelect.value !== merchantId;
    overviewStatus.textContent = '가게 현황을 불러오는 중이에요.';
    if (overviewRefresh) overviewRefresh.disabled = true;
    try {
      const overview = await request(fetcher, `${reversalBase(merchantId)}/overview`);
      if (stale()) return;
      if (!isOverview(overview)) throw new Error('invalid overview');
      renderOverview(overview);
      overviewStatus.textContent = `${businessDateLabel(overview.businessDate)} 기준으로 센 값이에요.`;
    } catch (error) {
      if (stale()) return;
      overviewCards.replaceChildren();
      readinessList.replaceChildren();
      readinessMessage.textContent = '';
      overviewStatus.textContent = error.status === 403 || error.status === 401
        ? '이 점포의 현황을 볼 권한이 없어요.' : '가게 현황을 불러오지 못했어요. 다시 시도해 주세요.';
    } finally {
      if (generation === overviewGeneration && overviewRefresh) overviewRefresh.disabled = false;
    }
  };
  overviewRefresh?.addEventListener('click', () => {
    void refreshFeedback();
    return refreshOverview();
  });
  // 점포를 바꾸면 이전 점포 현황을 지우고 새 점포 현황을 바로 읽는다. 최근 방문 목록의 점포도 같은 값으로 맞춘다.
  overviewSelect?.addEventListener('change', () => {
    resetOverview();
    resetFeedback();
    void refreshFeedback();
    if (reversalSelect) {
      reversalSelect.value = overviewSelect.value;
      resetReversal();
      void refreshReversal();
    }
    return refreshOverview();
  });
  // 점포를 바꾸면 이전 점포 목록을 지우고 새 점포 목록을 바로 읽는다. 가게 현황도 같은 점포로 따라간다.
  reversalSelect?.addEventListener('change', () => {
    resetReversal();
    void refreshReversal();
    if (overviewSelect) {
      overviewSelect.value = reversalSelect.value;
      resetOverview();
      resetFeedback();
      void refreshFeedback();
      void refreshOverview();
    }
  });
  reversalRefreshers.set(doc, () => refreshReversal());
  overviewRefreshers.set(doc, () => refreshOverview());
  feedbackRefreshers.set(doc, () => refreshFeedback());
  claimForm.addEventListener('submit', async event => {
    event.preventDefault();
    if (issuing || couponBusy) return;
    const resolved = merchantClaimResolutions.get(doc);
    if (!resolved || !claimConfirm.checked || resolved.merchantId !== claimMerchant.value ||
        resolved.token !== claimToken.value.trim() || !claimReference.value.trim()) return;
    const requestId = merchantRequests.get(doc);
    stopCamera();
    setIssuing(true);
    resetCoupons();
    try {
      const issued = await request(fetcher,
        `/api/web/merchant/merchants/${encodeURIComponent(resolved.merchantId)}/claim-slots`,
        'POST', { customerIdentityToken: resolved.token,
          merchantReference: claimReference.value.trim(), useConfirmed: true });
      if (merchantRequests.get(doc) !== requestId) return;
      claimResult.textContent = issued.replayed
        ? '이미 처리한 요청입니다. 기존 방문 코드는 다시 표시되지 않습니다. 아래에서 새 코드를 발급할 수 있습니다.' : '';
      claimToken.value = '';
      invalidateClaim();
      if (!issued.replayed) showToken(issued);
      showSlot(issued, resolved.merchantId);
    } catch (error) {
      if (merchantRequests.get(doc) === requestId) {
        claimResult.textContent = error.code === 'CUSTOMER_IDENTITY_EXPIRED'
          ? '고객 QR이 만료되었습니다. 고객에게 새 QR을 요청해 주세요.'
          : '방문 코드 결과를 확인하지 못했습니다. 실제 이용을 다시 확인한 뒤 같은 요청으로 재시도해 주세요.';
        claimConfirm.checked = false;
        claimSubmit.disabled = true;
        if (error.code === 'CUSTOMER_IDENTITY_EXPIRED' || error.code === 'CUSTOMER_IDENTITY_UNAVAILABLE') {
          invalidateClaim();
        }
      }
    } finally {
      if (merchantRequests.get(doc) === requestId) setIssuing(false);
    }
  });
  reissueSubmit.addEventListener('click', async () => {
    if (issuing || !reissueConfirm.checked) return;
    const slot = merchantClaimSlots.get(doc);
    if (!slot) return;
    const requestId = merchantRequests.get(doc);
    setIssuing(true);
    claimQr.src = '';
    claimQr.hidden = true;
    claimResult.textContent = '새 방문 코드 발급 결과를 기다리는 중입니다.';
    try {
      const issued = await request(fetcher,
        `/api/web/merchant/merchants/${encodeURIComponent(slot.merchantId)}/claim-slots/${encodeURIComponent(slot.claimSlotId)}/reissue`,
        'POST', { expectedTokenVersion: slot.tokenVersion });
      if (merchantRequests.get(doc) !== requestId) return;
      showToken(issued);
      showSlot(issued, slot.merchantId);
    } catch (error) {
      if (merchantRequests.get(doc) !== requestId) return;
      clearSlot();
      claimResult.textContent = error.status === 401 || error.status === 403
        ? '점포 권한을 확인하지 못했습니다. 다시 로그인해 주세요.'
        : error.status === 409
          ? '방문 코드를 재발급할 수 없습니다. 현재 상태를 확인해 주세요.'
          : '재발급 결과를 확인하지 못했습니다. 이전 코드의 유효 여부도 알 수 없습니다. 현재 상태를 확인해 주세요.';
    } finally {
      if (merchantRequests.get(doc) === requestId) setIssuing(false);
    }
  });
  doc.getElementById('merchant-registration')?.addEventListener('submit', async event => {
    event.preventDefault();
    const form = event.currentTarget;
    const button = form.querySelector('button');
    button.disabled = true;
    code.textContent = '';
    const requestId = merchantRequests.get(doc);
    try {
      const issued = await request(fetcher, '/api/web/merchant/registration-requests', 'POST', {
        merchantId: form.querySelector('select').value,
      });
      if (merchantRequests.get(doc) !== requestId) return;
      code.textContent = `등록 코드: ${issued.code} · 만료: ${new Date(issued.expiresAt).toLocaleTimeString('ko-KR')}`;
      status.textContent = '등록 코드를 확인된 경로로 관리자에게 전달해 주세요.';
    } catch {
      if (merchantRequests.get(doc) === requestId) status.textContent = '등록 코드를 발급하지 못했습니다.';
    } finally {
      if (merchantRequests.get(doc) === requestId) button.disabled = false;
    }
  });
  doc.getElementById('merchant-logout')?.addEventListener('click', async () => {
    // 로그아웃: 같은 기기를 다른 계정이 바로 이어 쓸 수 있으므로, 이 계정이 기기에 남긴 자동 저장 보관본을 지운다.
    closeCreator(doc);
    clearDrafts(creatorScopes.get(doc));
    creatorScopes.delete(doc);
    stopCamera();
    merchantRequests.set(doc, (merchantRequests.get(doc) ?? 0) + 1);
    doc.getElementById('merchant-content').hidden = true;
    doc.getElementById('merchant-memberships').replaceChildren();
    code.textContent = '';
    claimToken.value = '';
    claimReference.value = '';
    claimResult.textContent = '';
    invalidateClaim();
    clearSlot();
    resetReversal();
    resetOverview();
    resetFeedback();
    setIssuing(false);
    try {
      await request(fetcher, '/api/web/logout', 'POST');
      await loadMerchant(fetcher, doc);
    } catch { status.textContent = '로그아웃을 확인하지 못했습니다.'; }
  });
  const clear = () => {
    stopCamera();
    merchantRequests.set(doc, (merchantRequests.get(doc) ?? 0) + 1);
    doc.getElementById('merchant-content').hidden = true;
    doc.getElementById('merchant-memberships').replaceChildren();
    code.textContent = '';
    claimToken.value = '';
    claimReference.value = '';
    claimResult.textContent = '';
    invalidateClaim();
    clearSlot();
    resetReversal();
    resetOverview();
    resetFeedback();
    setIssuing(false);
  };
  // 페이지 안 이동은 제작기 뒤로가기 이력을 늘리지 않고 스크롤과 초점만 옮긴다.
  function jumpTo(target) {
    if (!target) return;
    if (target.tabIndex < 0 && !target.hasAttribute('tabindex')) {
      target.setAttribute('tabindex', '-1');
      target.addEventListener('blur', () => target.removeAttribute('tabindex'), { once: true });
    }
    target.scrollIntoView({ block: 'start' });
    target.focus({ preventScroll: true });
  }
  doc.addEventListener?.('click', event => {
    if (event.ctrlKey || event.metaKey || event.shiftKey || event.altKey || event.button !== 0) return;
    const anchor = event.target.closest?.('a[href^="#"]');
    const href = anchor?.getAttribute('href');
    if (!href || href.length <= 1) return;
    event.preventDefault();
    const target = doc.getElementById(href.slice(1));
    jumpTo(target);
  });
  doc.defaultView?.addEventListener('pagehide', () => { closeCreator(doc); creatorScopes.delete(doc); clear(); });
  doc.defaultView?.addEventListener('pageshow', event => {
    if (event.persisted) { invalidateClaim(); clearSlot(); void loadMerchant(fetcher, doc); }
  });
  doc.addEventListener?.('visibilitychange', () => {
    if (doc.hidden) clear();
    else { invalidateClaim(); clearSlot(); void loadMerchant(fetcher, doc); }
  });
  return loadMerchant(fetcher, doc);
}

if (typeof document !== 'undefined') void bindMerchant(fetch, document);
