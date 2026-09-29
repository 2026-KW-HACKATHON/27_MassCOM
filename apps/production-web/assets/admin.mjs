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
    try { error.code = (await response.json()).code; } catch { /* Keep the status when no JSON body is available. */ }
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
    menuItems: parseMenuLines(String(data.get('menuItems') ?? '')),
    businessHours: String(data.get('businessHours') ?? ''),
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
  return { merchantId: String(data.get('merchantId') ?? ''), title: String(data.get('title') ?? '').trim(),
    startsAt, endsAt, enrollmentCapacity, rewardGoals };
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
    case 'ADMIN_COUPON_NOT_VOIDABLE': return '이미 사용한 쿠폰은 무효로 할 수 없어요.';
    case 'ADMIN_COUPON_NOT_FOUND': return '쿠폰을 찾을 수 없어요. 목록을 새로 불러와 주세요.';
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
  if (name === 'menuItems') input.maxLength = 8000;
  input.required = name === 'name' || name === 'roadAddress' || name === 'minimumSpendWon';
  wrapper.append(input);
  return wrapper;
}

export async function loadAdmin(fetcher, doc) {
  const requestId = (adminRequests.get(doc) ?? 0) + 1;
  adminRequests.set(doc, requestId);
  const status = doc.getElementById('admin-status');
  const login = doc.getElementById('admin-login');
  const logout = doc.getElementById('admin-logout');
  const content = doc.getElementById('admin-content');
  const list = doc.getElementById('admin-merchants');
  const operations = doc.getElementById('admin-operations');
  const draftForm = doc.getElementById('admin-campaign-draft');
  const draftList = doc.getElementById('admin-campaign-drafts');
  const draftMerchant = draftForm?.querySelector('select');
  const create = doc.getElementById('admin-create');
  if (!status || !login || !logout || !content || !list || !create) return;
  content.hidden = true;
  login.hidden = true;
  logout.hidden = true;
  list.replaceChildren();
  operations?.replaceChildren();
  draftList?.replaceChildren();
  draftMerchant?.replaceChildren();
  if (draftForm) draftForm.hidden = true;
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
      hide.className = 'danger';
      form.append(title, state,
        editField(doc, '상점 이름', 'name', merchant.name),
        editField(doc, '소개', 'story', merchant.story),
        editField(doc, '메뉴·가격 (한 줄에 메뉴명 | 가격)', 'menuItems',
          (merchant.menuItems ?? []).map(item => `${item.name} | ${item.priceWon}`).join('\n')),
        editField(doc, '점포 제공 영업시간', 'businessHours', merchant.businessHours ?? ''),
        editField(doc, '도로명 주소', 'roadAddress', merchant.roadAddress),
        editField(doc, '최소 결제 금액(원)', 'minimumSpendWon', merchant.minimumSpendWon, 'number'),
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
      const couponPanel = doc.createElement('section');
      couponPanel.className = 'admin-coupons';
      const couponTitle = doc.createElement('h4');
      couponTitle.textContent = '쿠폰 관리';
      const couponHelp = doc.createElement('p');
      couponHelp.textContent = '이 점포에서 쓰는 보상 쿠폰 최근 100장입니다. 아직 쓰지 않은 쿠폰만 사유와 함께 무효로 할 수 있고 사용한 쿠폰은 바꿀 수 없습니다. 고객 계정은 가림 표시로만 보입니다.';
      const couponLoad = doc.createElement('button');
      couponLoad.type = 'button';
      couponLoad.textContent = '쿠폰 목록 불러오기';
      const couponStatus = doc.createElement('p');
      couponStatus.setAttribute('role', 'status');
      couponStatus.setAttribute('aria-live', 'polite');
      const couponList = doc.createElement('ul');
      couponList.className = 'reversal-list';
      couponPanel.append(couponTitle, couponHelp, couponLoad, couponStatus, couponList);
      staffPanel.append(couponPanel);
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
              noteLabel.textContent = '메모(선택, 100자까지 · 연락처·이메일·주소는 적지 마세요) ';
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
              voidButton.setAttribute('aria-label', `${coupon.title} ${coupon.customerLabel} 쿠폰 무효화`);
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
            ? '관리자 권한을 확인하지 못했어요. 다시 로그인해 주세요.' : '쿠폰 목록을 불러오지 못했어요. 다시 시도해 주세요.';
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
        }
        if (!staff.staff.length) staffList.textContent = '승인된 직원이 없습니다.';
      } catch {
        if (adminRequests.get(doc) !== requestId) return;
        staffList.textContent = '직원 목록을 불러오지 못했습니다.';
      }
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
            ...fields(form), expectedVersion: merchant.version,
          });
          await loadAdmin(fetcher, doc);
          status.textContent = '상점을 수정했습니다.';
        } catch (error) {
          status.textContent = error.message?.startsWith('메뉴') ? error.message
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
    }
    if (draftForm) draftForm.hidden = payload.merchants.length === 0;
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
    if (draftList) {
      try {
        const campaigns = await jsonRequest(fetcher, '/api/web/admin/campaign-drafts');
        if (adminRequests.get(doc) !== requestId) return;
        if (!Array.isArray(campaigns.drafts)) throw new Error('invalid campaign drafts');
        if (!campaigns.drafts.length) draftList.textContent = '저장된 비공개 초안이 없습니다.';
        for (const draft of campaigns.drafts) {
          const item = doc.createElement('p');
          item.textContent = `${draft.merchantName} · ${draft.title} · 비공개 초안 · 정원 ${draft.enrollmentCapacity}명`;
          draftList.append(item);
        }
      } catch (error) {
        if (adminRequests.get(doc) !== requestId) return;
        if (error.status === 401 || error.status === 403) throw error;
        draftList.textContent = '캠페인 초안 목록을 불러오지 못했습니다.';
      }
    }
    status.textContent = payload.merchants.length ? `${payload.merchants.length}곳의 실제 상점입니다.` : '등록된 실제 상점이 없습니다.';
    content.hidden = false;
    logout.textContent = '로그아웃';
    logout.hidden = false;
  } catch (error) {
    if (adminRequests.get(doc) !== requestId) return;
    list.replaceChildren();
    operations?.replaceChildren();
    draftList?.replaceChildren();
    draftMerchant?.replaceChildren();
    if (draftForm) draftForm.hidden = true;
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
    adminRequests.set(doc, (adminRequests.get(doc) ?? 0) + 1);
    doc.getElementById('admin-merchants')?.replaceChildren();
    doc.getElementById('admin-operations')?.replaceChildren();
    doc.getElementById('admin-campaign-drafts')?.replaceChildren();
    const draftForm = doc.getElementById('admin-campaign-draft');
    draftForm?.querySelector('select')?.replaceChildren();
    if (draftForm) draftForm.hidden = true;
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
      status.textContent = error.message?.startsWith('메뉴') ? error.message : '상점을 저장하지 못했습니다.';
    } finally { button.disabled = false; }
  });
  const draftForm = doc.getElementById('admin-campaign-draft');
  let draftSaving = false;
  draftForm?.addEventListener('submit', async event => {
    event.preventDefault();
    if (draftSaving) return;
    const requestId = adminRequests.get(doc);
    const button = draftForm.querySelector('button[type="submit"]');
    draftSaving = true;
    button.disabled = true;
    try {
      await jsonRequest(fetcher, '/api/web/admin/campaign-drafts', 'POST',
        campaignDraftPayload(new FormData(draftForm)));
      if (adminRequests.get(doc) !== requestId) return;
      draftForm.reset();
      await loadAdmin(fetcher, doc);
      if (!doc.getElementById('admin-content').hidden) status.textContent = '비공개 캠페인 초안을 저장했습니다.';
    } catch (error) {
      if (adminRequests.get(doc) === requestId) status.textContent = error.message?.includes('주세요')
        ? error.message : '초안을 저장하지 못했습니다.';
    } finally { draftSaving = false; button.disabled = false; }
  });
  return loadAdmin(fetcher, doc);
}

if (typeof document !== 'undefined') void bindAdmin(fetch, document);
