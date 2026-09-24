const MERCHANTS_URL = '/merchants';
const COLLECTION_URL = '/api/web/collection';
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

function collectionNodes(doc) {
  const names = ['collection-status', 'collection-login', 'collection-retry', 'collection-logout',
    'collection-content', 'visit-list', 'collectible-list'];
  const nodes = Object.fromEntries(names.map((name) => [name, doc.getElementById(name)]));
  return names.every((name) => nodes[name]) ? nodes : null;
}

function clearCollection(nodes) {
  nodes['visit-list'].replaceChildren();
  nodes['collectible-list'].replaceChildren();
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

export async function loadCollection(fetcher, doc) {
  const nodes = collectionNodes(doc);
  if (!nodes) return;
  const requestId = (collectionRequests.get(doc) ?? 0) + 1;
  collectionRequests.set(doc, requestId);
  clearCollection(nodes);
  nodes['collection-status'].textContent = '내 도감을 확인하는 중입니다.';

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
  } catch {
    if (collectionRequests.get(doc) !== requestId) return;
    clearCollection(nodes);
    nodes['collection-status'].textContent = '도감을 불러올 수 없습니다. 다시 시도해 주세요.';
    nodes['collection-retry'].hidden = false;
  }
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
      card.append(name, address, story);
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
