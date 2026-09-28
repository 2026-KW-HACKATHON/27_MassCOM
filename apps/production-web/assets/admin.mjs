const endpoint = '/api/web/admin/merchants';
const adminRequests = new WeakMap();

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
    throw error;
  }
  return response.json();
}

function fields(form) {
  const data = new FormData(form);
  return {
    name: String(data.get('name') ?? ''),
    story: String(data.get('story') ?? ''),
    roadAddress: String(data.get('roadAddress') ?? ''),
    minimumSpendWon: Number(data.get('minimumSpendWon')),
  };
}

function editField(doc, label, name, value, type = 'text') {
  const wrapper = doc.createElement('label');
  wrapper.textContent = label + ' ';
  const input = doc.createElement(name === 'story' ? 'textarea' : 'input');
  input.name = name;
  if (input.tagName === 'INPUT') input.type = type;
  input.value = String(value);
  input.required = name === 'name' || name === 'roadAddress' || name === 'minimumSpendWon';
  wrapper.append(input);
  return wrapper;
}

export async function loadAdmin(fetcher, doc) {
  const requestId = (adminRequests.get(doc) ?? 0) + 1;
  adminRequests.set(doc, requestId);
  const status = doc.getElementById('admin-status');
  const login = doc.getElementById('admin-login');
  const content = doc.getElementById('admin-content');
  const list = doc.getElementById('admin-merchants');
  const create = doc.getElementById('admin-create');
  if (!status || !login || !content || !list || !create) return;
  content.hidden = true;
  login.hidden = true;
  list.replaceChildren();
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
      state.textContent = merchant.status === 'PAUSED' ? '비공개' : '공개 가능';
      const save = doc.createElement('button');
      save.type = 'submit';
      save.textContent = '수정 저장';
      const hide = doc.createElement('button');
      hide.type = 'button';
      hide.textContent = '비공개 및 신규 참여 중지';
      form.append(title, state,
        editField(doc, '상점 이름', 'name', merchant.name),
        editField(doc, '소개', 'story', merchant.story),
        editField(doc, '도로명 주소', 'roadAddress', merchant.roadAddress),
        editField(doc, '최소 결제 금액(원)', 'minimumSpendWon', merchant.minimumSpendWon, 'number'),
        save, hide);
      form.addEventListener('submit', async event => {
        event.preventDefault();
        save.disabled = true;
        try {
          await jsonRequest(fetcher, `${endpoint}/${encodeURIComponent(merchant.id)}`, 'PATCH', {
            ...fields(form), expectedVersion: merchant.version,
          });
          await loadAdmin(fetcher, doc);
          status.textContent = '상점을 수정했습니다.';
        } catch (error) {
          status.textContent = error.status === 409 ? '다른 변경이 먼저 저장되었습니다. 새로고침해 주세요.' : '수정하지 못했습니다.';
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
          status.textContent = error.status === 409 ? '다른 변경이 먼저 저장되었습니다. 새로고침해 주세요.' : '비공개로 전환하지 못했습니다.';
          hide.disabled = false;
        }
      });
      list.append(form);
    }
    status.textContent = payload.merchants.length ? `${payload.merchants.length}곳의 실제 상점입니다.` : '등록된 실제 상점이 없습니다.';
    content.hidden = false;
  } catch (error) {
    if (adminRequests.get(doc) !== requestId) return;
    if (error.status === 401) {
      status.textContent = '관리자 계정으로 로그인해 주세요.';
      login.hidden = false;
    } else if (error.status === 403) {
      status.textContent = '관리자 권한이 없습니다.';
    } else {
      status.textContent = '관리자 정보를 불러오지 못했습니다. 새로고침해 주세요.';
    }
  }
}

export function bindAdmin(fetcher, doc) {
  const form = doc.getElementById('admin-create');
  const status = doc.getElementById('admin-status');
  const clear = () => {
    adminRequests.set(doc, (adminRequests.get(doc) ?? 0) + 1);
    doc.getElementById('admin-merchants')?.replaceChildren();
    doc.getElementById('admin-content').hidden = true;
  };
  doc.defaultView?.addEventListener('pagehide', clear);
  doc.defaultView?.addEventListener('pageshow', event => {
    if (event.persisted) void loadAdmin(fetcher, doc);
  });
  doc.addEventListener?.('visibilitychange', () => {
    if (doc.hidden) clear();
    else void loadAdmin(fetcher, doc);
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
    } catch {
      status.textContent = '상점을 저장하지 못했습니다.';
    } finally { button.disabled = false; }
  });
  return loadAdmin(fetcher, doc);
}

if (typeof document !== 'undefined') void bindAdmin(fetch, document);
