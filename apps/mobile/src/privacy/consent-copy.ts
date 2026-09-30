/**
 * 첫 로그인 동의 화면의 문구와 버전(Issue #253, D-059). 서버 상수(apps/api/src/account-consent.ts)와 공개 페이지(docs/terms.html·privacy.html)의
 * 버전 이름은 시험이 서로 비교한다. 화면이 보여 주는 문구가 이 버전의 것이므로 버전은 앱이 들고 있고, 서버가 다른 버전을 요구하면 동의를 보내지 않고
 * 앱 업데이트를 안내한다.
 */
export const CONSENT_TERMS_VERSION = 'terms-2026-09-30';
export const CONSENT_PRIVACY_VERSION = 'privacy-2026-09-30';

export const TERMS_URL = 'https://www.masscom.kr/terms';
export const PRIVACY_URL = 'https://www.masscom.kr/privacy';
export const ACCOUNT_DELETION_URL = 'https://www.masscom.kr/account-deletion';

/** 내 정보(계정 설정)에서 여는 페이지 링크. 계정 삭제 안내는 안내 페이지일 뿐이고 삭제 요청 화면을 대신하지 않는다. */
export const legalLinks: readonly { label: string; url: string; hint: string }[] = [
  { label: '이용약관', url: TERMS_URL, hint: '이용약관 페이지를 브라우저에서 엽니다.' },
  { label: '개인정보 처리방침', url: PRIVACY_URL, hint: '개인정보 처리방침 페이지를 브라우저에서 엽니다.' },
  { label: '계정 삭제 안내', url: ACCOUNT_DELETION_URL, hint: '계정 삭제 안내 페이지를 브라우저에서 엽니다. 삭제 요청은 이 화면 아래에서 합니다.' },
];

export type ConsentCheckKey = 'ageConfirmed' | 'termsAccepted' | 'privacyAccepted';

export type ConsentCheck = {
  key: ConsentCheckKey;
  label: string;
  link?: { label: string; url: string; hint: string };
};

/** 필수 세 개. 선택 동의는 없다. */
export const consentChecks: readonly ConsentCheck[] = [
  { key: 'ageConfirmed', label: '[필수] 만 14세 이상입니다.' },
  {
    key: 'termsAccepted',
    label: '[필수] 이용약관에 동의합니다.',
    link: { label: '이용약관 보기', url: TERMS_URL, hint: '이용약관 페이지를 브라우저에서 엽니다.' },
  },
  {
    key: 'privacyAccepted',
    label: '[필수] 개인정보 수집·이용에 동의합니다.',
    link: { label: '개인정보 처리방침 보기', url: PRIVACY_URL, hint: '개인정보 처리방침 페이지를 브라우저에서 엽니다.' },
  },
];

/** 개인정보 수집·이용 안내 네 가지(목적·항목·보유 기간·거부할 권리와 불이익). */
export const consentNotice: readonly { title: string; body: string }[] = [
  {
    title: '수집·이용 목적',
    body: '음식점 탐색, 방문 인증과 보상 지급, 로그인 유지, 부정 이용 방지, 계정 삭제 처리',
  },
  {
    title: '수집 항목',
    body: 'Google 계정 식별자(이메일·이름은 저장하지 않아요), 방문·보상·도감 기록, 로그인 세션. 지갑을 연결하면 공개 지갑 주소, 친구 기능을 쓰면 별명·친구 관계 등(자세한 항목은 개인정보 처리방침)',
  },
  {
    title: '보유 기간',
    body: '계정을 삭제할 때까지 보관해요. 삭제 요청을 처리하면 지우거나 알아볼 수 없게 바꿔요. 세션·삭제 접수 기록·감사 기록 등 세부 기간은 개인정보 처리방침에서 확인할 수 있어요.',
  },
  {
    title: '동의를 거부할 권리와 불이익',
    body: '동의하지 않을 수 있어요. 동의하지 않으면 로그인이 필요한 방문 인증·도감·보상을 쓸 수 없어요. 언제든 로그아웃하거나 동의 없이 나갈 수 있어요.',
  },
];

export const consentCopy = {
  title: '이용을 시작하기 전에\n확인해 주세요',
  intro: '월계 마스코트를 쓰려면 아래 세 가지에 모두 동의해야 해요. 선택 동의는 없어요.',
  noticeTitle: '개인정보 수집·이용 안내',
  submit: '동의하고 시작',
  submitting: '동의를 기록하는 중',
  submitHint: '세 가지를 모두 선택하면 눌러 시작할 수 있어요.',
  submitReadyHint: '동의를 서버에 기록하고 앱을 시작합니다.',
  logout: '동의하지 않고 로그아웃',
  /** 동의 상태를 확인하지 못했거나 앱 업데이트가 필요한 화면에서는 동의를 거부하는 것이 아니므로 중립적인 이름을 쓴다. */
  logoutNeutral: '로그아웃',
  loading: '동의 상태를 확인하는 중입니다.',
  checkFailed: '동의 상태를 확인하지 못했어요. 인터넷 연결을 확인하고 다시 시도해 주세요.',
  submitFailed: '동의를 기록하지 못했어요. 인터넷 연결을 확인하고 다시 시도해 주세요.',
  versionMismatch: '이용약관이나 개인정보 처리방침이 새로 바뀌었어요. 앱을 업데이트한 뒤 다시 시도해 주세요.',
  retry: '다시 시도',
  openLinkFailed: '페이지를 열지 못했어요. 브라우저에서 www.masscom.kr 주소를 직접 열어 주세요.',
} as const;
