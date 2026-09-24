const MERCHANTS_URL = '/merchants';

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
}
