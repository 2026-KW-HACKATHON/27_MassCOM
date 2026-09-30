const merchantRequests = new WeakMap();
const merchantClaimResolutions = new WeakMap();
const merchantClaimSlots = new WeakMap();
// bindMerchant이 둔 최근 목록 읽기 함수. loadMerchant가 점포 권한을 확인하고 구역을 연 뒤 부른다.
const reversalRefreshers = new WeakMap();
const creators = new WeakMap();
const creatorScopes = new WeakMap();

function closeCreator(doc) {
  creators.get(doc)?.();
  creators.delete(doc);
  doc.getElementById('merchant-creator-editor')?.replaceChildren();
}

function configureCreator(fetcher, doc, mine) {
  const panel = doc.getElementById('merchant-creator');
  const select = doc.getElementById('merchant-creator-store');
  const open = doc.getElementById('merchant-creator-open');
  if (!panel || !select || !open) return;
  const scope = `${mine.accountScope ?? ''}:${mine.merchants.map(member => `${member.id}:${member.role}`).sort().join(',')}`;
  if (!mine.accountScope || creatorScopes.get(doc) !== scope) closeCreator(doc);
  creatorScopes.set(doc, scope);
  select.replaceChildren();
  for (const merchant of mine.merchants) {
    const option = doc.createElement('option'); option.value = merchant.id; option.textContent = merchant.name; select.append(option);
  }
  panel.hidden = mine.merchants.length === 0;
  open.onclick = async () => {
    const currentRequest = merchantRequests.get(doc);
    const merchant = mine.merchants.find(member => member.id === select.value);
    if (!merchant) return;
    open.disabled = true;
    try {
      const [module, catalog] = await Promise.all([
        import('./collectible-editor.mjs'), request(fetcher, '/merchants'),
      ]);
      if (merchantRequests.get(doc) !== currentRequest) return;
      const campaigns = (catalog.merchants ?? []).filter(item => item.id === merchant.id).map(item => item.campaign);
      closeCreator(doc);
      const cleanup = await module.mountCollectibleEditor(doc.getElementById('merchant-creator-editor'), {
        merchantId: merchant.id, merchantName: merchant.name, campaigns,
        request: (path, options = {}) => request(fetcher, path, options.method ?? 'GET', options.body),
        onNotice: message => { doc.getElementById('merchant-status').textContent = message; },
      });
      if (merchantRequests.get(doc) !== currentRequest) { cleanup?.(); return; }
      creators.set(doc, cleanup);
    } catch (error) {
      if (merchantRequests.get(doc) === currentRequest) doc.getElementById('merchant-status').textContent = error.status === 403
        ? '이 점포의 그림 제작 권한이 없어요. 점주 권한을 확인해 주세요.' : '제작기를 열지 못했어요. 다시 시도해 주세요.';
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
  try {
    const [mine, eligible] = await Promise.all([
      request(fetcher, '/api/web/merchant/me'),
      request(fetcher, '/api/web/merchant/registration-merchants'),
    ]);
    if (merchantRequests.get(doc) !== requestId) return;
    if (!Array.isArray(mine.merchants) || !Array.isArray(eligible.merchants)) throw new Error('invalid merchant data');
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
    }
    if (reversalPanel) reversalPanel.hidden = mine.merchants.length === 0;
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
    // 구역이 열리면 최근 방문·쿠폰 사용을 바로 읽는다(실패해도 점포 화면은 그대로다).
    if (mine.merchants.length > 0) await reversalRefreshers.get(doc)?.();
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
  // 점포를 바꾸면 이전 점포 목록을 지우고 새 점포 목록을 바로 읽는다.
  reversalSelect?.addEventListener('change', () => { resetReversal(); void refreshReversal(); });
  reversalRefreshers.set(doc, () => refreshReversal());
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
    closeCreator(doc);
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
    setIssuing(false);
  };
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
