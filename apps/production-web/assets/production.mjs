const MERCHANTS_URL = '/merchants';
const COLLECTION_URL = '/api/web/collection';
const BADGES_URL = '/api/web/badges';
const BADGES_TIMEOUT_MS = 8000;
const collectionRequests = new WeakMap();

const nftLabels = {
  NOT_REQUESTED: 'NFT 미신청',
  QUEUED: 'NFT 발행 접수',
  CONFIRMING: 'NFT 확인 중',
  FINALIZED: 'NFT 발행 완료',
  REVIEW_REQUIRED: 'NFT 확인 필요',
};

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
const tierLabels = ['미획득', '브론즈', '실버', '골드'];
const rewardNames = { 1: '첫 번째 상자', 2: '두 번째 상자', 3: '황금 상자' };
const rewardStateLabels = {
  LOCKED: '잠김', READY: '열 수 있어요 (앱에서 열기)', UNAVAILABLE: '혜택 준비 중', OPENED: '받음',
};
const couponStatusLabels = { ISSUED: '사용 가능', REDEEMED: '사용 완료', EXPIRED: '기간 만료' };

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

function collectionNodes(doc) {
  const names = ['collection-status', 'collection-login', 'collection-retry', 'collection-logout',
    'collection-content', 'visit-list', 'collectible-list', 'badge-list', 'badge-note',
    'badge-content', 'reward-list', 'coupon-list'];
  const nodes = Object.fromEntries(names.map((name) => [name, doc.getElementById(name)]));
  return names.every((name) => nodes[name]) ? nodes : null;
}

function clearCollection(nodes) {
  nodes['visit-list'].replaceChildren();
  nodes['collectible-list'].replaceChildren();
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

function renderBadges(doc, nodes, badges) {
  for (const medal of badges.medals) {
    const label = medalLabels[medal.kind];
    const row = doc.createElement('li');
    row.className = medal.tier > 0 ? 'badge-step earned' : 'badge-step';
    const next = medal.tier >= 3 ? '최고 등급이에요'
      : `다음 등급까지 ${Math.max(0, medal.thresholds[medal.tier] - medal.value)}${label.unit} 남음`;
    row.textContent = `${label.name} · ${tierLabels[medal.tier]} · ${label.what} ${medal.value}${label.unit} · ${next}`;
    nodes['badge-list'].append(row);
  }
  for (const reward of badges.rewards) {
    const row = doc.createElement('li');
    row.className = reward.state === 'OPENED' ? 'badge-step earned' : 'badge-step';
    row.textContent = `${rewardNames[reward.milestone]} · 배지 ${reward.requiredTiers}개 · ${rewardStateLabels[reward.state]}`
      + (reward.offer ? ` · ${reward.offer.merchantName} ${reward.offer.title}` : '');
    nodes['reward-list'].append(row);
  }
  const coupons = badges.rewards.map(reward => reward.coupon).filter(Boolean);
  if (coupons.length === 0) {
    nodes['coupon-list'].append(detail(doc, '아직 받은 쿠폰이 없어요. 상자를 열면 쿠폰이 생겨요.'));
  }
  for (const coupon of coupons) {
    const card = doc.createElement('article');
    card.className = 'collection-card';
    const name = doc.createElement('h5');
    name.textContent = coupon.title;
    card.append(name,
      detail(doc, `${coupon.merchantName} · 만료: ${new Date(coupon.expiresAt).toLocaleDateString('ko-KR', { timeZone: 'Asia/Seoul' })}`),
      detail(doc, couponStatusLabels[coupon.status]));
    nodes['coupon-list'].append(card);
  }
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
  const badgesRequest = fetchBadges(fetcher, badgesTimeoutMs);
  let collectionShown = false;

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
      card.className = 'collection-card';
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
      card.append(name, detail(doc, `${item.merchantName} · 앱 수집품`),
        detail(doc, nftLabels[item.nftStatus]));
      nodes['collectible-list'].append(card);
    }
    nodes['collection-status'].textContent = data.visits.length + data.collectibles.length === 0
      ? '방문 기록과 수집품이 아직 없습니다. 앱에서 방문을 인증하면 이곳에서 확인할 수 있습니다.'
      : `방문 ${data.visits.length}건, 앱 수집품 ${data.collectibles.length}개를 확인했습니다.`;
    nodes['collection-content'].hidden = false;
    nodes['collection-logout'].hidden = false;
    nodes['badge-note'].textContent = '탐험 메달을 확인하는 중이에요.';
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
  if (badges) renderBadges(doc, nodes, badges);
  else nodes['badge-note'].textContent = '탐험 메달을 불러오지 못했어요. 방문 기록과 수집품은 아래에서 볼 수 있어요.';
}

export function bindCollectionControls(fetcher, doc) {
  const nodes = collectionNodes(doc);
  if (!nodes) return;
  const Channel = doc.defaultView?.BroadcastChannel;
  const channel = Channel ? new Channel('masscom-web-session') : undefined;
  const invalidate = () => {
    collectionRequests.set(doc, (collectionRequests.get(doc) ?? 0) + 1);
    clearCollection(nodes);
    nodes['collection-status'].textContent = '내 도감을 다시 확인해 주세요.';
  };
  const refresh = () => loadCollection(fetcher, doc);
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
      hours.textContent = `점포 제공 영업시간 · ${merchant.businessHours || '영업시간 정보가 아직 없습니다.'}`;
      card.append(hours);
      const menu = doc.createElement('h4');
      menu.textContent = '메뉴·가격';
      card.append(menu);
      if (merchant.menuItems?.length) {
        for (const item of merchant.menuItems) {
          const row = doc.createElement('p');
          row.textContent = `${item.name} · ${item.priceWon.toLocaleString('ko-KR')}원`;
          card.append(row);
        }
      } else {
        const empty = doc.createElement('p');
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
