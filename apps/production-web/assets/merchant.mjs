const merchantRequests = new WeakMap();

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
    try { error.code = (await response.json()).code; } catch { /* status is enough */ }
    throw error;
  }
  return response.status === 204 ? undefined : response.json();
}

export async function loadMerchant(fetcher, doc) {
  const requestId = (merchantRequests.get(doc) ?? 0) + 1;
  merchantRequests.set(doc, requestId);
  const status = doc.getElementById('merchant-status');
  const login = doc.getElementById('merchant-login');
  const logout = doc.getElementById('merchant-logout');
  const content = doc.getElementById('merchant-content');
  const list = doc.getElementById('merchant-memberships');
  const select = doc.querySelector('#merchant-registration select');
  const code = doc.getElementById('merchant-code');
  content.hidden = true;
  login.hidden = true;
  logout.hidden = true;
  list.replaceChildren();
  select.replaceChildren();
  code.textContent = '';
  try {
    const [mine, eligible] = await Promise.all([
      request(fetcher, '/api/web/merchant/me'),
      request(fetcher, '/api/web/merchant/registration-merchants'),
    ]);
    if (merchantRequests.get(doc) !== requestId) return;
    if (!Array.isArray(mine.merchants) || !Array.isArray(eligible.merchants)) throw new Error('invalid merchant data');
    for (const merchant of mine.merchants) {
      const item = doc.createElement('p');
      item.textContent = `${merchant.name} · ${merchant.role === 'OWNER' ? '점주' : '직원'}`;
      list.append(item);
    }
    if (!mine.merchants.length) list.textContent = '아직 승인된 점포가 없습니다.';
    for (const merchant of eligible.merchants) {
      if (mine.merchants.some(member => member.id === merchant.id)) continue;
      const option = doc.createElement('option');
      option.value = merchant.id;
      option.textContent = merchant.name;
      select.append(option);
    }
    doc.getElementById('merchant-registration').hidden = select.children.length === 0;
    content.hidden = false;
    logout.hidden = false;
    status.textContent = '점포 권한을 확인했습니다.';
  } catch (error) {
    if (merchantRequests.get(doc) !== requestId) return;
    if (error.status === 401) {
      login.hidden = false;
      status.textContent = error.code === 'WEB_AUTH_ACCOUNT_NOT_FOUND'
        ? '고객 앱에서 이 Google 계정으로 먼저 로그인해 주세요.' : 'Google 계정으로 로그인해 주세요.';
    } else status.textContent = '점포 정보를 불러오지 못했습니다. 새로고침해 주세요.';
  }
}

export function bindMerchant(fetcher, doc) {
  const status = doc.getElementById('merchant-status');
  const code = doc.getElementById('merchant-code');
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
    merchantRequests.set(doc, (merchantRequests.get(doc) ?? 0) + 1);
    doc.getElementById('merchant-content').hidden = true;
    doc.getElementById('merchant-memberships').replaceChildren();
    code.textContent = '';
    try {
      await request(fetcher, '/api/web/logout', 'POST');
      await loadMerchant(fetcher, doc);
    } catch { status.textContent = '로그아웃을 확인하지 못했습니다.'; }
  });
  const clear = () => {
    merchantRequests.set(doc, (merchantRequests.get(doc) ?? 0) + 1);
    doc.getElementById('merchant-content').hidden = true;
    doc.getElementById('merchant-memberships').replaceChildren();
    code.textContent = '';
  };
  doc.defaultView?.addEventListener('pagehide', clear);
  doc.defaultView?.addEventListener('pageshow', event => {
    if (event.persisted) void loadMerchant(fetcher, doc);
  });
  doc.addEventListener?.('visibilitychange', () => {
    if (doc.hidden) clear();
    else void loadMerchant(fetcher, doc);
  });
  return loadMerchant(fetcher, doc);
}

if (typeof document !== 'undefined') void bindMerchant(fetch, document);
