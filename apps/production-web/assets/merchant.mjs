const merchantRequests = new WeakMap();
const merchantClaimResolutions = new WeakMap();
const merchantClaimSlots = new WeakMap();

const isStaffCoupon = coupon => coupon !== null && typeof coupon === 'object'
  && typeof coupon.couponId === 'string' && coupon.couponId !== ''
  && typeof coupon.title === 'string' && coupon.title !== '' && typeof coupon.detail === 'string'
  && typeof coupon.expiresAt === 'string' && !Number.isNaN(Date.parse(coupon.expiresAt));

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
      const option = doc.createElement('option');
      option.value = merchant.id;
      option.textContent = merchant.name;
      claimSelect.append(option);
    }
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
      text.textContent = `${coupon.title}${coupon.detail ? ` · ${coupon.detail}` : ''} · 만료: ${new Date(coupon.expiresAt).toLocaleDateString('ko-KR', { timeZone: 'Asia/Seoul' })}`;
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
    setIssuing(false);
  };
  doc.defaultView?.addEventListener('pagehide', clear);
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
