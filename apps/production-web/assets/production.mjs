const MERCHANTS_URL = '/merchants';
const COLLECTION_URL = '/api/web/collection';
const BADGES_URL = '/api/web/badges';
const BADGES_TIMEOUT_MS = 8000;
const CONSENT_URL = '/api/web/consent';
// index.html이 보여 주는 이용약관·개인정보 문구의 버전(Issue #253). 서버 상수와 공개 페이지의 버전은 시험이 서로 비교한다.
// 서버가 다른 버전을 요구하면 이 화면의 문구에는 동의를 받지 않고 새로 열도록 안내한다.
const CONSENT_TERMS_VERSION = 'terms-2026-09-30';
const CONSENT_PRIVACY_VERSION = 'privacy-2026-09-30';
const collectionRequests = new WeakMap();

const nftLabels = {
  NOT_REQUESTED: 'NFT 미신청',
  QUEUED: 'NFT 발행 접수',
  CONFIRMING: 'NFT 확인 중',
  FINALIZED: 'NFT 발행 완료',
  REVIEW_REQUIRED: 'NFT 확인 필요',
};
// 운영 API가 nftMinting: 'PREPARING'을 보내면(발행 서버·메인넷 승인 전) 등록 완료가 아닌 NFT 줄을 접수·진행 문구 대신 이것으로 보인다.
const nftPreparingLabel = 'NFT 발행 준비 중';

export function nftLineLabel(item, nftMinting) {
  if (nftMinting === 'PREPARING' && item.nftStatus !== 'FINALIZED') return nftPreparingLabel;
  return nftLabels[item.nftStatus];
}

function isCollection(value) {
  return value && Array.isArray(value.visits) && Array.isArray(value.collectibles)
    && value.visits.every((visit) => visit && typeof visit.merchantName === 'string'
      && typeof visit.businessDate === 'string')
    && value.collectibles.every((item) => item && typeof item.displayName === 'string'
      && typeof item.merchantName === 'string' && item.appCollectibleStatus === 'COLLECTED'
      && Object.hasOwn(nftLabels, item.nftStatus)
      && (item.nftStatus !== 'FINALIZED' || (item.nft && typeof item.nft.tokenId === 'string')));
}

const medalLabels = {
  explorer: { name: '동네 탐험가', what: '서로 다른 가게', unit: '곳' },
  regular: { name: '단골손님', what: '한 가게 최다 방문', unit: '일' },
  steady: { name: '꾸준한 걸음', what: '방문한 날', unit: '일' },
};
const tierLabels = ['도전 전', '브론즈', '실버', '골드'];
const rewardNames = { 1: '첫 번째 상자', 2: '두 번째 상자', 3: '황금 상자' };
const rewardStateLabels = {
  LOCKED: '잠김', READY: '앱에서 열 수 있어요', UNAVAILABLE: '혜택 준비 중', OPENED: '받음',
};
// 관리자가 쿠폰을 무효로 한 상자는 서버가 UNAVAILABLE과 선택 필드 unavailableReason으로 알린다. 옛 서버는 필드가 없어 "혜택 준비 중"이다.
const voidedRewardLabel = '이 혜택은 더 이상 받을 수 없어요';
const rewardChipLabel = (reward) => reward.state === 'UNAVAILABLE' && reward.unavailableReason === 'COUPON_REVOKED'
  ? voidedRewardLabel : rewardStateLabels[reward.state];
const couponStatusLabels = { ISSUED: '사용 가능', REDEEMED: '사용 완료', EXPIRED: '만료', VOIDED: '사용할 수 없는 쿠폰' };
const maxTiers = 9;

// 앱(badge-rules.ts explorerRank)과 같은 등급 이름. 판정은 서버가 준 earnedTiers를 말로 옮길 뿐이다.
function explorerRank(earnedTiers) {
  if (earnedTiers >= 9) return '월계 마스터';
  if (earnedTiers >= 6) return '월계 미식가';
  if (earnedTiers >= 3) return '골목 탐험가';
  if (earnedTiers >= 1) return '동네 산책가';
  return '새내기 탐험가';
}

const kstMonthDay = new Intl.DateTimeFormat('en-US', { timeZone: 'Asia/Seoul', month: 'numeric', day: 'numeric' });
// "~10월 29일까지": 브라우저 시간대가 아니라 한국 날짜로 센다.
function expiryLabel(expiresAt) {
  const parts = kstMonthDay.formatToParts(new Date(expiresAt));
  const part = (type) => parts.find((item) => item.type === type)?.value;
  return `~${part('month')}월 ${part('day')}일까지`;
}

const isCount = (value, max = Infinity) => Number.isSafeInteger(value) && value >= 0 && value <= max;
const isText = value => typeof value === 'string' && value !== '';

function isBadges(value) {
  return value !== null && typeof value === 'object' && isCount(value.earnedTiers, 9)
    && Array.isArray(value.medals) && value.medals.length === 3
    && value.medals.every(medal => medal && Object.hasOwn(medalLabels, medal.kind)
      && isCount(medal.value) && isCount(medal.tier, 3)
      && Array.isArray(medal.thresholds) && medal.thresholds.length === 3
      && medal.thresholds.every(threshold => Number.isSafeInteger(threshold) && threshold > 0))
    && Array.isArray(value.rewards) && value.rewards.length === 3
    && value.rewards.every(reward => reward && [1, 2, 3].includes(reward.milestone)
      && isCount(reward.requiredTiers, 9) && Object.hasOwn(rewardStateLabels, reward.state)
      && (reward.offer === null || (typeof reward.offer === 'object' && isText(reward.offer.merchantName)
        && isText(reward.offer.title)))
      && (reward.coupon === null || (typeof reward.coupon === 'object' && isText(reward.coupon.title)
        && isText(reward.coupon.merchantName) && Object.hasOwn(couponStatusLabels, reward.coupon.status)
        && isText(reward.coupon.expiresAt) && !Number.isNaN(Date.parse(reward.coupon.expiresAt)))));
}

// 메달은 보조 정보라서 늦거나 멈춰도 도감을 막지 않는다. 시간 안에 못 받으면 요청을 끊고 실패로 취급한다.
async function fetchBadges(fetcher, timeoutMs) {
  const controller = new AbortController();
  let timer;
  const timeout = new Promise((resolve) => {
    timer = setTimeout(() => { controller.abort(); resolve(undefined); }, timeoutMs);
  });
  const request = (async () => {
    try {
      const response = await fetcher(BADGES_URL, {
        method: 'GET', credentials: 'same-origin', cache: 'no-store',
        headers: { Accept: 'application/json' }, signal: controller.signal,
      });
      if (!response.ok) return undefined;
      const data = await response.json();
      return isBadges(data) ? data : undefined;
    } catch {
      return undefined;
    }
  })();
  try {
    return await Promise.race([request, timeout]);
  } finally {
    clearTimeout(timer);
  }
}

// 서버가 "동의 필요"라고 하지 않은 경우에만 도감을 읽는다. 확인하지 못하면 막힌 채로 두지 않고 다시 시도를 보인다.
async function readConsent(fetcher) {
  try {
    const response = await fetcher(CONSENT_URL, {
      method: 'GET', credentials: 'same-origin', cache: 'no-store',
      headers: { Accept: 'application/json' },
    });
    if (response.status === 401) return { kind: 'unauthenticated' };
    if (!response.ok) return { kind: 'failed' };
    const data = await response.json();
    if (data === null || typeof data !== 'object' || typeof data.required !== 'boolean'
      || !isText(data.termsVersion) || !isText(data.privacyVersion)) return { kind: 'failed' };
    if (!data.required) return { kind: 'accepted' };
    return data.termsVersion === CONSENT_TERMS_VERSION && data.privacyVersion === CONSENT_PRIVACY_VERSION
      ? { kind: 'required' } : { kind: 'outdated' };
  } catch {
    return { kind: 'failed' };
  }
}

function consentNodes(doc) {
  const names = ['consent-panel', 'consent-age', 'consent-terms', 'consent-privacy', 'consent-submit', 'consent-message'];
  const nodes = Object.fromEntries(names.map((name) => [name, doc.getElementById(name)]));
  return names.every((name) => nodes[name]) ? nodes : null;
}

function resetConsent(nodes, hidden) {
  for (const name of ['consent-age', 'consent-terms', 'consent-privacy']) nodes[name].checked = false;
  nodes['consent-submit'].disabled = true;
  nodes['consent-message'].textContent = '';
  nodes['consent-panel'].hidden = hidden;
}

function hideConsent(doc) {
  const nodes = consentNodes(doc);
  if (nodes) resetConsent(nodes, true);
}

// 이미 보이는 화면은 그대로 둔다: 약관 링크를 새 탭에서 읽고 돌아오면 다시 확인이 돌지만 눌러 둔 체크를 지우지 않는다.
function showConsent(doc) {
  const nodes = consentNodes(doc);
  if (!nodes) return false;
  if (nodes['consent-panel'].hidden) resetConsent(nodes, false);
  return true;
}

function bindConsentControls(fetcher, doc, refresh) {
  const nodes = consentNodes(doc);
  if (!nodes) return;
  const boxes = ['consent-age', 'consent-terms', 'consent-privacy'].map((name) => nodes[name]);
  const complete = () => boxes.every((box) => box.checked === true);
  const update = () => { nodes['consent-submit'].disabled = !complete(); };
  for (const box of boxes) box.addEventListener('change', update);
  let busy = false;
  nodes['consent-submit'].addEventListener('click', async () => {
    if (busy || !complete()) return;
    busy = true;
    nodes['consent-submit'].disabled = true;
    nodes['consent-message'].textContent = '';
    try {
      const response = await fetcher(CONSENT_URL, {
        method: 'POST', credentials: 'same-origin', cache: 'no-store',
        headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
        body: JSON.stringify({
          termsVersion: CONSENT_TERMS_VERSION, privacyVersion: CONSENT_PRIVACY_VERSION,
          ageConfirmed: true, termsAccepted: true, privacyAccepted: true,
        }),
      });
      if (response.status === 401) { await refresh(); return; }
      if (response.status === 409) {
        nodes['consent-message'].textContent = '이용약관이나 개인정보 처리방침이 새로 바뀌었어요. 페이지를 새로 연 뒤 다시 시도해 주세요.';
        return;
      }
      if (!response.ok) throw new Error('consent unavailable');
      const data = await response.json();
      if (data === null || typeof data !== 'object' || data.required !== false) throw new Error('consent not recorded');
      await refresh();
    } catch {
      nodes['consent-message'].textContent = '동의를 기록하지 못했어요. 인터넷 연결을 확인하고 다시 시도해 주세요.';
    } finally {
      busy = false;
      update();
    }
  });
}

function collectionNodes(doc) {
  const names = ['collection-status', 'collection-login', 'collection-retry', 'collection-logout',
    'collection-content', 'visit-list', 'collectible-list', 'badge-list', 'badge-note',
    'badge-content', 'badge-passport', 'reward-list', 'coupon-list'];
  const nodes = Object.fromEntries(names.map((name) => [name, doc.getElementById(name)]));
  return names.every((name) => nodes[name]) ? nodes : null;
}

function clearCollection(nodes) {
  nodes['visit-list'].replaceChildren();
  nodes['collectible-list'].replaceChildren();
  nodes['badge-passport'].replaceChildren();
  nodes['badge-list'].replaceChildren();
  nodes['reward-list'].replaceChildren();
  nodes['coupon-list'].replaceChildren();
  nodes['badge-content'].hidden = true;
  nodes['badge-note'].textContent = '';
  nodes['collection-content'].hidden = true;
  nodes['collection-login'].hidden = true;
  nodes['collection-retry'].hidden = true;
  nodes['collection-logout'].hidden = true;
}

function detail(doc, text) {
  const item = doc.createElement('p');
  item.textContent = text;
  return item;
}

function node(doc, tag, className, text) {
  const element = doc.createElement(tag);
  if (className) element.className = className;
  if (text !== undefined) element.textContent = text;
  return element;
}

// 장식용 조각은 화면 읽기 프로그램에서 숨긴다. 뜻은 항상 옆의 글자가 전한다.
function decorative(element) {
  element.setAttribute('aria-hidden', 'true');
  return element;
}

// 순수 CSS 상자 그림. 크기와 색은 스타일시트가 정한다.
function giftIcon(doc, { gold = false, state = 'LOCKED', dim = false } = {}) {
  const icon = node(doc, 'span', ['gift-icon', gold && 'gold', state === 'LOCKED' && 'locked',
    state === 'OPENED' && 'opened', dim && 'dim'].filter(Boolean).join(' '));
  icon.append(node(doc, 'span', 'gift-bow'));
  return decorative(icon);
}

function renderPassport(doc, nodes, badges, counts) {
  const passport = nodes['badge-passport'];
  const earned = Math.min(maxTiers, badges.earnedTiers);
  const nextBox = badges.rewards.find((reward) => reward.requiredTiers > badges.earnedTiers);
  const ready = badges.rewards.find((reward) => reward.state === 'READY');

  const copy = node(doc, 'div', 'passport-copy');
  const countLine = node(doc, 'p', 'passport-count');
  countLine.append(node(doc, 'span', undefined, '배지 '), node(doc, 'span', 'passport-number', String(earned)),
    node(doc, 'span', undefined, ` / ${maxTiers}`));
  copy.append(node(doc, 'h4', 'passport-rank', explorerRank(badges.earnedTiers)), countLine);
  const main = node(doc, 'div', 'passport-main');
  main.append(decorative(node(doc, 'span', 'passport-stamp')), copy);

  const nextLine = nextBox ? `다음 상자까지 배지 ${nextBox.requiredTiers - badges.earnedTiers}개` : '모든 보상 상자에 닿았어요!';
  const pips = node(doc, 'div', 'passport-pips');
  pips.setAttribute('role', 'img');
  pips.setAttribute('aria-label', `배지 ${maxTiers}개 중 ${earned}개, ${nextLine}`);
  for (let group = 0; group < 3; group += 1) {
    const cluster = node(doc, 'span', 'pip-group');
    for (let slot = 0; slot < 3; slot += 1) {
      cluster.append(node(doc, 'span', group * 3 + slot < earned ? 'pip filled' : 'pip'));
    }
    cluster.append(giftIcon(doc, { gold: group === 2, state: 'READY', dim: earned < (group + 1) * 3 }));
    pips.append(cluster);
  }

  const counter = node(doc, 'div', 'passport-counts');
  for (const [label, value] of [['방문', counts.visits], ['앱 수집품', counts.collectibles], ['실제 NFT', counts.finalizedNfts]]) {
    const pill = node(doc, 'div', 'count-pill');
    pill.append(node(doc, 'strong', 'count-value', String(value)), node(doc, 'span', 'count-label', label));
    counter.append(pill);
  }

  passport.append(node(doc, 'p', 'passport-eyebrow', '나의 탐험 여권'), main, pips, node(doc, 'p', 'passport-next', nextLine));
  if (ready) {
    const cta = node(doc, 'p', 'passport-cta');
    cta.append(giftIcon(doc, { gold: ready.milestone === 3, state: 'READY' }),
      node(doc, 'span', undefined, `${rewardNames[ready.milestone]}를 앱에서 열 수 있어요`));
    passport.append(cta);
  }
  passport.append(counter);
}

function renderMedals(doc, nodes, badges) {
  for (const medal of badges.medals) {
    const label = medalLabels[medal.kind];
    const earned = medal.tier > 0;
    const card = node(doc, 'li', `medal-card tier-${medal.tier} ${earned ? 'earned' : 'locked'}`);
    const ring = node(doc, 'span', 'medal-ring');
    ring.append(node(doc, 'span', 'medal-face'));
    const next = medal.tier >= 3 ? '골드 달성! 최고 등급이에요'
      : `${tierLabels[medal.tier + 1]}까지 ${Math.max(0, medal.thresholds[medal.tier] - medal.value)}${label.unit} 더`;
    card.append(decorative(ring),
      node(doc, 'h5', 'medal-name', label.name),
      node(doc, 'span', 'chip tier-chip', tierLabels[medal.tier]),
      node(doc, 'p', 'medal-value', `${label.what} ${medal.value}${label.unit}`),
      node(doc, 'p', 'medal-next', next));
    nodes['badge-list'].append(card);
  }
}

function renderRewards(doc, nodes, badges) {
  for (const reward of badges.rewards) {
    const row = node(doc, 'li', `reward-row state-${reward.state.toLowerCase()}${reward.state === 'READY' ? ' ready' : ''}`);
    const art = node(doc, 'span', 'reward-art');
    art.append(giftIcon(doc, { gold: reward.milestone === 3, state: reward.state }));
    const title = node(doc, 'div', 'reward-title');
    title.append(node(doc, 'h5', 'reward-name', rewardNames[reward.milestone]),
      node(doc, 'span', 'reward-need', `배지 ${reward.requiredTiers}개`));
    const body = node(doc, 'div', 'reward-body');
    body.append(title, node(doc, 'span', `chip state-chip state-${reward.state.toLowerCase()}`, rewardChipLabel(reward)));
    // 받은 뒤에는 쿠폰 티켓이 혜택을 보여 주므로 예고 문구는 잠김·열 수 있음 상태에서만 쓴다.
    if (reward.offer && (reward.state === 'LOCKED' || reward.state === 'READY')) {
      body.append(node(doc, 'p', 'reward-offer', `${reward.offer.merchantName} · ${reward.offer.title}`));
    }
    row.append(decorative(art), body);
    nodes['reward-list'].append(row);
  }
}

function renderCoupons(doc, nodes, badges) {
  const coupons = badges.rewards.filter((reward) => reward.coupon).map((reward) => ({ milestone: reward.milestone, coupon: reward.coupon }));
  if (coupons.length === 0) {
    const empty = detail(doc, '아직 받은 쿠폰이 없어요. 상자를 열면 쿠폰이 생겨요.');
    empty.className = 'empty-note';
    nodes['coupon-list'].append(empty);
  }
  for (const { milestone, coupon } of coupons) {
    const ticket = node(doc, 'article', `ticket ticket-${coupon.status.toLowerCase()}`);
    const top = node(doc, 'div', 'ticket-main');
    top.append(node(doc, 'p', 'ticket-eyebrow', `${rewardNames[milestone]} 쿠폰`),
      node(doc, 'h5', 'ticket-title', coupon.title),
      node(doc, 'p', 'ticket-merchant', coupon.merchantName));
    if (coupon.status === 'ISSUED' && typeof coupon.detail === 'string' && coupon.detail.trim()) {
      top.append(node(doc, 'p', 'ticket-detail', coupon.detail));
    }
    const foot = node(doc, 'div', 'ticket-foot');
    foot.append(node(doc, 'span', 'chip ticket-chip', couponStatusLabels[coupon.status]));
    // 무효 쿠폰에는 "~까지" 만료 날짜가 오해를 부르므로 보이지 않는다.
    if (coupon.status !== 'VOIDED') foot.append(node(doc, 'span', 'ticket-expiry', expiryLabel(coupon.expiresAt)));
    ticket.append(top, foot);
    if (coupon.status === 'REDEEMED') ticket.append(decorative(node(doc, 'span', 'ticket-stamp', '사용 완료')));
    nodes['coupon-list'].append(ticket);
  }
}

function renderBadges(doc, nodes, badges, counts) {
  renderPassport(doc, nodes, badges, counts);
  renderMedals(doc, nodes, badges);
  renderRewards(doc, nodes, badges);
  renderCoupons(doc, nodes, badges);
  nodes['badge-note'].textContent = `배지 ${badges.earnedTiers}/9개를 모았어요. 보상 상자는 앱에서 열어요.`;
  nodes['badge-content'].hidden = false;
}

export async function loadCollection(fetcher, doc, { badgesTimeoutMs = BADGES_TIMEOUT_MS } = {}) {
  const nodes = collectionNodes(doc);
  if (!nodes) return;
  const requestId = (collectionRequests.get(doc) ?? 0) + 1;
  collectionRequests.set(doc, requestId);
  clearCollection(nodes);
  nodes['collection-status'].textContent = '내 도감을 확인하는 중입니다.';
  const consent = await readConsent(fetcher);
  if (collectionRequests.get(doc) !== requestId) return;
  // 동의가 필요한 경우에만 동의 화면이 남는다. 그 밖의 결과(로그인 필요·확인 실패·버전 불일치·동의함)에서는 닫는다.
  if (consent.kind !== 'required') hideConsent(doc);
  if (consent.kind === 'unauthenticated') {
    nodes['collection-status'].textContent = '내 도감을 보려면 Google 계정으로 로그인해 주세요.';
    nodes['collection-login'].hidden = false;
    return;
  }
  if (consent.kind === 'failed') {
    nodes['collection-status'].textContent = '동의 상태를 확인하지 못했습니다. 다시 시도해 주세요.';
    nodes['collection-retry'].hidden = false;
    return;
  }
  if (consent.kind === 'outdated') {
    nodes['collection-status'].textContent = '이용약관이나 개인정보 처리방침이 새로 바뀌었어요. 페이지를 새로 연 뒤 다시 시도해 주세요.';
    nodes['collection-retry'].hidden = false;
    nodes['collection-logout'].hidden = false;
    return;
  }
  if (consent.kind === 'required') {
    if (showConsent(doc)) {
      nodes['collection-status'].textContent = '이용을 시작하기 전에 아래 내용에 동의해 주세요.';
    } else {
      nodes['collection-status'].textContent = '동의 화면을 열 수 없습니다. 다시 시도해 주세요.';
      nodes['collection-retry'].hidden = false;
    }
    nodes['collection-logout'].hidden = false;
    return;
  }
  const badgesRequest = fetchBadges(fetcher, badgesTimeoutMs);
  let collectionShown = false;
  let counts;

  try {
    const response = await fetcher(COLLECTION_URL, {
      method: 'GET', credentials: 'same-origin', cache: 'no-store',
      headers: { Accept: 'application/json' },
    });
    if (collectionRequests.get(doc) !== requestId) return;
    if (response.status === 401) {
      nodes['collection-status'].textContent = '내 도감을 보려면 Google 계정으로 로그인해 주세요.';
      nodes['collection-login'].hidden = false;
      return;
    }
    if (!response.ok) throw new Error('collection unavailable');
    const data = await response.json();
    if (collectionRequests.get(doc) !== requestId) return;
    if (!isCollection(data)) throw new Error('invalid collection');

    for (const visit of data.visits) {
      const card = doc.createElement('article');
      card.className = 'collection-card visit-card';
      const name = doc.createElement('h4');
      name.textContent = visit.merchantName;
      card.append(name, detail(doc, `${visit.businessDate} 방문`));
      nodes['visit-list'].append(card);
    }
    for (const item of data.collectibles) {
      const card = doc.createElement('article');
      card.className = 'collection-card';
      const name = doc.createElement('h4');
      name.textContent = item.displayName;
      const nft = detail(doc, nftLineLabel(item, data.nftMinting));
      nft.className = item.nftStatus === 'FINALIZED' ? 'nft-line done' : 'nft-line';
      card.append(name, detail(doc, `${item.merchantName} · 앱 수집품`), nft);
      nodes['collectible-list'].append(card);
    }
    nodes['collection-status'].textContent = data.visits.length + data.collectibles.length === 0
      ? '방문 기록과 수집품이 아직 없습니다. 앱에서 방문을 인증하면 이곳에서 확인할 수 있습니다.'
      : `방문 ${data.visits.length}건, 앱 수집품 ${data.collectibles.length}개를 확인했습니다.`;
    nodes['collection-content'].hidden = false;
    nodes['collection-logout'].hidden = false;
    nodes['badge-note'].textContent = '탐험 메달을 확인하는 중이에요.';
    counts = {
      visits: data.visits.length,
      collectibles: data.collectibles.length,
      finalizedNfts: data.collectibles.filter((item) => item.nftStatus === 'FINALIZED').length,
    };
    collectionShown = true;
  } catch {
    if (collectionRequests.get(doc) !== requestId) return;
    clearCollection(nodes);
    nodes['collection-status'].textContent = '도감을 불러올 수 없습니다. 다시 시도해 주세요.';
    nodes['collection-retry'].hidden = false;
  }
  if (!collectionShown) return;

  // 방문·수집품을 먼저 보여준 뒤 메달이 도착하면 그때 그린다. 그 사이 로그아웃·재조회가 있었다면 버린다.
  const badges = await badgesRequest;
  if (collectionRequests.get(doc) !== requestId) return;
  if (badges) renderBadges(doc, nodes, badges, counts);
  else nodes['badge-note'].textContent = '탐험 메달을 불러오지 못했어요. 방문 기록과 수집품은 아래에서 볼 수 있어요.';
}

export function bindCollectionControls(fetcher, doc) {
  const nodes = collectionNodes(doc);
  if (!nodes) return;
  const Channel = doc.defaultView?.BroadcastChannel;
  const channel = Channel ? new Channel('masscom-web-session') : undefined;
  const invalidate = () => {
    collectionRequests.set(doc, (collectionRequests.get(doc) ?? 0) + 1);
    // 동의 화면은 개인 기록이 없어 지우지 않는다: 숨겨진 사이에 눌러 둔 체크를 잃지 않게 하고, 다시 보일 때 서버 답에 따라 닫는다.
    clearCollection(nodes);
    nodes['collection-status'].textContent = '내 도감을 다시 확인해 주세요.';
  };
  const refresh = () => loadCollection(fetcher, doc);
  bindConsentControls(fetcher, doc, refresh);
  if (channel) {
    channel.onmessage = (event) => {
      if (event.data !== 'refresh') return;
      invalidate();
      if (!doc.hidden) void refresh();
    };
  }
  doc.addEventListener('visibilitychange', () => {
    if (doc.hidden) invalidate();
    else return refresh();
  });
  doc.defaultView?.addEventListener('pagehide', invalidate);
  doc.defaultView?.addEventListener('pageshow', (event) => {
    if (event?.persisted !== false) return refresh();
  });
  nodes['collection-retry'].addEventListener('click', () => { void loadCollection(fetcher, doc); });
  nodes['collection-logout'].addEventListener('click', async () => {
    invalidate();
    nodes['collection-status'].textContent = '로그아웃하는 중입니다.';
    try {
      const response = await fetcher('/api/web/logout', {
        method: 'POST', credentials: 'same-origin', cache: 'no-store',
      });
      if (!response.ok) throw new Error('logout unavailable');
      channel?.postMessage('refresh');
      await refresh();
    } catch {
      nodes['collection-status'].textContent = '로그아웃을 확인하지 못했습니다. 다시 확인해 주세요.';
      nodes['collection-retry'].hidden = false;
    }
  });
  return refresh().then(() => { channel?.postMessage('refresh'); });
}

function isMerchant(value) {
  return value !== null && typeof value === 'object'
    && typeof value.name === 'string' && value.name.trim() !== ''
    && typeof value.story === 'string'
    && typeof value.roadAddress === 'string'
    && (value.businessHours === undefined || (typeof value.businessHours === 'string' && value.businessHours.length <= 1000))
    && (value.menuItems === undefined || (Array.isArray(value.menuItems) && value.menuItems.length <= 30 &&
      value.menuItems.every(item => item && typeof item.name === 'string' && item.name.trim() &&
        item.name.length <= 200 && Number.isSafeInteger(item.priceWon) &&
        item.priceWon >= 0 && item.priceWon <= 1_000_000_000)))
    && typeof value.demo === 'boolean';
}

export async function loadMerchants(fetcher, doc) {
  const status = doc.getElementById('merchant-status');
  const list = doc.getElementById('merchant-list');
  if (!status || !list) return;

  try {
    const response = await fetcher(MERCHANTS_URL, {
      method: 'GET',
      credentials: 'same-origin',
      headers: { Accept: 'application/json' },
    });
    if (!response.ok) throw new Error('merchant request failed');
    const payload = await response.json();
    if (!payload || !Array.isArray(payload.merchants) || !payload.merchants.every(isMerchant)) {
      throw new Error('invalid merchant response');
    }

    const merchants = payload.merchants.filter((merchant) => merchant.demo === false);
    list.replaceChildren();
    for (const merchant of merchants) {
      const card = doc.createElement('article');
      card.className = 'merchant-card';
      const name = doc.createElement('h3');
      name.textContent = merchant.name;
      const address = doc.createElement('p');
      address.className = 'merchant-address';
      address.textContent = merchant.roadAddress;
      const story = doc.createElement('p');
      story.className = 'merchant-story';
      story.textContent = merchant.story;
      card.append(name, address);
      if (merchant.story) card.append(story);
      const hours = doc.createElement('p');
      hours.className = 'merchant-hours';
      hours.textContent = `점포 제공 영업시간 · ${merchant.businessHours || '영업시간 정보가 아직 없습니다.'}`;
      card.append(hours);
      const menu = doc.createElement('h4');
      menu.textContent = '메뉴·가격';
      card.append(menu);
      if (merchant.menuItems?.length) {
        for (const item of merchant.menuItems) {
          const row = doc.createElement('p');
          row.className = 'menu-row';
          row.textContent = `${item.name} · ${item.priceWon.toLocaleString('ko-KR')}원`;
          card.append(row);
        }
      } else {
        const empty = doc.createElement('p');
        empty.className = 'menu-empty';
        empty.textContent = '메뉴 정보가 아직 없습니다.';
        card.append(empty);
      }
      list.append(card);
    }
    status.textContent = merchants.length === 0
      ? '현재 공개된 음식점이 없습니다.'
      : `${merchants.length}곳의 음식점을 불러왔습니다.`;
  } catch {
    list.replaceChildren();
    status.textContent = '현재 웹에서 음식점 목록을 불러올 수 없습니다. 잠시 후 다시 확인해 주세요.';
  }
}

if (typeof document !== 'undefined') {
  void loadMerchants(fetch, document);
  void bindCollectionControls(fetch, document);
}
