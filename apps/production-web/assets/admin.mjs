import { campaignTiming, extendedCampaignEnd, orderedCampaigns } from './commercial-operation.mjs';
import { mountRealWorldAdmin } from './real-world-merchant.mjs';
import { benefitStatusRecords, campaignBenefitsStatusText } from './campaign-benefit-status.mjs';

const endpoint = '/api/web/admin/merchants';
const deletionEndpoint = '/api/web/admin/account-deletion-intakes';
const offerEndpoint = '/api/web/admin/reward-offers';
const campaignEndpoint = '/api/web/admin/campaigns';
const courseEndpoint = '/api/web/admin/courses';
const adminRequests = new WeakMap();
const funnelRequests = new WeakMap();
const playMetricRequests = new WeakMap();
const realWorldCleanups = new WeakMap();
const courseMerchants = new WeakMap();
function clearRealWorld(doc) {
  realWorldCleanups.get(doc)?.();
  realWorldCleanups.delete(doc);
}

// 점포 공개·점주·보상 혜택·캠페인(Issue #246). 참조 번호는 서버(store-go-live-rules.ts)와 같은 규칙을 먼저 알려 주고
// 최종 판단은 서버가 한다. 동의서·확인 기록 자체와 사업자등록번호·이름·전화번호는 받지 않는다.
export const referenceHint = '영문·숫자로 시작하는 3~40자(영문·숫자·., _, -)예요. 하이픈·점·밑줄로 끊어도 숫자는 합쳐서 세므로 영문자 없이 이어지는 숫자는 모두 합쳐 7자리까지예요(예: CS-2609-01). 사업자등록번호·전화번호·이름·이메일·웹 주소는 적지 마세요.';

export function documentReferenceProblem(value) {
  const reference = String(value ?? '').trim();
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]{2,39}$/.test(reference) || /\d{8}/.test(reference.replace(/[^A-Za-z0-9]/g, ''))) {
    return `참조 번호를 확인해 주세요. ${referenceHint}`;
  }
  return null;
}

export function courseDraftPayload(data) {
  const stepCount = Number(data.get('stepCount'));
  if (!Number.isInteger(stepCount) || stepCount < 2 || stepCount > 4) throw localError('코스는 2~4곳을 선택해 주세요.');
  const steps = Array.from({ length: stepCount }, (_, index) => {
    const position = index + 1;
    const ownerOptinRef = String(data.get(`ownerOptinRef${position}`) ?? '').trim();
    const problem = documentReferenceProblem(ownerOptinRef);
    if (problem) throw localError(`${position}번 가게: ${problem}`);
    return {
      merchantId: String(data.get(`merchantId${position}`) ?? ''),
      targetVisitCount: Number(data.get(`targetVisitCount${position}`)),
      pieceKey: String(data.get(`pieceKey${position}`) ?? '').trim(),
      pieceLabel: String(data.get(`pieceLabel${position}`) ?? '').trim(),
      ownerOptinRef,
    };
  });
  if (steps.some(step => !step.merchantId || ![1, 3, 5].includes(step.targetVisitCount) ||
    !/^[a-z0-9-]{1,40}$/.test(step.pieceKey) || !step.pieceLabel || step.pieceLabel.length > 20) ||
    new Set(steps.map(step => step.merchantId)).size !== steps.length) {
    throw localError('각 단계의 서로 다른 가게·목표·조각 키·이름을 확인해 주세요.');
  }
  const date = name => {
    const value = String(data.get(name) ?? '').trim();
    if (!value) return null;
    const parsed = new Date(value);
    if (!Number.isFinite(parsed.getTime())) throw localError('코스 날짜와 시각을 확인해 주세요.');
    return parsed.toISOString();
  };
  return { title: String(data.get('title') ?? '').trim(), situation: String(data.get('situation') ?? ''),
    sceneKey: String(data.get('sceneKey') ?? '').trim(), startsAt: date('startsAt'), endsAt: date('endsAt'),
    countsFrom: date('countsFrom'), steps };
}

// 공개 전에 채워 저장해야 하는 항목(서버의 ADMIN_MERCHANT_NOT_READY와 같은 기준).
export function missingForPublish(merchant) {
  const missing = [];
  if (!Array.isArray(merchant.menuItems) || merchant.menuItems.length === 0) missing.push('메뉴');
  if (!String(merchant.businessHours ?? '').trim()) missing.push('영업시간');
  if (!String(merchant.roadAddress ?? '').trim()) missing.push('도로명 주소');
  return missing;
}

// 동네·업종(Issue #254). 공개 NFT 메타데이터에 들어가고 공개 조건과는 무관하다. 규칙은 서버(merchant-profile-rules.ts)·DB CHECK와 같고
// 최종 판단은 서버가 한다.
export const merchantCategories = ['한식', '중식', '일식', '양식', '분식', '카페', '베이커리', '주점', '기타'];
export const neighborhoodHint = '행정동 이름만 적어요(예: 월계동, 월계1동, 상계3·4동). 도로명·번지는 적지 않아요. 동네·업종은 NFT 공개 정보(메타데이터)에 들어가고, 이미 발행한 NFT에는 발행 때 값이 그대로 남아요.';

export function neighborhoodProblem(value) {
  const neighborhood = String(value ?? '').trim();
  if (!neighborhood) return null;
  if (!/^[가-힣][가-힣0-9·]{0,8}[동가리]$/.test(neighborhood) || /[0-9]{3}/.test(neighborhood)) {
    return `동네를 확인해 주세요. ${neighborhoodHint}`;
  }
  return null;
}

function localError(message) {
  const error = new Error(message);
  error.local = true;
  return error;
}

const goLiveMessages = {
  ADMIN_DOCUMENT_REF_INVALID: `참조 번호를 확인해 주세요. ${referenceHint}`,
  ADMIN_MERCHANT_NOT_READY: '메뉴·영업시간·도로명 주소를 먼저 채워 저장한 뒤 공개해 주세요.',
  ADMIN_MERCHANT_ALREADY_ACTIVE: '이미 공개된 점포예요. 새로고침해 주세요.',
  ADMIN_VERSION_CONFLICT: '다른 변경이 먼저 저장되었습니다. 새로고침해 주세요.',
  ADMIN_MERCHANT_NOT_ACTIVE: '공개 중인 점포에서만 할 수 있어요. 점포를 먼저 공개해 주세요.',
  ADMIN_MERCHANT_NOT_FOUND: '점포를 찾을 수 없어요. 시연 점포는 대상이 아니에요.',
  ADMIN_SELF_ROLE_CHANGE: '본인 계정은 점주로 올리거나 내릴 수 없어요. 다른 관리자가 처리해야 해요.',
  ADMIN_MEMBER_NOT_FOUND: '이 점포의 활성 직원(또는 점주)이 아니에요. 새로고침해 주세요.',
  ADMIN_ALREADY_OWNER: '이미 점주예요. 새로고침해 주세요.',
  ADMIN_OWNER_LIMIT: '점주는 점포당 2명까지예요. 먼저 한 명을 직원으로 내려 주세요.',
  ADMIN_CONSENT_INCOMPLETE: '점주 동의 5항목을 모두 확인해 주세요.',
  ADMIN_OFFER_MILESTONE_TAKEN: '이 상자에는 이미 활성 혜택이 있어요. 먼저 그 혜택을 멈춰 주세요.',
  ADMIN_OFFER_NOT_FOUND: '혜택을 찾을 수 없어요. 새로고침해 주세요.',
  ADMIN_CAMPAIGN_NOT_PUBLISHABLE: '목표가 없거나 종료 시각이 지난 캠페인은 공개할 수 없어요.',
  ADMIN_CAMPAIGN_NOT_PAUSABLE: '공개 중인 캠페인만 중지할 수 있어요.',
  ADMIN_CAMPAIGN_ACTIVE_EXISTS: '이 점포에는 이미 공개 중인 캠페인이 있어요. 먼저 그 캠페인을 중지해 주세요.',
  ADMIN_CAMPAIGN_NOT_FOUND: '캠페인을 찾을 수 없어요. 새로고침해 주세요.',
  ADMIN_INVALID_INPUT: '입력값을 확인해 주세요.',
  COURSE_INVALID_INPUT: '코스 이름·상황·장면 키·단계 입력을 확인해 주세요.',
  COURSE_NOT_FOUND: '코스를 찾을 수 없어요. 목록을 새로 불러와 주세요.',
  COURSE_STATE_CONFLICT: '코스 상태가 먼저 바뀌었습니다. 목록을 새로 불러와 주세요.',
  COURSE_NOT_PUBLISHABLE: '코스를 공개할 수 없어요. 최근 점검 결과와 모든 단계의 점주 참여 동의 참조 번호를 확인해 주세요.',
  ADMIN_OFFER_TEXT_INVALID: '혜택 이름·설명에 이메일·웹 주소·전화번호처럼 보이는 내용(숫자 8자리 이상 포함)이나 보이지 않는 글자는 쓸 수 없어요.',
  WEB_SESSION_REAUTH_REQUIRED: '점주 올리기·내리기는 10분 안에 한 로그인이 필요해요. 로그아웃한 뒤 관리자 계정으로 다시 로그인해 주세요.',
};

export function campaignExtensionMessage(error) {
  if (error?.code === 'ADMIN_VERSION_CONFLICT') return '다른 곳에서 먼저 바뀌었어요. 목록을 새로 불러왔어요.';
  if (error?.code === 'ADMIN_CAMPAIGN_EXTENSION_LIMIT') {
    return '종료일은 오늘부터 365일을 넘길 수 없어요.';
  }
  if (error?.code === 'ADMIN_CAMPAIGN_NOT_EXTENDABLE') return '초안이거나 이미 종료 처리된 캠페인은 연장할 수 없어요.';
  if (error?.code === 'ADMIN_CAMPAIGN_ACTIVE_EXISTS') return '이 점포에는 이미 공개 중인 캠페인이 있어요. 먼저 그 캠페인을 중지해 주세요.';
  return goLiveMessage(error, '캠페인을 연장하지 못했습니다. 잠시 후 다시 시도해 주세요.');
}

export function goLiveMessage(error, fallback) {
  if (error?.local === true) return error.message;
  if (error?.code === 'WEB_SESSION_REAUTH_REQUIRED') return goLiveMessages.WEB_SESSION_REAUTH_REQUIRED;
  if (error?.status === 401 || error?.code === 'ADMIN_FORBIDDEN') return '관리자 권한을 확인하지 못했어요. 다시 로그인해 주세요.';
  return goLiveMessages[error?.code] ?? fallback;
}

const consentFields = [
  ['benefit', 'consentBenefit'], ['ownerPaysCost', 'consentOwnerPaysCost'], ['validity', 'consentValidity'],
  ['issuanceCap', 'consentIssuanceCap'], ['duplicateUse', 'consentDuplicateUse'],
];

export function rewardOfferPayload(data) {
  const milestone = Number(data.get('milestone'));
  if (![1, 2, 3].includes(milestone)) throw localError('상자를 골라 주세요.');
  const title = String(data.get('title') ?? '').trim();
  if (!title || [...title].length > 40) throw localError('혜택 이름은 1~40자로 입력해 주세요.');
  // 서버는 줄바꿈·탭 같은 제어 문자를 거절하므로 한 칸 띄어쓰기로 바꿔 한 줄로 저장한다(입력 칸 안내에 적어 둠).
  const detail = String(data.get('detail') ?? '').replace(/\s*\p{Cc}+\s*/gu, ' ').trim();
  if ([...detail].length > 120) throw localError('혜택 설명은 120자까지 입력해 주세요.');
  const validDays = Number(data.get('validDays'));
  if (!Number.isSafeInteger(validDays) || validDays < 1 || validDays > 365) {
    throw localError('유효 기간은 1~365일 사이 정수로 입력해 주세요.');
  }
  const issuanceCap = Number(data.get('issuanceCap'));
  if (!Number.isSafeInteger(issuanceCap) || issuanceCap < 1 || issuanceCap > 10_000) {
    throw localError('발급 상한은 1~10,000장 사이 정수로 입력해 주세요.');
  }
  const consent = {};
  for (const [key, field] of consentFields) {
    if (data.get(field) !== 'on') throw localError('점주 동의 5항목을 모두 확인해 주세요.');
    consent[key] = true;
  }
  const consentDocumentRef = String(data.get('consentDocumentRef') ?? '').trim();
  const problem = documentReferenceProblem(consentDocumentRef);
  if (problem) throw localError(problem);
  return { merchantId: String(data.get('merchantId') ?? ''), milestone, title, detail, validDays, issuanceCap,
    consentDocumentRef, consent };
}

export function campaignBenefitPayload(data) {
  const title = String(data.get('title') ?? '').trim();
  if (!title || [...title].length > 40) throw localError('혜택 이름은 1~40자로 입력해 주세요.');
  const detail = String(data.get('detail') ?? '').replace(/\s*\p{Cc}+\s*/gu, ' ').trim();
  if ([...detail].length > 120) throw localError('혜택 설명은 120자까지 입력해 주세요.');
  const integer = (name, min, max, label) => {
    const raw = String(data.get(name) ?? '');
    const value = Number(raw);
    if (!/^\d+$/.test(raw) || !Number.isSafeInteger(value) || value < min || value > max) {
      throw localError(`${label}은 ${min.toLocaleString('ko-KR')}~${max.toLocaleString('ko-KR')} 사이 정수로 입력해 주세요.`);
    }
    return value;
  };
  const validDays = integer('validDays', 1, 60, '유효 기간');
  const unitExtraCostWon = integer('unitExtraCostWon', 1, 1_000_000, '1장당 추가 원가');
  const maxUses = integer('maxUses', 1, 10_000, '발급 상한');
  const consent = {};
  for (const [key, field] of consentFields) {
    if (data.get(field) !== 'on') throw localError('점주 동의 5항목을 모두 확인해 주세요.');
    consent[key] = true;
  }
  const consentDocumentRef = String(data.get('consentDocumentRef') ?? '').trim();
  const problem = documentReferenceProblem(consentDocumentRef);
  if (problem) throw localError(problem);
  return { title, detail, validDays, unitExtraCostWon, maxUses, consentDocumentRef, consent };
}

const milestoneLabels = { 1: '첫 번째 상자', 2: '두 번째 상자', 3: '황금 상자' };
const campaignStatusLabels = { ACTIVE: '공개 중', PAUSED: '중지됨', ENDED: '종료', DRAFT: '비공개 초안' };
const demotionReasons = [
  ['OWNER_REQUEST', '점주가 요청했어요'],
  ['OWNERSHIP_CHANGED', '대표·운영자가 바뀌었어요'],
  ['VERIFICATION_FAILED', '확인 결과가 맞지 않아요'],
  ['OTHER', '기타'],
];

// 되돌리기 어려운 관리자 동작은 쿠폰 무효화처럼 확인창에서 동의해야 보낸다.
function confirmed(doc, message) {
  return doc.defaultView?.confirm?.(message) === true;
}

// 점주를 올리거나 내린 뒤 목록을 다시 그려도 열어 둔 점주 목록은 다시 연다(문서별 점포 id 집합).
const openOwnerPanels = new WeakMap();

function labelled(doc, text, control) {
  const wrapper = doc.createElement('label');
  wrapper.textContent = `${text} `;
  wrapper.append(control);
  return wrapper;
}

function referenceInput(doc, name, accessibleName) {
  const input = doc.createElement('input');
  input.name = name;
  input.maxLength = 40;
  input.required = true;
  input.autocomplete = 'off';
  input.setAttribute('aria-label', accessibleName);
  return input;
}

async function jsonRequest(fetcher, path, method = 'GET', body) {
  const response = await fetcher(path, {
    method, credentials: 'same-origin', cache: 'no-store',
    headers: body === undefined ? { Accept: 'application/json' } : {
      Accept: 'application/json', 'Content-Type': 'application/json',
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  if (!response.ok) {
    const error = new Error('admin request failed');
    error.status = response.status;
    try { error.code = (await response.json()).code; } catch { /* Keep the status when no JSON body is available. */ }
    throw error;
  }
  return response.json();
}

export async function loadAdminBenefit(fetcher, doc, requestId = adminRequests.get(doc)) {
  const select = doc.getElementById('admin-benefit-campaign');
  const status = doc.getElementById('admin-benefit-status');
  const form = doc.getElementById('admin-benefit-form');
  const pause = doc.getElementById('admin-benefit-pause');
  if (!select || !status || !form || !pause) return;
  form.hidden = true;
  pause.hidden = true;
  if (!select.value) { status.textContent = '확인할 캠페인이 없습니다.'; return; }
  const campaignId = select.value;
  status.textContent = '혜택 현황을 불러오는 중이에요.';
  try {
    const result = await jsonRequest(fetcher, `${campaignEndpoint}/${encodeURIComponent(campaignId)}/benefit-status`);
    if (adminRequests.get(doc) !== requestId || select.value !== campaignId) return;
    const benefits = benefitStatusRecords(result);
    status.textContent = campaignBenefitsStatusText(result);
    form.hidden = benefits.some(benefit => benefit.status === 'ACTIVE');
    if (!form.hidden) form.reset();
    pause.hidden = !form.hidden;
  } catch {
    if (adminRequests.get(doc) === requestId && select.value === campaignId) status.textContent = '혜택 현황을 불러오지 못했습니다.';
  }
}

const funnelTotals = [
  ['detailViews', '상세 조회'], ['countedVisits', '방문'], ['newVisitors', '새 방문자'],
  ['newVisitorsWithSecondStore', '그중 두 번째 가게 방문'], ['repeatVisitors', '재방문자'],
];
const funnelColumns = [
  ['name', '가게'], ['detailViews', '상세 조회'], ['countedVisits', '방문'],
  ['uniqueVisitors', '방문자'], ['repeatVisitors', '재방문자'], ['couponsIssued', '쿠폰 발급'],
  ['couponsRedeemed', '쿠폰 사용'], ['collectiblesAcquired', '받은 수집품'],
];
const countText = value => new Intl.NumberFormat('ko-KR').format(value);
const validCount = value => Number.isSafeInteger(value) && value >= 0;
const playEventLabels = [
  ['game_started', '놀이 시작'], ['game_completed', '놀이 완료'], ['studio_saved', '내 공간 저장'],
  ['share_opened', '공유 화면 완료 알림'], ['image_created', '이미지 생성 완료 알림'],
];
const playGameLabels = [
  ['stack', '타이밍 쌓기'], ['memory', '짝 찾기'], ['delivery', '세 갈래 배달'], ['orders', '주문 맞추기'],
];

function ensurePlayMetricsPanel(doc) {
  const funnel = doc.getElementById('admin-funnel');
  if (!funnel || doc.getElementById('admin-play-metrics')) return;
  const section = doc.createElement('section'); section.id = 'admin-play-metrics';
  const heading = doc.createElement('h4'); heading.textContent = '놀이·공유 이용';
  const help = doc.createElement('p'); help.textContent = '선택한 기간의 익명 처리 횟수예요. 방문·쿠폰 집계와 별개이며, 공유와 이미지 생성은 앱이 보낸 완료 알림이에요. 외부 게시나 매출을 뜻하지 않아요.';
  const status = doc.createElement('p'); status.id = 'admin-play-status'; status.setAttribute('role', 'status'); status.setAttribute('aria-live', 'polite');
  const events = doc.createElement('dl'); events.id = 'admin-play-events'; events.className = 'admin-funnel-totals';
  const games = doc.createElement('div'); games.id = 'admin-play-games';
  section.append(heading, help, status, events, games); funnel.append(section);
}

export async function loadAdminPlayMetrics(fetcher, doc, current = () => true) {
  const days = doc.getElementById('admin-funnel-days')?.value;
  const status = doc.getElementById('admin-play-status');
  const events = doc.getElementById('admin-play-events');
  const games = doc.getElementById('admin-play-games');
  if (!days || !status || !events || !games) return;
  const requestId = (playMetricRequests.get(doc) ?? 0) + 1;
  playMetricRequests.set(doc, requestId);
  const latest = () => current() && playMetricRequests.get(doc) === requestId;
  events.replaceChildren(); games.replaceChildren(); status.textContent = '놀이 이용을 불러오는 중이에요.';
  try {
    const payload = await jsonRequest(fetcher, `/api/web/admin/play/metrics?days=${days}`);
    if (!latest()) return;
    if (payload?.days !== Number(days) || !Array.isArray(payload.events) || !Array.isArray(payload.games)
      || !payload.events.every(item => playEventLabels.some(([event]) => event === item?.event) && validCount(item.count))
      || !payload.games.every(item => playGameLabels.some(([kind]) => kind === item?.kind)
        && validCount(item.started) && validCount(item.completed))) throw new Error('invalid play metrics');
    for (const [event, label] of playEventLabels) {
      const row = doc.createElement('div'), term = doc.createElement('dt'), count = doc.createElement('dd');
      term.textContent = label; count.textContent = countText(payload.events.find(item => item.event === event)?.count ?? 0);
      row.append(term, count); events.append(row);
    }
    for (const [kind, label] of playGameLabels) {
      const item = payload.games.find(game => game.kind === kind);
      const line = doc.createElement('p'); line.textContent = `${label}: 시작 ${countText(item?.started ?? 0)}회 · 완료 ${countText(item?.completed ?? 0)}회`;
      games.append(line);
    }
    status.textContent = `최근 ${days}일의 기록된 사건입니다.`;
  } catch (error) {
    if (!latest()) return;
    events.replaceChildren(); games.replaceChildren();
    status.textContent = error.status === 401 || error.status === 403
      ? '관리자 권한을 확인하지 못했어요. 다시 로그인해 주세요.' : '놀이 이용을 불러오지 못했어요.';
    if (error.status === 401 || error.status === 403) throw error;
  }
}

// 관리자 본문을 읽은 뒤에만 호출한다. 기간 선택과 전체 새로고침은 서로의 늦은 응답을 무효화한다.
export async function loadAdminFunnel(fetcher, doc, current = () => true) {
  const days = doc.getElementById('admin-funnel-days')?.value;
  const status = doc.getElementById('admin-funnel-status');
  const totals = doc.getElementById('admin-funnel-totals');
  const table = doc.getElementById('admin-funnel-table');
  if (!days || !status || !totals || !table) return;
  const requestId = (funnelRequests.get(doc) ?? 0) + 1;
  funnelRequests.set(doc, requestId);
  const latest = () => current() && funnelRequests.get(doc) === requestId;
  totals.replaceChildren();
  table.replaceChildren();
  status.textContent = '흐름 지표를 불러오는 중이에요.';
  try {
    const payload = await jsonRequest(fetcher, `/api/web/admin/funnel?days=${days}`);
    if (!latest()) return;
    if (payload?.days !== Number(days) || !/^\d{4}-\d{2}-\d{2}$/.test(payload.from)
      || !/^\d{4}-\d{2}-\d{2}$/.test(payload.to)
      || !payload.totals || !funnelTotals.every(([key]) => validCount(payload.totals[key]))
      || !Array.isArray(payload.merchants) || !payload.merchants.every(merchant =>
        typeof merchant?.merchantId === 'string' && typeof merchant.name === 'string'
        && funnelColumns.slice(1).every(([key]) => validCount(merchant[key])))) {
      throw new Error('invalid funnel');
    }
    for (const [key, label] of funnelTotals) {
      const item = doc.createElement('div');
      const term = doc.createElement('dt');
      const value = doc.createElement('dd');
      term.textContent = label;
      value.textContent = countText(payload.totals[key]);
      item.append(term, value);
      totals.append(item);
    }
    if (payload.merchants.length) {
      const caption = doc.createElement('caption');
      caption.textContent = '점포별 흐름 지표';
      const head = doc.createElement('thead');
      const headers = doc.createElement('tr');
      for (const [, label] of funnelColumns) {
        const cell = doc.createElement('th');
        cell.scope = 'col';
        cell.textContent = label;
        headers.append(cell);
      }
      head.append(headers);
      const body = doc.createElement('tbody');
      for (const merchant of payload.merchants) {
        const row = doc.createElement('tr');
        for (const [key] of funnelColumns) {
          const cell = doc.createElement(key === 'name' ? 'th' : 'td');
          if (key === 'name') cell.scope = 'row';
          cell.textContent = key === 'name' ? merchant.name : countText(merchant[key]);
          row.append(cell);
        }
        body.append(row);
      }
      table.append(caption, head, body);
    }
    status.textContent = payload.merchants.length
      ? `${payload.from}부터 ${payload.to}까지 실제 점포 ${payload.merchants.length}곳의 흐름이에요.`
      : `${payload.from}부터 ${payload.to}까지 표시할 실제 점포가 없습니다.`;
  } catch (error) {
    if (!latest()) return;
    totals.replaceChildren();
    table.replaceChildren();
    status.textContent = error.status === 401 || error.status === 403
      ? '관리자 권한을 확인하지 못했어요. 다시 로그인해 주세요.'
      : '흐름 지표를 불러오지 못했어요. 기간을 다시 선택해 주세요.';
    if (error.status === 401 || error.status === 403) throw error;
  }
}

function fields(form, FormDataOf = FormData) {
  const data = new FormDataOf(form);
  const neighborhood = String(data.get('neighborhood') ?? '').trim();
  const problem = neighborhoodProblem(neighborhood);
  if (problem) throw localError(problem);
  return {
    name: String(data.get('name') ?? ''),
    story: String(data.get('story') ?? ''),
    roadAddress: String(data.get('roadAddress') ?? ''),
    minimumSpendWon: Number(data.get('minimumSpendWon')),
    menuItems: parseMenuLines(String(data.get('menuItems') ?? '')),
    businessHours: String(data.get('businessHours') ?? ''),
    // 빈 값은 비우기다(서버가 null로 저장).
    neighborhood,
    category: String(data.get('category') ?? ''),
  };
}

export function parseMenuLines(value) {
  const lines = value.split('\n').map(line => line.trim()).filter(Boolean);
  if (lines.length > 30) throw new Error('메뉴는 최대 30개까지 입력할 수 있습니다.');
  return lines.map(line => {
    const match = /^(.+?)\s*\|\s*(\d+)$/.exec(line);
    const name = match?.[1]?.trim();
    const priceWon = Number(match?.[2]);
    if (!name || name.length > 200 || !Number.isSafeInteger(priceWon) || priceWon > 1_000_000_000) {
      throw new Error('메뉴는 메뉴명 | 가격(원) 형식으로 입력해 주세요.');
    }
    return { name, priceWon };
  });
}

export function campaignDraftPayload(data) {
  const utc = name => {
    const time = Date.parse(String(data.get(name) ?? ''));
    if (!Number.isFinite(time)) throw new Error('시작과 종료 시각을 확인해 주세요.');
    return new Date(time).toISOString();
  };
  const startsAt = utc('startsAt');
  const endsAt = utc('endsAt');
  if (endsAt <= startsAt) throw new Error('종료 시각은 시작 시각보다 늦어야 합니다.');
  const enrollmentCapacity = Number(data.get('enrollmentCapacity'));
  if (!Number.isSafeInteger(enrollmentCapacity) || enrollmentCapacity < 1 || enrollmentCapacity > 2_147_483_647) {
    throw new Error('참여 정원은 1 이상의 정수로 입력해 주세요.');
  }
  const rewardGoals = [1, 3, 5].map(targetVisitCount => ({
    targetVisitCount, displayName: String(data.get(`goal${targetVisitCount}`) ?? '').trim(),
  }));
  if (rewardGoals.some(goal => !goal.displayName || goal.displayName.length > 100)) {
    throw new Error('세 목표의 수집품 이름을 모두 입력해 주세요.');
  }
  const purpose = purposePayload(data);
  return { merchantId: String(data.get('merchantId') ?? ''), title: String(data.get('title') ?? '').trim(),
    startsAt, endsAt, enrollmentCapacity, rewardGoals, ...(purpose ? { purpose } : {}) };
}

// 캠페인 목적(Issue #412, D-092). 목적을 고르지 않으면 payload에 purpose 키가 없어 지금까지의 요청과 같다.
export const campaignPurposeNames = {
  NEW_CUSTOMERS: '처음 확인되는 방문 늘리기', REVISIT: '다시 방문하게 하기', OFF_PEAK: '한산한 시간대 채우기',
};
const purposeDayNames = '월화수목금토일';
const allValues = (data, name) => typeof data.getAll === 'function' ? data.getAll(name) : [];

function purposeInteger(data, name, min, max, message) {
  const text = String(data.get(name) ?? '').trim();
  if (!text) return undefined;
  const value = Number(text);
  if (!Number.isInteger(value) || value < min || value > max) throw new Error(message);
  return value;
}

function purposeWindows(data) {
  const windows = [];
  for (const index of [1, 2, 3]) {
    const days = allValues(data, `window${index}Days`).map(Number);
    const start = String(data.get(`window${index}Start`) ?? '');
    let end = String(data.get(`window${index}End`) ?? '');
    if (!days.length && !start && !end) continue;
    if (!days.length || !start || !end || days.some(day => !Number.isInteger(day) || day < 1 || day > 7)) {
      throw new Error(`시간대 ${index}의 요일과 시작·끝 시각을 모두 입력해 주세요.`);
    }
    if (end === '00:00') end = '24:00';
    if (end <= start) throw new Error(`시간대 ${index}의 끝 시각은 시작 시각보다 늦어야 해요. 자정을 넘기는 시간대는 둘로 나눠 주세요.`);
    windows.push({ days: [...new Set(days)].sort((a, b) => a - b), start, end });
  }
  if (!windows.length) throw new Error('한산한 시간대를 한 개 이상 입력해 주세요.');
  return windows;
}

export function purposePayload(data) {
  const kind = String(data.get('purpose') ?? '');
  if (!kind) return undefined;
  if (!Object.hasOwn(campaignPurposeNames, kind)) throw new Error('캠페인 목적을 다시 골라 주세요.');
  const purpose = { purpose: kind };
  const menu = String(data.get('purposeMenu') ?? '').trim();
  if (menu.length > 40) throw new Error('대표 메뉴 이름은 40자 이하로 입력해 주세요.');
  if (menu) purpose.featuredMenuName = menu;
  if (kind === 'REVISIT') {
    const minDays = purposeInteger(data, 'revisitMinDays', 1, 30, '최소 일수는 1~30 사이 정수로 입력해 주세요.');
    const windowDays = purposeInteger(data, 'revisitWindowDays', 2, 60, '기간 일수는 2~60 사이 정수로 입력해 주세요.');
    if ((minDays ?? 1) >= (windowDays ?? 14)) throw new Error('최소 일수는 기간 일수보다 작게 입력해 주세요.');
    if (minDays !== undefined) purpose.revisitMinDays = minDays;
    if (windowDays !== undefined) purpose.revisitWindowDays = windowDays;
    const nextStep = String(data.get('nextStepText') ?? '').trim();
    if (nextStep.length > 80) throw new Error('다음 방문 안내 문구는 80자 이하로 입력해 주세요.');
    if (nextStep) purpose.nextStepText = nextStep;
  }
  if (kind === 'OFF_PEAK') purpose.timeWindows = purposeWindows(data);
  return purpose;
}

function purposeDays(days) {
  const key = [...new Set(days)].sort((a, b) => a - b).join('');
  return key === '1234567' ? '매일' : key === '12345' ? '평일' : key === '67' ? '주말'
    : [...new Set(days)].sort((a, b) => a - b).map(day => purposeDayNames[day - 1]).join('·');
}

// 관리자 목록에 보이는 한 줄 설명. 모르는 값이면 빈 문자열이라 목록 줄이 그대로다.
export function purposeLabel(purpose) {
  if (!purpose || !Object.hasOwn(campaignPurposeNames, purpose.kind)) return '';
  const parts = [campaignPurposeNames[purpose.kind]];
  if (purpose.kind === 'REVISIT' && Number.isInteger(purpose.revisitMinDays) && Number.isInteger(purpose.revisitWindowDays)) {
    parts.push(`${purpose.revisitMinDays}일 뒤부터 ${purpose.revisitWindowDays}일 안`);
  }
  if (purpose.kind === 'OFF_PEAK' && Array.isArray(purpose.timeWindows)) {
    parts.push(purpose.timeWindows.map(window => `${purposeDays(window.days)} ${window.start}–${window.end}`).join(', '));
  }
  if (typeof purpose.featuredMenuName === 'string' && purpose.featuredMenuName) parts.push(`대표 메뉴 ${purpose.featuredMenuName}`);
  return ` · 목적: ${parts.join(' · ')}`;
}

// 고른 목적에 맞는 입력 칸만 보인다. 초기·초기화 뒤에는 모두 숨긴다.
function syncPurposeFields(form) {
  const kind = String(form?.elements?.purpose?.value ?? '');
  for (const node of form?.querySelectorAll?.('[data-purpose-for]') ?? []) {
    node.hidden = !String(node.dataset?.purposeFor ?? node.getAttribute?.('data-purpose-for') ?? '').split(' ').includes(kind);
    for (const control of node.querySelectorAll('input, select, textarea')) control.disabled = node.hidden;
  }
}

const couponVoidReasons = [
  ['ISSUED_IN_ERROR', '잘못 발급했어요'],
  ['ABUSE_SUSPECTED', '부정 사용이 의심돼요'],
  ['MERCHANT_REQUEST', '점주가 요청했어요'],
  ['OTHER', '기타'],
];
const voidReasonLabels = new Map([...couponVoidReasons, ['VISIT_CANCELED', '방문 취소로 조건이 깨져 무효']]);
const couponStatusLabels = { ISSUED: '사용 가능', REDEEMED: '사용 완료', VOIDED: '무효' };
const kstMonthDay = new Intl.DateTimeFormat('en-US', { timeZone: 'Asia/Seoul', month: 'numeric', day: 'numeric' });
// "9월 29일" 형태. 브라우저 시간대·지역이 아니라 한국 날짜로 센다.
function dateLabel(iso) {
  const parts = kstMonthDay.formatToParts(new Date(iso));
  const part = type => parts.find(item => item.type === type)?.value;
  return `${part('month')}월 ${part('day')}일`;
}

const isAdminCoupon = coupon => coupon !== null && typeof coupon === 'object'
  && typeof coupon.couponId === 'string' && coupon.couponId !== '' && Number.isInteger(coupon.milestone)
  && typeof coupon.title === 'string' && Object.hasOwn(couponStatusLabels, coupon.status)
  && typeof coupon.expired === 'boolean' && typeof coupon.customerLabel === 'string'
  && typeof coupon.issuedAt === 'string' && !Number.isNaN(Date.parse(coupon.issuedAt))
  && (coupon.voidReason === null || typeof coupon.voidReason === 'string');

export function couponVoidMessage(error) {
  if (error.status === 401 || error.code === 'ADMIN_FORBIDDEN') return '관리자 권한을 확인하지 못했어요. 다시 로그인해 주세요.';
  switch (error.code) {
    case 'ADMIN_COUPON_NOT_VOIDABLE': return '이미 사용한 쿠폰은 무효로 할 수 없어요. 목록을 새로 불러왔어요.';
    case 'ADMIN_COUPON_NOT_FOUND': return '쿠폰을 찾을 수 없어요. 목록을 새로 불러왔어요.';
    case 'ADMIN_INVALID_INPUT': return '사유를 고르고, 메모는 100자 이하로 연락처·이메일·주소 없이 적어 주세요.';
    default: return '쿠폰을 무효로 하지 못했어요. 잠시 후 다시 시도해 주세요.';
  }
}

function editField(doc, label, name, value, type = 'text') {
  const wrapper = doc.createElement('label');
  wrapper.textContent = label + ' ';
  const input = doc.createElement(['story', 'menuItems', 'businessHours'].includes(name) ? 'textarea' : 'input');
  input.name = name;
  if (input.tagName === 'INPUT') input.type = type;
  input.value = String(value);
  if (name === 'businessHours') input.maxLength = 1000;
  if (name === 'neighborhood') input.maxLength = 10;
  if (name === 'menuItems') input.maxLength = 8000;
  input.required = name === 'name' || name === 'roadAddress' || name === 'minimumSpendWon';
  wrapper.append(input);
  return wrapper;
}

// 수정 양식에도 공개 NFT 정보 안내를 둔다(가게 이름·동네·업종은 발행 뒤 그 NFT에서 바뀌지 않는다).
export const publicMetadataNoticeText = '가게 이름·동네·업종은 공개 중인 가게에서 발행하는 NFT의 공개 정보(메타데이터)에 들어가요. 여기서 고쳐도 이미 발행한 NFT에는 발행 때 값이 그대로 남아요.';

function publicMetadataNotice(doc) {
  const notice = doc.createElement('p');
  notice.className = 'admin-hint';
  notice.textContent = publicMetadataNoticeText;
  return notice;
}

function categoryField(doc, value) {
  const wrapper = doc.createElement('label');
  wrapper.textContent = '업종 ';
  const select = doc.createElement('select');
  select.name = 'category';
  for (const [optionValue, label] of [['', '선택 안 함'], ...merchantCategories.map(category => [category, category])]) {
    const option = doc.createElement('option');
    option.value = optionValue;
    option.textContent = label;
    select.append(option);
  }
  select.value = merchantCategories.includes(value) ? value : '';
  wrapper.append(select);
  return wrapper;
}

// 삭제 처리는 되돌릴 수 없어 두 번 눌러야 하고, 확인 상태는 이 시간이 지나거나 초점이 떠나면 풀린다.
const disarmAfterMs = 5000;
const armedMessage = '한 번 더 누르면 이 계정의 로그인·지갑 연결·권한이 삭제 처리됩니다.';
const sourceLabels = { WEB: '웹 접수', SHOWCASE_APP: '시연 앱 접수' };
const statusLabels = { REQUESTED: '대기', CANCELLED: '취소됨', PROCESSED: '처리 완료', REJECTED: '거절됨' };
const ledgerLabels = { WAITING_FOR_MINT_FINALITY: '제출된 거래 결과 확인 중', COMPLETED: '삭제 완료' };
// 접수번호가 없는 옛 접수는 처리하지 않는다. 접수한 사람이 "본인 확인이 더 필요하다"고 안내받은 요청이라 다시 접수해야 한다.
const legacyNote = '옛 접수: 본인이 다시 접수해야 처리할 수 있어요';
// 요청자는 접수번호로 거절 사유를 그대로 본다.
const rejectHint = '요청자가 접수번호로 이 사유를 그대로 봅니다. 개인정보를 쓰지 마세요.';

// 한국 표준시 분 단위. 서버 시각은 UTC ISO이고 운영자는 KST 기한을 본다.
export function formatKst(iso) {
  const time = Date.parse(iso);
  if (!Number.isFinite(time)) return '-';
  return `${new Date(time + 9 * 60 * 60 * 1000).toISOString().slice(0, 16).replace('T', ' ')} KST`;
}

function deletionErrorText(error) {
  if (error.code === 'DELETION_COOLING_OFF') return '아직 취소 기간이라 처리할 수 없습니다.';
  if (error.code === 'DELETION_LEGACY_NEEDS_REFILE') return `${legacyNote}. 거절하면 그 사람이 다시 접수할 수 있습니다.`;
  if (error.code === 'DELETION_BUSY') return '다른 처리와 겹쳤습니다. 잠시 뒤 다시 시도해 주세요.';
  if (error.code === 'DELETION_SELF_PROCESSING_REFUSED') return '본인 요청은 처리할 수 없습니다. 다른 관리자가 처리해야 합니다.';
  if (error.code === 'DELETION_INTAKE_NOT_PENDING' || error.code === 'DELETION_INTAKE_NOT_FOUND') {
    return '이미 처리·취소·거절된 요청입니다. 새로고침해 주세요.';
  }
  if (error.code === 'DELETION_REJECT_REASON_INVALID') {
    return '거절 사유를 1자 이상 200자 이하로 입력해 주세요. 이메일·웹 주소·전화번호처럼 보이는 내용은 쓸 수 없습니다.';
  }
  return '요청을 처리하지 못했습니다.';
}

function deletionRow(fetcher, doc, intake, status) {
  if (typeof intake.id !== 'string' || !statusLabels[intake.status] || !sourceLabels[intake.source]) {
    throw new Error('invalid deletion intake');
  }
  const row = doc.createElement('div');
  row.className = 'admin-deletion';
  const legacy = intake.status === 'REQUESTED' && intake.hasReceipt === false;
  const head = doc.createElement('p');
  head.textContent = `${sourceLabels[intake.source]} · ${statusLabels[intake.status]} · 계정 ${intake.accountLabel ?? '삭제됨'}${legacy ? ` · ${legacyNote}` : ''}`;
  const dates = doc.createElement('p');
  dates.textContent = `접수 ${formatKst(intake.requestedAt)} · 취소 마감 ${formatKst(intake.cancelUntil)} · 처리 기한 ${formatKst(intake.dueAt)}${intake.overdue ? ' · 기한 초과' : ''}`;
  row.append(head, dates);
  if (intake.status !== 'REQUESTED') {
    const result = doc.createElement('p');
    const parts = [];
    if (intake.processedAt) parts.push(`처리 ${formatKst(intake.processedAt)}`);
    if (intake.processedBy) parts.push(`처리자 ${intake.processedBy}`);
    if (intake.deletion) parts.push(ledgerLabels[intake.deletion.status] ?? '');
    if (intake.rejectReason) parts.push(`거절 사유 ${intake.rejectReason}`);
    result.textContent = parts.filter(Boolean).join(' · ') || '접수자가 취소했습니다.';
    row.append(result);
    return row;
  }
  // 같은 이름의 버튼이 줄마다 있으므로 화면 낭독기가 어느 계정의 것인지 알 수 있게 마스킹한 표지를 이름에 넣는다.
  const subject = intake.accountLabel ?? '계정';
  const process = doc.createElement('button');
  process.type = 'button';
  process.className = 'danger';
  process.disabled = !intake.canProcess;
  const setProcessLabel = (text) => {
    process.textContent = text;
    process.setAttribute('aria-label', `${subject} ${text}`);
  };
  setProcessLabel(intake.canProcess ? '삭제 처리' : legacy ? '처리 불가 · 다시 접수 필요' : '취소 기간 중 · 처리 불가');
  let armed = false;
  let timer;
  const disarm = () => {
    clearTimeout(timer);
    if (!armed || process.disabled) return;
    armed = false;
    setProcessLabel('삭제 처리');
    if (status.textContent === armedMessage) status.textContent = '삭제 처리 확인이 풀렸습니다. 처리하려면 처음부터 다시 누르세요.';
  };
  process.addEventListener('blur', disarm);
  process.addEventListener('click', async () => {
    if (!armed) {
      armed = true;
      setProcessLabel('정말 삭제 처리 (되돌릴 수 없음)');
      status.textContent = armedMessage;
      timer = setTimeout(disarm, disarmAfterMs);
      return;
    }
    clearTimeout(timer);
    process.disabled = true;
    try {
      await jsonRequest(fetcher, `${deletionEndpoint}/${encodeURIComponent(intake.id)}/process`, 'POST', {});
      await loadAdmin(fetcher, doc);
      status.textContent = '삭제 요청을 처리했습니다.';
    } catch (error) {
      status.textContent = deletionErrorText(error);
      armed = false;
      setProcessLabel('삭제 처리');
      process.disabled = false;
    }
  });
  const hint = doc.createElement('p');
  hint.id = `deletion-reason-hint-${intake.id}`;
  hint.textContent = rejectHint;
  const reason = doc.createElement('input');
  reason.name = 'reason';
  reason.maxLength = 200;
  reason.required = true;
  reason.setAttribute('aria-label', `${subject} 거절 사유`);
  reason.setAttribute('aria-describedby', hint.id);
  reason.placeholder = '거절 사유';
  const reject = doc.createElement('button');
  reject.type = 'button';
  reject.textContent = '거절';
  reject.setAttribute('aria-label', `${subject} 거절`);
  reject.addEventListener('click', async () => {
    reject.disabled = true;
    try {
      await jsonRequest(fetcher, `${deletionEndpoint}/${encodeURIComponent(intake.id)}/reject`, 'POST', {
        reason: reason.value,
      });
      await loadAdmin(fetcher, doc);
      status.textContent = '삭제 요청을 거절했습니다.';
    } catch (error) {
      status.textContent = deletionErrorText(error);
      reject.disabled = false;
    }
  });
  row.append(process, hint, reason, reject);
  return row;
}

async function loadDeletions(fetcher, doc, container, status, current) {
  // 삭제 뒤에는 세션이 없어 재정산이 저절로 돌지 않는다. 목록을 열 때마다 진행시키고, 실패해도 목록은 보인다.
  try { await jsonRequest(fetcher, '/api/web/admin/account-deletions/reconcile', 'POST', {}); }
  catch (error) { if (error.status === 401 || error.status === 403) throw error; }
  const payload = await jsonRequest(fetcher, deletionEndpoint);
  if (!current()) return;
  if (!Array.isArray(payload.intakes)) throw new Error('invalid deletion intakes');
  container.replaceChildren();
  if (!payload.intakes.length) {
    container.textContent = '접수된 삭제 요청이 없습니다.';
    return;
  }
  for (const intake of payload.intakes) container.append(deletionRow(fetcher, doc, intake, status));
}

// 점포 카드의 공개 구역. 점포 수정 양식 안(상태 줄 바로 아래)에 두되 공개 단추는 type="button"이고, 참조 번호 칸의
// Enter는 수정 저장(양식의 기본 제출)을 막고 공개만 누른다. 비공개 점포는 빠진 항목을 알리고 동의서 참조 번호를 받는다.
function goLivePanel(fetcher, doc, merchant, act) {
  const panel = doc.createElement('section');
  panel.className = 'admin-go-live';
  panel.setAttribute('aria-label', `${merchant.name} 공개`);
  const title = doc.createElement('h4');
  title.textContent = '점포 공개';
  const summary = doc.createElement('p');
  panel.append(title, summary);
  if (merchant.status === 'ACTIVE') {
    const published = merchant.publishedAt ? ` · 공개 ${formatKst(merchant.publishedAt)}` : '';
    summary.textContent = `공개 중 · 동의서 ${merchant.consentDocumentRef ?? '기록 없음'}${published}`;
    return panel;
  }
  const missing = missingForPublish(merchant);
  summary.textContent = missing.length
    ? `공개하려면 먼저 채워 저장해 주세요: ${missing.join(', ')}`
    : '메뉴·영업시간·도로명 주소가 채워져 있어요. 가게 이름·사진 사용 동의서를 확인하고 참조 번호를 적어 공개하세요.';
  summary.id = `publish-summary-${merchant.id}`;
  const hint = doc.createElement('p');
  hint.className = 'admin-hint';
  hint.id = `publish-hint-${merchant.id}`;
  hint.textContent = referenceHint;
  const reference = referenceInput(doc, 'consentDocumentRef', `점포 동의서 참조 번호 (${merchant.name})`);
  reference.setAttribute('aria-describedby', hint.id);
  // 수정 저장이 이 칸을 필수로 막지 않게 한다(공개할 때만 검사한다).
  reference.required = false;
  const publish = doc.createElement('button');
  publish.type = 'button';
  publish.textContent = '점포 공개';
  publish.setAttribute('aria-label', `${merchant.name} 점포 공개`);
  publish.disabled = missing.length > 0;
  // 눌리지 않는 단추는 왜 못 누르는지(빠진 항목)를 함께 읽힌다.
  if (publish.disabled) publish.setAttribute('aria-describedby', summary.id);
  let publishing = false;
  publish.addEventListener('click', async () => {
    if (publishing || publish.disabled) return;
    const problem = documentReferenceProblem(reference.value);
    if (!problem && !confirmed(doc, `${merchant.name}\n동의서 ${reference.value.trim()}로 점포를 공개할까요? 고객 앱·웹 음식점 목록에 나오고 직원 등록을 받을 수 있어요.`)) return;
    publishing = true;
    try {
      await act(publish, async () => {
        if (problem) throw localError(problem);
        await jsonRequest(fetcher, `${endpoint}/${encodeURIComponent(merchant.id)}/publish`, 'POST', {
          expectedVersion: merchant.version, consentDocumentRef: reference.value.trim(),
        });
      }, '점포를 공개했습니다. 캠페인 공개와 보상 혜택 등록은 따로 해 주세요.', '점포를 공개하지 못했습니다.');
    } finally { publishing = false; }
  });
  // 참조 번호 칸의 Enter는 점포 수정 저장(양식 기본 제출)을 막고 공개만 누른다. 한글 입력 조합 중의 Enter는 조합 확정이라 건드리지 않는다.
  reference.addEventListener('keydown', event => {
    if (event.key !== 'Enter' || event.isComposing || event.keyCode === 229) return;
    event.preventDefault?.();
    if (!publish.disabled) void publish.click();
  });
  panel.append(labelled(doc, '점포 동의서 참조 번호', reference), hint, publish);
  return panel;
}

// 점주로 올리기(직원 행) 또는 직원으로 내리기(점주 행). 확인 기록의 참조 번호만 보내고 개인정보는 받지 않는다.
function ownerChangeForm(fetcher, doc, act, { merchant, accountId, action, buttonText }) {
  const form = doc.createElement('form');
  form.className = 'admin-inline-form';
  const subject = `${merchant.name} 계정 ${accountId}`;
  let reason;
  if (action === 'demote') {
    reason = doc.createElement('select');
    reason.name = 'reason';
    reason.setAttribute('aria-label', `내리는 사유 (${subject})`);
    for (const [value, label] of demotionReasons) {
      const option = doc.createElement('option');
      option.value = value;
      option.textContent = label;
      reason.append(option);
    }
    reason.value = demotionReasons[0][0];
    form.append(labelled(doc, '내리는 사유', reason));
  }
  const reference = referenceInput(doc, 'verificationDocumentRef', `확인 기록 참조 번호 (${subject})`);
  const button = doc.createElement('button');
  button.type = 'submit';
  button.textContent = buttonText;
  if (action === 'demote') button.className = 'danger';
  button.setAttribute('aria-label', `${subject} ${buttonText}`);
  form.append(labelled(doc, '확인 기록 참조 번호', reference), button);
  form.addEventListener('submit', async event => {
    event.preventDefault?.();
    const path = `${endpoint}/${encodeURIComponent(merchant.id)}/members/${encodeURIComponent(accountId)}/${action}-owner`;
    const problem = documentReferenceProblem(reference.value);
    const question = action === 'promote'
      ? `${subject}\n사업자등록증 원본과 점포 전화 확인을 마쳤나요? 점주로 올리면 점주 권한이 생겨요.`
      : `${subject}\n점주 권한을 거두고 직원으로 내릴까요?`;
    if (!problem && !confirmed(doc, question)) return;
    // 목록을 다시 그린 뒤에도 이 점포의 점주 목록을 열어 둔다.
    if (!openOwnerPanels.has(doc)) openOwnerPanels.set(doc, new Set());
    openOwnerPanels.get(doc).add(merchant.id);
    await act(button, async () => {
      const problem = documentReferenceProblem(reference.value);
      if (problem) throw localError(problem);
      await jsonRequest(fetcher, path, 'POST', action === 'promote'
        ? { verificationDocumentRef: reference.value.trim() }
        : { reason: reason.value, verificationDocumentRef: reference.value.trim() });
    }, action === 'promote' ? '점주로 올렸습니다.' : '점주를 직원으로 내렸습니다. 직원 권한은 남아 있습니다.',
    action === 'promote' ? '점주로 올리지 못했습니다.' : '직원으로 내리지 못했습니다.');
  });
  return form;
}

// 공개 성공 문구: 시작 시각이 아직이면 그때부터 기록된다고 알린다(공개가 곧 보상 시작은 아니다).
export function campaignPublishedText(campaign, now = Date.now()) {
  const starts = Date.parse(campaign?.startsAt ?? '');
  return Number.isFinite(starts) && starts > now
    ? `캠페인을 공개했습니다. ${formatKst(campaign.startsAt)}부터 방문 보상이 기록됩니다.`
    : '캠페인을 공개했습니다. 이제 방문하면 보상이 기록됩니다.';
}

// 끝난 캠페인은 서버가 공개를 거절하므로 "다시 공개"를 보이지 않는다.
export function canRepublishCampaign(campaign, now = Date.now()) {
  const ends = Date.parse(campaign?.endsAt ?? '');
  return campaign?.status === 'PAUSED' && Number.isFinite(ends) && ends > now;
}

function courseStepFields(doc, merchants, position) {
  const group = doc.createElement('fieldset');
  const legend = doc.createElement('legend'); legend.textContent = `${position}번 가게`;
  group.append(legend);
  const field = (label, name, tag = 'input') => {
    const wrapper = doc.createElement('label'); wrapper.textContent = `${label} `;
    const control = doc.createElement(tag); control.name = `${name}${position}`; control.required = true;
    wrapper.append(control); group.append(wrapper);
    return control;
  };
  const merchant = field('실제 점포', 'merchantId', 'select');
  for (const store of merchants.filter(item => item.status === 'ACTIVE' && item.demo === false)) {
    const option = doc.createElement('option'); option.value = store.id; option.textContent = store.name;
    merchant.append(option);
  }
  const goal = field('목표 방문 횟수', 'targetVisitCount', 'select');
  for (const count of [1, 3, 5]) {
    const option = doc.createElement('option'); option.value = String(count); option.textContent = `${count}회`;
    goal.append(option);
  }
  const key = field('조각 키', 'pieceKey'); key.maxLength = 40; key.pattern = '[a-z0-9-]{1,40}'; key.value = `piece-${position}`;
  const label = field('조각 이름', 'pieceLabel'); label.maxLength = 20;
  const reference = field('점주 참여 동의 참조 번호', 'ownerOptinRef');
  reference.maxLength = 40; reference.autocomplete = 'off';
  return group;
}

function renderCourseSteps(doc, merchants) {
  const form = doc.getElementById('admin-course-create');
  const list = doc.getElementById('admin-course-steps');
  if (!form || !list) return;
  list.replaceChildren();
  const count = Number(form.querySelector('[name="stepCount"]')?.value ?? 2);
  for (let position = 1; position <= count; position++) list.append(courseStepFields(doc, merchants, position));
}

export async function loadAdminCourses(fetcher, doc, merchants, act, current = () => true) {
  const form = doc.getElementById('admin-course-create');
  const list = doc.getElementById('admin-courses');
  const status = doc.getElementById('admin-course-status');
  if (!form || !list || !status) return;
  courseMerchants.set(doc, merchants);
  list.replaceChildren();
  renderCourseSteps(doc, merchants);
  form.hidden = merchants.filter(item => item.status === 'ACTIVE' && item.demo === false).length < 2;
  if (form.hidden) status.textContent = '공개 중인 실제 점포가 둘 이상 있어야 초안을 만들 수 있어요.';
  else status.textContent = '';
  try {
    const payload = await jsonRequest(fetcher, courseEndpoint);
    if (!current()) return;
    if (!Array.isArray(payload.courses) || !payload.courses.every(course => typeof course?.id === 'string' &&
      typeof course.title === 'string' && Array.isArray(course.steps))) throw new Error('invalid courses');
    if (!payload.courses.length) list.textContent = '저장된 코스가 없습니다.';
    for (const course of payload.courses) {
      const row = doc.createElement('section'); row.className = 'admin-panel';
      const heading = doc.createElement('h4'); heading.textContent = `${course.title} · ${course.steps.length}곳 · ${course.status}`;
      const steps = doc.createElement('p');
      steps.textContent = course.steps.map(step => `${step.position}번 ${step.merchantName} (${step.targetVisitCount}회, ${step.pieceLabel})`).join(' → ');
      row.append(heading, steps);
      if (course.checkSummary) {
        const summary = doc.createElement('div'); summary.setAttribute('role', 'status');
        const label = doc.createElement('p');
        label.textContent = `${course.checkSummary.label} · ${course.checkedAt ? formatKst(course.checkedAt) : '시각 미확인'} · 실패 ${course.checkSummary.failures}건 · 주의 ${course.checkSummary.warnings}건`;
        summary.append(label);
        for (const item of course.checkSummary.items ?? []) {
          const line = doc.createElement('p'); line.textContent = `${item.status} · ${item.detail}`; summary.append(line);
        }
        row.append(summary);
      }
      const button = (action, text) => {
        const control = doc.createElement('button'); control.type = 'button'; control.textContent = text;
        control.setAttribute('aria-label', `${course.title} 코스 ${text}`);
        control.addEventListener('click', () => act(control,
          () => {
            const hour = doc.getElementById('admin-course-hour')?.value ?? '';
            if (action === 'check' && hour !== '' && (!Number.isInteger(Number(hour)) || Number(hour) < 0 || Number(hour) > 23)) {
              throw localError('권하는 시각은 0~23시로 입력해 주세요.');
            }
            return jsonRequest(fetcher, `${courseEndpoint}/${encodeURIComponent(course.id)}/${action}`, 'POST',
              action === 'check' && hour !== '' ? { suggestedHour: Number(hour) } : {});
          },
          action === 'check' ? '코스 점검 결과를 저장했습니다.' : action === 'publish' ? '코스를 공개했습니다.' : '코스를 중지했습니다.',
          `코스를 ${text}하지 못했습니다.`));
        row.append(control);
      };
      if (course.status === 'DRAFT' || course.status === 'PAUSED') {
        button('check', '점검'); button('publish', '공개');
      } else if (course.status === 'ACTIVE') button('pause', '중지');
      list.append(row);
    }
  } catch (error) {
    if (!current()) return;
    if (error.status === 401 || error.status === 403) throw error;
    list.textContent = '코스 목록을 불러오지 못했습니다.';
  }
}

function campaignButton(fetcher, doc, act, campaign, action, text) {
  const button = doc.createElement('button');
  button.type = 'button';
  button.textContent = text;
  if (action === 'pause') button.className = 'danger';
  button.setAttribute('aria-label', `${campaign.merchantName} ${campaign.title} 캠페인 ${text}`);
  button.addEventListener('click', () => act(button,
    () => jsonRequest(fetcher, `${campaignEndpoint}/${encodeURIComponent(campaign.id)}/${action}`, 'POST', {}),
    action === 'publish' ? campaignPublishedText(campaign) : '캠페인을 중지하고 비공개로 돌렸습니다.',
    action === 'publish' ? '캠페인을 공개하지 못했습니다.' : '캠페인을 중지하지 못했습니다.'));
  return button;
}

function campaignExtensionButton(fetcher, doc, campaign, days, generatedAt, current, status, extensionState) {
  const button = doc.createElement('button');
  button.type = 'button';
  button.textContent = `${days}일 연장`;
  button.setAttribute('aria-label', `${campaign.merchantName} ${campaign.title} 캠페인 ${days}일 연장`);
  button.addEventListener('click', async () => {
    if (extensionState.busy) return;
    const newEnd = extendedCampaignEnd(campaign.endsAt, generatedAt, days);
    if (!newEnd) {
      status.textContent = '캠페인 종료일을 확인하지 못했어요. 목록을 새로 불러와 주세요.';
      return;
    }
    if (!confirmed(doc, `${campaign.merchantName}\n캠페인 종료일을 ${formatKst(newEnd)}로 연장할까요?`)) return;
    extensionState.busy = true;
    button.disabled = true;
    try {
      const updated = await jsonRequest(fetcher, `${campaignEndpoint}/${encodeURIComponent(campaign.id)}/extend`, 'POST', {
        days, expectedEndsAt: campaign.endsAt,
      });
      if (!current()) return;
      const nextRequestId = (adminRequests.get(doc) ?? 0) + 1;
      const campaignLoaded = await loadAdmin(fetcher, doc);
      if (adminRequests.get(doc) !== nextRequestId) return;
      if (!campaignLoaded) {
        if (!doc.getElementById('admin-content').hidden) {
          status.textContent = '캠페인 목록을 다시 불러오지 못했습니다. 새로고침해 주세요.';
        }
        return;
      }
      if (!doc.getElementById('admin-content').hidden) {
        status.textContent = `캠페인을 ${days}일 연장했습니다. 새 종료일은 ${formatKst(updated.endsAt)}입니다.`;
      }
      status.focus?.();
    } catch (error) {
      if (!current()) return;
      if (error.code === 'ADMIN_VERSION_CONFLICT') {
        const nextRequestId = (adminRequests.get(doc) ?? 0) + 1;
        const campaignLoaded = await loadAdmin(fetcher, doc);
        if (adminRequests.get(doc) !== nextRequestId) return;
        if (!campaignLoaded) {
          if (!doc.getElementById('admin-content').hidden) {
            status.textContent = '캠페인 목록을 다시 불러오지 못했습니다. 새로고침해 주세요.';
          }
          return;
        }
      }
      status.textContent = campaignExtensionMessage(error);
      status.focus?.();
    } finally {
      extensionState.busy = false;
      button.disabled = false;
    }
  });
  return button;
}

export async function loadAdmin(fetcher, doc) {
  ensurePlayMetricsPanel(doc);
  const requestId = (adminRequests.get(doc) ?? 0) + 1;
  adminRequests.set(doc, requestId);
  clearRealWorld(doc);
  const status = doc.getElementById('admin-status');
  const login = doc.getElementById('admin-login');
  const logout = doc.getElementById('admin-logout');
  const content = doc.getElementById('admin-content');
  const list = doc.getElementById('admin-merchants');
  const operations = doc.getElementById('admin-operations');
  const draftForm = doc.getElementById('admin-campaign-draft');
  const draftList = doc.getElementById('admin-campaign-drafts');
  const draftMerchant = draftForm?.querySelector('select');
  const deletions = doc.getElementById('admin-deletions');
  const create = doc.getElementById('admin-create');
  const offerForm = doc.getElementById('admin-offer-form');
  const offerMerchant = offerForm?.querySelector('select[name="merchantId"]');
  const offerList = doc.getElementById('admin-offers');
  const campaignList = doc.getElementById('admin-campaigns');
  const campaignSummary = doc.getElementById('admin-campaign-summary');
  const benefitSelect = doc.getElementById('admin-benefit-campaign');
  const benefitCampaignIds = new Set();
  const courseForm = doc.getElementById('admin-course-create');
  const courseList = doc.getElementById('admin-courses');
  let campaignLoaded = !campaignList;
  const funnelStatus = doc.getElementById('admin-funnel-status');
  const funnelTotalsNode = doc.getElementById('admin-funnel-totals');
  const funnelTable = doc.getElementById('admin-funnel-table');
  if (!status || !login || !logout || !content || !list || !create) return;
  content.hidden = true;
  login.hidden = true;
  logout.hidden = true;
  list.replaceChildren();
  operations?.replaceChildren();
  draftList?.replaceChildren();
  draftMerchant?.replaceChildren();
  deletions?.replaceChildren();
  offerList?.replaceChildren();
  offerMerchant?.replaceChildren();
  campaignList?.replaceChildren();
  const previousBenefitCampaign = benefitSelect?.value;
  benefitSelect?.replaceChildren();
  const benefitForm = doc.getElementById('admin-benefit-form');
  if (benefitForm) benefitForm.hidden = true;
  const benefitPause = doc.getElementById('admin-benefit-pause');
  if (benefitPause) benefitPause.hidden = true;
  courseList?.replaceChildren();
  if (campaignSummary) { campaignSummary.textContent = ''; campaignSummary.hidden = true; }
  funnelRequests.set(doc, (funnelRequests.get(doc) ?? 0) + 1);
  playMetricRequests.set(doc, (playMetricRequests.get(doc) ?? 0) + 1);
  funnelTotalsNode?.replaceChildren();
  funnelTable?.replaceChildren();
  if (funnelStatus) funnelStatus.textContent = '';
  doc.getElementById('admin-play-events')?.replaceChildren();
  doc.getElementById('admin-play-games')?.replaceChildren();
  const playStatus = doc.getElementById('admin-play-status');
  if (playStatus) playStatus.textContent = '';
  if (draftForm) draftForm.hidden = true;
  if (offerForm) offerForm.hidden = true;
  if (courseForm) courseForm.hidden = true;
  const current = () => adminRequests.get(doc) === requestId;
  // 공개·점주·혜택·캠페인 동작 뒤에는 목록을 새로 읽고 결과를 상태 줄에 알린다.
  const act = async (button, request, done, fallback) => {
    button.disabled = true;
    try {
      await request();
      if (!current()) return;
      await loadAdmin(fetcher, doc);
      if (!content.hidden) status.textContent = done;
      status.focus?.();
    } catch (error) {
      if (!current()) return;
      status.textContent = goLiveMessage(error, fallback);
      button.disabled = false;
      status.focus?.();
    }
  };
  try {
    await jsonRequest(fetcher, '/api/web/admin/me');
    if (adminRequests.get(doc) !== requestId) return;
    const payload = await jsonRequest(fetcher, endpoint);
    if (adminRequests.get(doc) !== requestId) return;
    if (!Array.isArray(payload.merchants)) throw new Error('invalid merchants');
    for (const merchant of payload.merchants) {
      if (merchant.demo !== false || typeof merchant.id !== 'string' ||
          !Number.isSafeInteger(merchant.version)) throw new Error('invalid merchant');
      const form = doc.createElement('form');
      const title = doc.createElement('h3');
      title.textContent = merchant.name;
      const state = doc.createElement('p');
      state.textContent = merchant.status === 'PAUSED' ? '비공개' : '공개 중';
      const save = doc.createElement('button');
      save.type = 'submit';
      save.textContent = '수정 저장';
      const hide = doc.createElement('button');
      hide.type = 'button';
      hide.textContent = '비공개 및 신규 참여 중지';
      hide.className = 'danger';
      form.append(title, state, goLivePanel(fetcher, doc, merchant, act),
        editField(doc, '상점 이름', 'name', merchant.name),
        editField(doc, '소개', 'story', merchant.story),
        editField(doc, '메뉴·가격 (한 줄에 메뉴명 | 가격)', 'menuItems',
          (merchant.menuItems ?? []).map(item => `${item.name} | ${item.priceWon}`).join('\n')),
        editField(doc, '점포 제공 영업시간', 'businessHours', merchant.businessHours ?? ''),
        editField(doc, '도로명 주소', 'roadAddress', merchant.roadAddress),
        editField(doc, '최소 결제 금액(원)', 'minimumSpendWon', merchant.minimumSpendWon, 'number'),
        editField(doc, '동네(행정동)', 'neighborhood', merchant.neighborhood ?? ''),
        categoryField(doc, merchant.category),
        publicMetadataNotice(doc),
        save, hide);
      const staffPanel = doc.createElement('section');
      const staffTitle = doc.createElement('h4');
      staffTitle.textContent = '직원 권한';
      const staffList = doc.createElement('div');
      const approve = doc.createElement('form');
      const codeLabel = doc.createElement('label');
      codeLabel.textContent = '직원이 전달한 등록 코드 ';
      const codeInput = doc.createElement('input');
      codeInput.name = 'code';
      codeInput.required = true;
      codeInput.maxLength = 22;
      codeInput.autocomplete = 'off';
      codeLabel.append(codeInput);
      const approveButton = doc.createElement('button');
      approveButton.type = 'submit';
      approveButton.textContent = '이 점포 직원 승인';
      approve.append(codeLabel, approveButton);
      staffPanel.append(staffTitle, staffList, approve);
      const ownerPanel = doc.createElement('section');
      ownerPanel.className = 'admin-owners';
      ownerPanel.setAttribute('aria-label', `${merchant.name} 점주`);
      const ownerTitle = doc.createElement('h4');
      ownerTitle.textContent = '점주 (점포당 최대 2명)';
      const ownerHelp = doc.createElement('p');
      ownerHelp.textContent = '직원 등록을 마친 사람의 사업자등록증 원본을 확인하고 점포 전화번호로 전화해 확인한 뒤, 확인 기록의 참조 번호만 적어 점주로 올립니다. 사업자등록번호·이름·전화번호는 적지 않아요. 본인 계정은 올리거나 내릴 수 없어요.';
      // 쿠폰 목록처럼 눌러서 읽는다(점포마다 요청을 하나씩 더 보내지 않는다).
      const ownerLoad = doc.createElement('button');
      ownerLoad.type = 'button';
      ownerLoad.textContent = '점주 목록 불러오기';
      ownerLoad.setAttribute('aria-label', `${merchant.name} 점주 목록 불러오기`);
      // 알림 문장은 따로 된 status에만 두고, 양식이 있는 목록은 알림 영역으로 만들지 않는다.
      const ownerStatus = doc.createElement('p');
      ownerStatus.setAttribute('role', 'status');
      ownerStatus.setAttribute('aria-live', 'polite');
      const ownerList = doc.createElement('div');
      ownerPanel.append(ownerTitle, ownerHelp, ownerLoad, ownerStatus, ownerList);
      const couponPanel = doc.createElement('section');
      couponPanel.className = 'admin-coupons';
      couponPanel.setAttribute('aria-label', `${merchant.name} 쿠폰 관리`);
      const couponTitle = doc.createElement('h4');
      couponTitle.textContent = '쿠폰 관리';
      const couponHelp = doc.createElement('p');
      couponHelp.textContent = '이 점포에서 쓰는 보상 쿠폰 최근 100장이에요. 아직 쓰지 않은 쿠폰만 사유와 함께 무효로 할 수 있고 사용한 쿠폰은 바꿀 수 없어요. 고객 계정은 가림 표시로만 보여요.';
      const couponLoad = doc.createElement('button');
      couponLoad.type = 'button';
      couponLoad.textContent = '쿠폰 목록 불러오기';
      couponLoad.setAttribute('aria-label', `${merchant.name} 쿠폰 목록 불러오기`);
      const couponStatus = doc.createElement('p');
      couponStatus.setAttribute('role', 'status');
      couponStatus.setAttribute('aria-live', 'polite');
      const couponList = doc.createElement('ul');
      couponList.className = 'reversal-list';
      couponPanel.append(couponTitle, couponHelp, couponLoad, couponStatus, couponList);
      staffPanel.append(couponPanel, ownerPanel);
      let couponBusy = false;
      const loadCoupons = async () => {
        if (couponBusy) return;
        couponBusy = true;
        couponLoad.disabled = true;
        couponStatus.textContent = '쿠폰을 불러오는 중이에요.';
        try {
          const payload = await jsonRequest(fetcher, `${endpoint}/${encodeURIComponent(merchant.id)}/coupons`);
          if (!Array.isArray(payload.coupons) || !payload.coupons.every(isAdminCoupon)) throw new Error('invalid coupons');
          couponList.replaceChildren();
          for (const coupon of payload.coupons) {
            const item = doc.createElement('li');
            const text = doc.createElement('p');
            text.className = 'reversal-text';
            const state = coupon.status === 'ISSUED' && coupon.expired ? '만료' : couponStatusLabels[coupon.status];
            const why = coupon.status === 'VOIDED' && coupon.voidReason ? ` · ${voidReasonLabels.get(coupon.voidReason) ?? '사유 기록됨'}` : '';
            text.textContent = `${coupon.milestone}번째 상자 · ${coupon.title} · ${coupon.customerLabel} · ${state}${why} · 발급 ${dateLabel(coupon.issuedAt)}`;
            item.append(text);
            if (coupon.status === 'ISSUED') {
              const voidForm = doc.createElement('form');
              voidForm.className = 'reversal-form';
              const reasonLabel = doc.createElement('label');
              reasonLabel.textContent = '무효 사유 ';
              const reason = doc.createElement('select');
              reason.name = 'reason';
              for (const [value, label] of couponVoidReasons) {
                const option = doc.createElement('option');
                option.value = value;
                option.textContent = label;
                reason.append(option);
              }
              reason.value = couponVoidReasons[0][0];
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
              const voidButton = doc.createElement('button');
              voidButton.type = 'submit';
              voidButton.className = 'danger';
              voidButton.textContent = '쿠폰 무효화';
              voidButton.setAttribute('aria-label', `${merchant.name} ${coupon.title} ${coupon.customerLabel} 쿠폰 무효화`);
              voidForm.append(reasonLabel, noteLabel, voidButton);
              voidForm.addEventListener('submit', async event => {
                event.preventDefault?.();
                if (couponBusy) return;
                const confirmed = doc.defaultView?.confirm?.(
                  `${coupon.title} · ${coupon.customerLabel}\n이 쿠폰을 무효로 할까요? 고객은 더 이상 쓸 수 없고 되돌릴 수 없어요.`);
                if (confirmed !== true) return;
                couponBusy = true;
                voidButton.disabled = true;
                try {
                  const body = { reason: reason.value };
                  const trimmed = note.value.trim();
                  if (trimmed) body.note = trimmed;
                  const result = await jsonRequest(fetcher, `/api/web/admin/coupons/${encodeURIComponent(coupon.couponId)}/void`, 'POST', body);
                  if (adminRequests.get(doc) !== requestId) return;
                  if (!result?.coupon || result.coupon.status !== 'VOIDED') throw new Error('invalid void response');
                  couponBusy = false;
                  await loadCoupons();
                  couponStatus.textContent = result.replayed === true ? '이미 무효로 처리된 쿠폰이에요.' : '쿠폰을 무효로 했어요.';
                } catch (error) {
                  if (adminRequests.get(doc) !== requestId) return;
                  // 이미 사용됐거나 없는 쿠폰이면 목록이 낡은 것이라 새로 읽고 안내를 그대로 남긴다.
                  if (error.code === 'ADMIN_COUPON_NOT_VOIDABLE' || error.code === 'ADMIN_COUPON_NOT_FOUND') {
                    couponBusy = false;
                    await loadCoupons();
                  }
                  couponStatus.textContent = couponVoidMessage(error);
                  voidButton.disabled = false;
                } finally { couponBusy = false; }
              });
              item.append(voidForm);
            }
            couponList.append(item);
          }
          couponStatus.textContent = payload.coupons.length ? `쿠폰 ${payload.coupons.length}장이에요.` : '아직 발급된 쿠폰이 없어요.';
        } catch (error) {
          if (adminRequests.get(doc) !== requestId) return;
          couponList.replaceChildren();
          couponStatus.textContent = error.status === 401 || error.status === 403
            ? '관리자 권한을 확인하지 못했어요. 다시 로그인해 주세요.'
            : error.code === 'ADMIN_MERCHANT_NOT_FOUND' ? '점포를 찾을 수 없어요. 시연 점포는 대상이 아니에요.'
              : '쿠폰 목록을 불러오지 못했어요. 다시 시도해 주세요.';
        } finally { couponBusy = false; couponLoad.disabled = false; }
      };
      couponLoad.addEventListener('click', loadCoupons);
      try {
        const staff = await jsonRequest(fetcher, `${endpoint}/${encodeURIComponent(merchant.id)}/staff`);
        if (adminRequests.get(doc) !== requestId) return;
        if (!Array.isArray(staff.staff)) throw new Error('invalid staff');
        for (const member of staff.staff) {
          const row = doc.createElement('p');
          const label = doc.createElement('span');
          label.textContent = `계정 ${member.accountId} · 직원 `;
          const revoke = doc.createElement('button');
          revoke.type = 'button';
          revoke.textContent = '권한 회수';
          revoke.className = 'danger';
          revoke.addEventListener('click', async () => {
            revoke.disabled = true;
            try {
              await jsonRequest(fetcher,
                `${endpoint}/${encodeURIComponent(merchant.id)}/staff/${encodeURIComponent(member.accountId)}/revoke`,
                'POST', {});
              await loadAdmin(fetcher, doc);
              status.textContent = '직원 권한을 회수했습니다.';
            } catch {
              status.textContent = '직원 권한을 회수하지 못했습니다.';
              revoke.disabled = false;
            }
          });
          row.append(label, revoke);
          staffList.append(row);
          // 점주로 올리기는 공개 중인 점포의 직원에게만 보인다(서버도 같은 조건을 다시 검사한다).
          if (merchant.status === 'ACTIVE') {
            staffList.append(ownerChangeForm(fetcher, doc, act, {
              merchant, accountId: member.accountId, action: 'promote', buttonText: '점주로 올리기',
            }));
          }
        }
        if (!staff.staff.length) staffList.textContent = '승인된 직원이 없습니다.';
      } catch {
        if (adminRequests.get(doc) !== requestId) return;
        staffList.textContent = '직원 목록을 불러오지 못했습니다.';
      }
      const loadOwners = async () => {
        ownerLoad.disabled = true;
        ownerList.replaceChildren();
        ownerStatus.textContent = '점주 목록을 불러오는 중이에요.';
        try {
          const owners = await jsonRequest(fetcher, `${endpoint}/${encodeURIComponent(merchant.id)}/owners`);
          if (adminRequests.get(doc) !== requestId) return;
          if (!Array.isArray(owners.owners) || !owners.owners.every(owner => typeof owner?.accountId === 'string')) {
            throw new Error('invalid owners');
          }
          ownerStatus.textContent = owners.owners.length ? `점주 ${owners.owners.length}명이에요.` : '점주가 없습니다.';
          if (!openOwnerPanels.has(doc)) openOwnerPanels.set(doc, new Set());
          openOwnerPanels.get(doc).add(merchant.id);
          for (const owner of owners.owners) {
            const row = doc.createElement('p');
            row.textContent = `계정 ${owner.accountId} · 점주`;
            ownerList.append(row, ownerChangeForm(fetcher, doc, act, {
              merchant, accountId: owner.accountId, action: 'demote', buttonText: '직원으로 내리기',
            }));
          }
        } catch (error) {
          if (adminRequests.get(doc) !== requestId) return;
          ownerStatus.textContent = goLiveMessage(error, '점주 목록을 불러오지 못했습니다.');
        } finally { ownerLoad.disabled = false; }
      };
      ownerLoad.addEventListener('click', loadOwners);
      if (openOwnerPanels.get(doc)?.has(merchant.id)) await loadOwners();
      approve.addEventListener('submit', async event => {
        event.preventDefault();
        approveButton.disabled = true;
        try {
          await jsonRequest(fetcher, `${endpoint}/${encodeURIComponent(merchant.id)}/staff`, 'POST', {
            code: codeInput.value,
          });
          codeInput.value = '';
          await loadAdmin(fetcher, doc);
          status.textContent = '직원 권한을 승인했습니다.';
        } catch (error) {
          status.textContent = error.code === 'STAFF_CODE_INVALID'
            ? '코드가 만료되었거나 이미 사용되었습니다.' : '직원 권한을 승인하지 못했습니다.';
          approveButton.disabled = false;
        }
      });
      form.addEventListener('submit', async event => {
        event.preventDefault();
        save.disabled = true;
        try {
          await jsonRequest(fetcher, `${endpoint}/${encodeURIComponent(merchant.id)}`, 'PATCH', {
            ...fields(form, doc.defaultView?.FormData ?? FormData), expectedVersion: merchant.version,
          });
          await loadAdmin(fetcher, doc);
          status.textContent = '상점을 수정했습니다.';
        } catch (error) {
          status.textContent = error.local === true || error.message?.startsWith('메뉴') ? error.message
            : error.code === 'ADMIN_MERCHANT_NOT_READY'
              ? '공개 중인 점포는 메뉴·영업시간·도로명 주소를 비울 수 없어요. 값을 채우거나 먼저 점포를 숨겨 주세요.'
              : error.status === 409 ? '다른 변경이 먼저 저장되었습니다. 새로고침해 주세요.' : '수정하지 못했습니다.';
          save.disabled = false;
        }
      });
      hide.addEventListener('click', async () => {
        hide.disabled = true;
        try {
          await jsonRequest(fetcher, `${endpoint}/${encodeURIComponent(merchant.id)}/hide`, 'POST', {
            expectedVersion: merchant.version,
          });
          await loadAdmin(fetcher, doc);
          status.textContent = '상점을 비공개로 전환하고 신규 참여를 중지했습니다.';
        } catch (error) {
          status.textContent = error.code === 'ADMIN_PENDING_CLAIMS'
            ? '미수령 QR이 있습니다. 수령 완료 또는 만료 후 다시 시도해 주세요.'
            : error.status === 409 ? '다른 변경이 먼저 저장되었습니다. 새로고침해 주세요.' : '비공개로 전환하지 못했습니다.';
          hide.disabled = false;
        }
      });
      list.append(form, staffPanel);
      if (draftMerchant) {
        const option = doc.createElement('option');
        option.value = merchant.id;
        option.textContent = merchant.name;
        draftMerchant.append(option);
      }
      if (offerMerchant && merchant.status === 'ACTIVE') {
        const option = doc.createElement('option');
        option.value = merchant.id;
        option.textContent = merchant.name;
        offerMerchant.append(option);
      }
    }
    if (draftForm) draftForm.hidden = payload.merchants.length === 0;
    // 혜택은 공개 중인 점포에만 만들 수 있다.
    if (offerForm) offerForm.hidden = !payload.merchants.some(merchant => merchant.status === 'ACTIVE');
    if (payload.merchants.length === 0) {
      const empty = doc.createElement('p');
      empty.textContent = '등록된 점포가 없습니다. 점포 등록 양식에서 첫 점포를 비공개로 등록하세요.';
      list.append(empty);
    }
    if (operations) {
      try {
        const summary = await jsonRequest(fetcher, '/api/web/admin/operations-status');
        if (adminRequests.get(doc) !== requestId) return;
        if (!Array.isArray(summary.merchants)) throw new Error('invalid operations status');
        if (!summary.merchants.length) operations.textContent = '집계할 실제 점포가 없습니다.';
        for (const merchant of summary.merchants) {
          const row = doc.createElement('p');
          row.textContent = `${merchant.name} · QR 활성 ${merchant.claims.active}건 · 만료 ${merchant.claims.expired}건 · 수령 ${merchant.claims.claimed}건 · 방문 ${merchant.visits}건 · 보상 ${merchant.rewards}건`;
          operations.append(row);
          const jobs = doc.createElement('p');
          jobs.textContent = `민팅 작업: ${merchant.mintJobs.length ? merchant.mintJobs.map(item => `${item.status} ${item.count}건`).join(', ') : '없음'}`;
          operations.append(jobs);
          const failures = doc.createElement('p');
          failures.textContent = `민팅 오류 코드: ${merchant.mintFailures.length ? merchant.mintFailures.map(item => `${item.code} ${item.count}건`).join(', ') : '없음'}`;
          operations.append(failures);
        }
      } catch (error) {
        if (adminRequests.get(doc) !== requestId) return;
        if (error.status === 401 || error.status === 403) throw error;
        operations.textContent = '운영 현황을 불러오지 못했습니다.';
      }
    }
    await loadAdminFunnel(fetcher, doc, current);
    await loadAdminPlayMetrics(fetcher, doc, current);
    if (draftList) {
      try {
        const campaigns = await jsonRequest(fetcher, '/api/web/admin/campaign-drafts');
        if (adminRequests.get(doc) !== requestId) return;
        if (!Array.isArray(campaigns.drafts)) throw new Error('invalid campaign drafts');
        if (!campaigns.drafts.length) draftList.textContent = '저장된 비공개 초안이 없습니다.';
        for (const draft of campaigns.drafts) {
          const item = doc.createElement('p');
          const period = typeof draft.startsAt === 'string' && typeof draft.endsAt === 'string'
            ? ` · ${formatKst(draft.startsAt)}부터 ${formatKst(draft.endsAt)}까지` : '';
          item.textContent = `${draft.merchantName} · ${draft.title} · 비공개 초안 · 정원 ${draft.enrollmentCapacity}명${period}${purposeLabel(draft.purpose)}`;
          if (typeof draft.id === 'string' && draft.id) {
            item.append(campaignButton(fetcher, doc, act, draft, 'publish', '공개'));
            if (benefitSelect) {
              const option = doc.createElement('option');
              option.value = draft.id;
              option.textContent = `${draft.merchantName} · ${draft.title} · 비공개 초안`;
              benefitSelect.append(option);
              benefitCampaignIds.add(draft.id);
            }
          }
          draftList.append(item);
        }
      } catch (error) {
        if (adminRequests.get(doc) !== requestId) return;
        if (error.status === 401 || error.status === 403) throw error;
        draftList.textContent = '캠페인 초안 목록을 불러오지 못했습니다.';
      }
    }
    if (campaignList) {
      try {
        const published = await jsonRequest(fetcher, campaignEndpoint);
        if (adminRequests.get(doc) !== requestId) return;
        if (!Array.isArray(published.campaigns) || !published.campaigns.every(item => typeof item?.id === 'string'
          && Object.hasOwn(campaignStatusLabels, item.status))) throw new Error('invalid campaigns');
        const hasServerTime = typeof published.generatedAt === 'string' && Number.isFinite(Date.parse(published.generatedAt));
        const campaigns = hasServerTime ? orderedCampaigns(published.campaigns, published.generatedAt) : published.campaigns;
        if (campaignSummary && !hasServerTime) {
          campaignSummary.hidden = false;
          campaignSummary.textContent = '서버 기준 시각을 확인하지 못했어요. 캠페인 남은 기간과 연장은 잠시 후 다시 확인해 주세요.';
        }
        if (campaignSummary && hasServerTime) {
          const timings = campaigns.map(item => campaignTiming(item.endsAt, published.generatedAt));
          const soonCount = timings.filter(item => item.soon && !item.ended).length;
          const endedCount = timings.filter(item => item.ended).length;
          campaignSummary.hidden = soonCount === 0 && endedCount === 0;
          campaignSummary.textContent = campaignSummary.hidden ? ''
            : `14일 안에 끝나는 캠페인 ${soonCount}개 · 이미 끝난 캠페인 ${endedCount}개`;
        }
        if (!published.campaigns.length) campaignList.textContent = '공개하거나 중지한 캠페인이 없습니다.';
        for (const item of campaigns) {
          const row = doc.createElement('p');
          const timing = hasServerTime ? campaignTiming(item.endsAt, published.generatedAt) : null;
          const ending = timing?.ended ? ' · 종료됨' : timing?.daysLeft !== null && timing?.daysLeft !== undefined
            ? ` · 종료까지 ${timing.daysLeft}일${timing.soon ? ' · 곧 종료' : ''}` : '';
          row.textContent = `${item.merchantName} · ${item.title} · ${campaignStatusLabels[item.status]} · ${formatKst(item.startsAt)}부터 ${formatKst(item.endsAt)}까지${ending} · 보이는 참여자 ${item.enrolledCount}/${item.enrollmentCapacity}명${purposeLabel(item.purpose)}`;
          if (item.status === 'ACTIVE') row.append(campaignButton(fetcher, doc, act, item, 'pause', '중지'));
          if (canRepublishCampaign(item, hasServerTime ? Date.parse(published.generatedAt) : Date.now())) {
            row.append(campaignButton(fetcher, doc, act, item, 'publish', '다시 공개'));
          }
          if (hasServerTime && item.status !== 'DRAFT') {
            const extensionState = { busy: false };
            row.append(campaignExtensionButton(fetcher, doc, item, 30, published.generatedAt, current, status, extensionState));
            row.append(campaignExtensionButton(fetcher, doc, item, 90, published.generatedAt, current, status, extensionState));
          }
          campaignList.append(row);
          if (benefitSelect) {
            const option = doc.createElement('option');
            option.value = item.id;
            option.textContent = `${item.merchantName} · ${item.title}`;
            benefitSelect.append(option);
            benefitCampaignIds.add(item.id);
          }
        }
        if (benefitSelect && benefitCampaignIds.has(previousBenefitCampaign)) benefitSelect.value = previousBenefitCampaign;
        await loadAdminBenefit(fetcher, doc, requestId);
        campaignLoaded = true;
      } catch (error) {
        if (adminRequests.get(doc) !== requestId) return;
        if (error.status === 401 || error.status === 403) throw error;
        campaignList.textContent = '캠페인 목록을 불러오지 못했습니다.';
        if (campaignSummary) { campaignSummary.textContent = ''; campaignSummary.hidden = true; }
      }
    }
    if (offerList) {
      try {
        const offers = await jsonRequest(fetcher, offerEndpoint);
        if (adminRequests.get(doc) !== requestId) return;
        if (!Array.isArray(offers.offers) || !offers.offers.every(item => typeof item?.id === 'string'
          && Object.hasOwn(milestoneLabels, item.milestone))) throw new Error('invalid offers');
        if (!offers.offers.length) offerList.textContent = '등록된 보상 혜택이 없습니다.';
        for (const offer of offers.offers) {
          const row = doc.createElement('p');
          const cap = offer.issuanceCap === null ? '상한 없음' : `${offer.issuanceCap}장`;
          row.textContent = `${milestoneLabels[offer.milestone]} · ${offer.merchantName} · ${offer.title} · 발급 ${offer.issuedCount}장/${cap} · 동의서 ${offer.consentDocumentRef ?? '기록 없음'} · ${offer.status === 'ACTIVE' ? '발급 중' : '멈춤'}`;
          if (offer.status === 'ACTIVE') {
            const pause = doc.createElement('button');
            pause.type = 'button';
            pause.className = 'danger';
            pause.textContent = '혜택 멈춤';
            pause.setAttribute('aria-label', `${offer.merchantName} ${offer.title} 혜택 멈춤`);
            pause.addEventListener('click', () => act(pause,
              () => jsonRequest(fetcher, `${offerEndpoint}/${encodeURIComponent(offer.id)}/pause`, 'POST', {}),
              '혜택 발급을 멈췄습니다. 이미 발급한 쿠폰은 그대로 쓸 수 있습니다.', '혜택을 멈추지 못했습니다.'));
            row.append(pause);
          }
          offerList.append(row);
        }
      } catch (error) {
        if (adminRequests.get(doc) !== requestId) return;
        if (error.status === 401 || error.status === 403) throw error;
        offerList.textContent = '보상 혜택 목록을 불러오지 못했습니다.';
      }
    }
    if (deletions) {
      try {
        await loadDeletions(fetcher, doc, deletions, status, () => adminRequests.get(doc) === requestId);
      } catch (error) {
        if (adminRequests.get(doc) !== requestId) return;
        if (error.status === 401 || error.status === 403) throw error;
        deletions.textContent = '계정 삭제 요청 목록을 불러오지 못했습니다.';
      }
    }
    if (!current()) return;
    await loadAdminCourses(fetcher, doc, payload.merchants, act, current);
    if (!current()) return;
    status.textContent = payload.merchants.length ? `${payload.merchants.length}곳의 실제 상점입니다.` : '등록된 실제 상점이 없습니다.';
    content.hidden = false;
    realWorldCleanups.set(doc, mountRealWorldAdmin(fetcher, doc, payload.merchants));
    logout.textContent = '로그아웃';
    logout.hidden = false;
    return campaignLoaded;
  } catch (error) {
    if (adminRequests.get(doc) !== requestId) return;
    list.replaceChildren();
    operations?.replaceChildren();
    draftList?.replaceChildren();
    draftMerchant?.replaceChildren();
    deletions?.replaceChildren();
    offerList?.replaceChildren();
    offerMerchant?.replaceChildren();
    campaignList?.replaceChildren();
    courseList?.replaceChildren();
    funnelRequests.set(doc, (funnelRequests.get(doc) ?? 0) + 1);
    funnelTotalsNode?.replaceChildren();
    funnelTable?.replaceChildren();
    if (funnelStatus) funnelStatus.textContent = '';
    if (draftForm) draftForm.hidden = true;
    if (offerForm) offerForm.hidden = true;
    if (courseForm) courseForm.hidden = true;
    if (error.status === 401) {
      status.textContent = '관리자 계정으로 로그인해 주세요.';
      login.hidden = false;
    } else if (error.status === 403) {
      status.textContent = '이 Google 계정에는 관리자 권한이 없습니다.';
      logout.textContent = '다른 계정으로 로그인';
      logout.hidden = false;
    } else {
      status.textContent = '관리자 정보를 불러오지 못했습니다. 새로고침해 주세요.';
    }
  }
}

export function bindAdmin(fetcher, doc) {
  const form = doc.getElementById('admin-create');
  const status = doc.getElementById('admin-status');
  const login = doc.getElementById('admin-login');
  const logout = doc.getElementById('admin-logout');
  const clear = () => {
    clearRealWorld(doc);
    adminRequests.set(doc, (adminRequests.get(doc) ?? 0) + 1);
    funnelRequests.set(doc, (funnelRequests.get(doc) ?? 0) + 1);
    playMetricRequests.set(doc, (playMetricRequests.get(doc) ?? 0) + 1);
    openOwnerPanels.delete(doc);
    doc.getElementById('admin-merchants')?.replaceChildren();
    doc.getElementById('admin-operations')?.replaceChildren();
    doc.getElementById('admin-campaign-drafts')?.replaceChildren();
    doc.getElementById('admin-deletions')?.replaceChildren();
    doc.getElementById('admin-offers')?.replaceChildren();
    doc.getElementById('admin-campaigns')?.replaceChildren();
    doc.getElementById('admin-courses')?.replaceChildren();
    doc.getElementById('admin-funnel-totals')?.replaceChildren();
    doc.getElementById('admin-funnel-table')?.replaceChildren();
    doc.getElementById('admin-play-events')?.replaceChildren();
    doc.getElementById('admin-play-games')?.replaceChildren();
    const playStatus = doc.getElementById('admin-play-status');
    if (playStatus) playStatus.textContent = '';
    const funnelStatus = doc.getElementById('admin-funnel-status');
    if (funnelStatus) funnelStatus.textContent = '';
    const draftForm = doc.getElementById('admin-campaign-draft');
    draftForm?.querySelector('select')?.replaceChildren();
    if (draftForm) draftForm.hidden = true;
    const offerForm = doc.getElementById('admin-offer-form');
    offerForm?.querySelector('select[name="merchantId"]')?.replaceChildren();
    if (offerForm) offerForm.hidden = true;
    const courseForm = doc.getElementById('admin-course-create');
    if (courseForm) courseForm.hidden = true;
    doc.getElementById('admin-content').hidden = true;
  };
  doc.defaultView?.addEventListener('pagehide', clear);
  doc.getElementById('admin-funnel-days')?.addEventListener('change', async () => {
    if (doc.getElementById('admin-content')?.hidden) return;
    const requestId = adminRequests.get(doc);
    try {
      await loadAdminFunnel(fetcher, doc, () => adminRequests.get(doc) === requestId);
      await loadAdminPlayMetrics(fetcher, doc, () => adminRequests.get(doc) === requestId);
    } catch (error) {
      if (adminRequests.get(doc) === requestId && (error.status === 401 || error.status === 403)) {
        await loadAdmin(fetcher, doc);
      }
    }
  });
  doc.defaultView?.addEventListener('pageshow', event => {
    if (event.persisted) void loadAdmin(fetcher, doc);
  });
  doc.addEventListener?.('visibilitychange', () => {
    if (doc.hidden) clear();
    else void loadAdmin(fetcher, doc);
  });
  logout?.addEventListener('click', async () => {
    clear();
    login.hidden = true;
    logout.disabled = true;
    status.textContent = '로그아웃하는 중입니다.';
    try {
      const response = await fetcher('/api/web/logout', {
        method: 'POST', credentials: 'same-origin', cache: 'no-store',
      });
      if (!response.ok) throw new Error('logout failed');
      clear();
      logout.hidden = true;
      login.textContent = '다른 Google 계정으로 로그인';
      login.hidden = false;
      status.textContent = '로그아웃했습니다. 다른 Google 계정으로 로그인할 수 있습니다.';
    } catch {
      status.textContent = '로그아웃을 확인하지 못했습니다. 다시 시도해 주세요.';
    } finally { logout.disabled = false; }
  });
  form?.addEventListener('submit', async event => {
    event.preventDefault();
    const button = form.querySelector('button[type="submit"]');
    button.disabled = true;
    try {
      await jsonRequest(fetcher, endpoint, 'POST', fields(form));
      form.reset();
      await loadAdmin(fetcher, doc);
      status.textContent = '상점을 비공개로 저장했습니다.';
    } catch (error) {
      status.textContent = error.local === true || error.message?.startsWith('메뉴') ? error.message : '상점을 저장하지 못했습니다.';
    } finally { button.disabled = false; }
  });
  const draftForm = doc.getElementById('admin-campaign-draft');
  let draftSaving = false;
  draftForm?.addEventListener('change', event => {
    if (event.target?.name === 'purpose') syncPurposeFields(draftForm);
  });
  // 브라우저가 복원한 양식 값(뒤로 가기·새로고침)에 맞춰 목적 칸을 한 번 맞춘다.
  syncPurposeFields(draftForm);
  draftForm?.addEventListener('submit', async event => {
    event.preventDefault();
    if (draftSaving) return;
    const requestId = adminRequests.get(doc);
    const button = draftForm.querySelector('button[type="submit"]');
    draftSaving = true;
    button.disabled = true;
    try {
      await jsonRequest(fetcher, '/api/web/admin/campaign-drafts', 'POST',
        campaignDraftPayload(new (doc.defaultView?.FormData ?? FormData)(draftForm)));
      if (adminRequests.get(doc) !== requestId) return;
      draftForm.reset();
      syncPurposeFields(draftForm);
      await loadAdmin(fetcher, doc);
      if (!doc.getElementById('admin-content').hidden) status.textContent = '비공개 캠페인 초안을 저장했습니다.';
    } catch (error) {
      if (adminRequests.get(doc) === requestId) status.textContent = error.message?.includes('주세요')
        ? error.message : '초안을 저장하지 못했습니다.';
    } finally { draftSaving = false; button.disabled = false; }
  });
  const courseForm = doc.getElementById('admin-course-create');
  courseForm?.querySelector('[name="stepCount"]')?.addEventListener('change', () => {
    const FormDataOf = doc.defaultView?.FormData ?? FormData;
    const previous = new FormDataOf(courseForm);
    renderCourseSteps(doc, courseMerchants.get(doc) ?? []);
    for (const control of doc.getElementById('admin-course-steps')?.querySelectorAll('[name]') ?? []) {
      if (previous.has(control.name)) control.value = previous.get(control.name);
    }
  });
  let courseSaving = false;
  courseForm?.addEventListener('submit', async event => {
    event.preventDefault();
    if (courseSaving) return;
    const requestId = adminRequests.get(doc);
    const button = courseForm.querySelector('button[type="submit"]');
    courseSaving = true; button.disabled = true;
    try {
      const FormDataOf = doc.defaultView?.FormData ?? FormData;
      await jsonRequest(fetcher, courseEndpoint, 'POST', courseDraftPayload(new FormDataOf(courseForm)));
      if (adminRequests.get(doc) !== requestId) return;
      courseForm.reset();
      await loadAdmin(fetcher, doc);
      if (!doc.getElementById('admin-content').hidden) status.textContent = '비공개 코스를 저장했습니다.';
    } catch (error) {
      if (adminRequests.get(doc) === requestId) status.textContent = error.local ? error.message : '코스를 저장하지 못했습니다.';
    } finally { courseSaving = false; button.disabled = false; }
  });
  const offerForm = doc.getElementById('admin-offer-form');
  let offerSaving = false;
  offerForm?.addEventListener('submit', async event => {
    event.preventDefault();
    if (offerSaving) return;
    const requestId = adminRequests.get(doc);
    const button = offerForm.querySelector('button[type="submit"]');
    offerSaving = true;
    button.disabled = true;
    try {
      // 창의 FormData를 쓴다(브라우저에서는 전역 FormData와 같다).
      const FormDataOf = doc.defaultView?.FormData ?? FormData;
      await jsonRequest(fetcher, offerEndpoint, 'POST', rewardOfferPayload(new FormDataOf(offerForm)));
      if (adminRequests.get(doc) !== requestId) return;
      offerForm.reset();
      await loadAdmin(fetcher, doc);
      if (!doc.getElementById('admin-content').hidden) status.textContent = '점주 동의를 확인한 보상 혜택을 등록했습니다.';
      status.focus?.();
    } catch (error) {
      if (adminRequests.get(doc) === requestId) {
        status.textContent = goLiveMessage(error, '보상 혜택을 등록하지 못했습니다.');
        status.focus?.();
      }
    } finally { offerSaving = false; button.disabled = false; }
  });
  bindAdminBenefits(fetcher, doc);
  return loadAdmin(fetcher, doc);
}

export function bindAdminBenefits(fetcher, doc) {
  const benefitSelect = doc.getElementById('admin-benefit-campaign');
  benefitSelect?.addEventListener('change', () => { void loadAdminBenefit(fetcher, doc); });
  const benefitForm = doc.getElementById('admin-benefit-form');
  let benefitSaving = false;
  benefitForm?.addEventListener('submit', async event => {
    event.preventDefault();
    if (benefitSaving || !benefitSelect?.value) return;
    const button = benefitForm.querySelector('button[type="submit"]');
    benefitSaving = true;
    button.disabled = true;
    try {
      const FormDataOf = doc.defaultView?.FormData ?? FormData;
      await jsonRequest(fetcher, `${campaignEndpoint}/${encodeURIComponent(benefitSelect.value)}/benefit`, 'POST',
        campaignBenefitPayload(new FormDataOf(benefitForm)));
      benefitForm.reset();
      await loadAdminBenefit(fetcher, doc);
    } catch (error) {
      doc.getElementById('admin-benefit-status').textContent = error.local === true ? error.message : '캠페인 혜택을 등록하지 못했습니다.';
    } finally { benefitSaving = false; button.disabled = false; }
  });
  const benefitPause = doc.getElementById('admin-benefit-pause');
  benefitPause?.addEventListener('click', async () => {
    if (!benefitSelect?.value || !confirmed(doc, '새 캠페인 혜택 쿠폰 발급을 중지할까요? 이미 발급한 쿠폰은 그대로 쓸 수 있어요.')) return;
    benefitPause.disabled = true;
    try {
      await jsonRequest(fetcher, `${campaignEndpoint}/${encodeURIComponent(benefitSelect.value)}/benefit/pause`, 'POST', {});
      await loadAdminBenefit(fetcher, doc);
    } catch { doc.getElementById('admin-benefit-status').textContent = '혜택 발급을 중지하지 못했습니다.'; }
    finally { benefitPause.disabled = false; }
  });
}

if (typeof document !== 'undefined') void bindAdmin(fetch, document);
