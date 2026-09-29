const endpoint = '/api/web/admin/merchants';
const deletionEndpoint = '/api/web/admin/account-deletion-intakes';
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

// 삭제 처리는 되돌릴 수 없어 두 번 눌러야 하고, 확인 상태는 이 시간이 지나거나 초점이 떠나면 풀린다.
const disarmAfterMs = 5000;
const armedMessage = '한 번 더 누르면 이 계정의 로그인·지갑 연결·권한이 삭제 처리됩니다.';
const sourceLabels = { WEB: '웹 접수', SHOWCASE_APP: '시연 앱 접수' };
const statusLabels = { REQUESTED: '대기', CANCELLED: '취소됨', PROCESSED: '처리 완료', REJECTED: '거절됨' };
const ledgerLabels = { WAITING_FOR_MINT_FINALITY: '제출된 거래 결과 확인 중', COMPLETED: '삭제 완료' };

// 한국 표준시 분 단위. 서버 시각은 UTC ISO이고 운영자는 KST 기한을 본다.
export function formatKst(iso) {
  const time = Date.parse(iso);
  if (!Number.isFinite(time)) return '-';
  return `${new Date(time + 9 * 60 * 60 * 1000).toISOString().slice(0, 16).replace('T', ' ')} KST`;
}

function deletionErrorText(error) {
  if (error.code === 'DELETION_COOLING_OFF') return '아직 취소 기간이라 처리할 수 없습니다.';
  if (error.code === 'DELETION_SELF_PROCESSING_REFUSED') return '본인 요청은 처리할 수 없습니다. 다른 관리자가 처리해야 합니다.';
  if (error.code === 'DELETION_INTAKE_NOT_PENDING' || error.code === 'DELETION_INTAKE_NOT_FOUND') {
    return '이미 처리·취소·거절된 요청입니다. 새로고침해 주세요.';
  }
  if (error.code === 'DELETION_REJECT_REASON_INVALID') return '거절 사유를 1자 이상 200자 이하로 입력해 주세요.';
  return '요청을 처리하지 못했습니다.';
}

function deletionRow(fetcher, doc, intake, status) {
  if (typeof intake.id !== 'string' || !statusLabels[intake.status] || !sourceLabels[intake.source]) {
    throw new Error('invalid deletion intake');
  }
  const row = doc.createElement('div');
  row.className = 'admin-deletion';
  const head = doc.createElement('p');
  head.textContent = `${sourceLabels[intake.source]} · ${statusLabels[intake.status]} · 계정 ${intake.accountLabel ?? '삭제됨'}${intake.hasReceipt === false ? ' · 옛 접수(접수번호 없음)' : ''}`;
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
  setProcessLabel(intake.canProcess ? '삭제 처리' : '취소 기간 중 · 처리 불가');
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
  const reason = doc.createElement('input');
  reason.name = 'reason';
  reason.maxLength = 200;
  reason.required = true;
  reason.setAttribute('aria-label', `${subject} 거절 사유`);
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
  row.append(process, reason, reject);
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
  const deletions = doc.getElementById('admin-deletions');
  const create = doc.getElementById('admin-create');
  if (!status || !login || !logout || !content || !list || !create) return;
  content.hidden = true;
  login.hidden = true;
  logout.hidden = true;
  list.replaceChildren();
  operations?.replaceChildren();
  draftList?.replaceChildren();
  draftMerchant?.replaceChildren();
  deletions?.replaceChildren();
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
    if (deletions) {
      try {
        await loadDeletions(fetcher, doc, deletions, status, () => adminRequests.get(doc) === requestId);
      } catch (error) {
        if (adminRequests.get(doc) !== requestId) return;
        if (error.status === 401 || error.status === 403) throw error;
        deletions.textContent = '계정 삭제 요청 목록을 불러오지 못했습니다.';
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
    deletions?.replaceChildren();
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
    doc.getElementById('admin-deletions')?.replaceChildren();
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
