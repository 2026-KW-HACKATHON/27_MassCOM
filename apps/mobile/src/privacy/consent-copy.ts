/**
 * 첫 로그인 동의 화면의 문구와 버전(Issue #253, D-059). 서버 상수(apps/api/src/account-consent.ts)와 공개 페이지(docs/terms.html·privacy.html)의
 * 버전 이름은 시험이 서로 비교한다. 화면이 보여 주는 문구가 이 버전의 것이므로 버전은 앱이 들고 있고, 서버가 다른 버전을 요구하면 동의를 보내지 않고
 * 앱 업데이트를 안내한다.
 */
export const CONSENT_TERMS_VERSION = 'terms-2026-10-06';
export const CONSENT_PRIVACY_VERSION = 'privacy-2026-10-09';

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
    body: '음식점 탐색, 방문 인증과 보상 지급, 놀이 기록·공간 꾸미기와 선택한 공개 범위에서 다른 사용자에게 진열 보여 주기, 친구 우정·쪽지·식사 초대, 선택한 알림 전달과 점주 직접 운영, 로그인 유지, 부정 이용 방지, 계정 삭제 처리. 내가 공개 범위를 정한 뒤에만 허용된 방문자에게 내 방과 방명록이 보여요. 모두 공개는 로그인한 전체 사용자, 친구 공개는 친구만 볼 수 있어요. 기존 같은 가게 이웃 공개는 내가 바꾸기 전까지 유지돼요. 방명록에는 작성자의 별명·프로필 그림·한 줄 소개·글이 보이고, 작성자 창에서 달성도·업적을 보거나 친구를 추가할 수 있어요. 내가 다른 사람의 방에 남긴 방명록 글은 그 방의 허용된 방문자에게 내 별명과 함께 보여요. 친구에게는 방 공개 범위와 상관없이 별명, 메달 3종의 등급, 배지 수, 가본 가게의 이름과 친구 순위가 보이고, 한국 날짜 기준 어제까지의 방문만 세므로 하루 늦게 반영돼요. 권한 있는 점주에게만 제공하는 방문 CSV는 인정 방문의 방문일·초 단위 방문시각(한국 시간)·캠페인·방문구분(MassCOM 확인 기준)·수집보상·쿠폰 발급·쿠폰 사용 건수로 제한해요. 고객 이름·계정 식별자·가명 고객 표시는 CSV에 넣지 않아요.',
  },
  {
    title: '수집 항목',
    body: 'Google 계정 식별자(이메일·이름은 저장하지 않아요), 방문·보상·도감·놀이 실행/점수 기록, 선택한 동행·배지·진열·옷·공간·꾸미기·목표, 가게권 개봉 상태, 알림 설정과 선택적 기기 토큰, 로그인 세션. 지갑을 연결하면 공개 지갑 주소, 친구·이웃 기능을 쓰면 별명·한 줄 소개·방 공개 범위·가상 방 방문·방명록 글과 읽음 상태·방명록 마일리지·반응·차단·친구 관계·우정·쪽지·식사 가게와 날짜·시간을 저장해요(자세한 항목은 개인정보 처리방침).',
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

/**
 * 한눈에 보는 세 줄 요약(목적·항목 / 보유 기간 / 거부 시 결과). 화면은 이 요약을 먼저 보이고, 위의 전체 안내(consentNotice)는 "자세히 보기"에서 펼친다.
 * 요약은 안내를 줄여 쓴 것이므로 안내의 사실과 어긋나지 않아야 한다(시험이 키워드로 확인한다).
 * 키 이름은 일부러 title/body가 아니다: 웹 동의 시험(tests/site/verify_production_web_test.mjs)이 이 파일에서 title/body 쌍을 세어 안내 네 가지와 웹 페이지를 비교한다.
 */
export const consentSummary: readonly { heading: string; text: string }[] = [
  {
    heading: '목적·항목',
    text: '음식점 탐색, 방문 인증과 보상, 놀이·꾸미기 기록을 위해 Google 계정 식별자, 방문·보상·도감·놀이 기록, 로그인 세션·알림 설정을 저장해요(이메일·이름은 저장하지 않아요). 지갑·친구 기능을 쓰면 그 정보가 더해져요. 공개 범위에 따라 로그인한 전체 사용자 또는 친구가 내 방과 방명록을 볼 수 있고, 방명록 작성자의 프로필·달성도·업적도 보여요. 기존 같은 가게 이웃 공개는 직접 바꾸기 전까지 유지돼요. 공개 범위와 상관없이 친구에게는 별명·메달 등급·가본 가게 이름·순위가 하루 늦게 보여요. 다른 사람의 방에 남긴 내 방명록 글은 그 방 방문자에게 보여요. 권한 있는 점주는 방문일·방문시각·캠페인·방문구분·보상·쿠폰 건수가 담긴 방문 CSV를 받아요. 전체 항목은 "자세히 보기"에서 확인해요.',
  },
  {
    heading: '보유 기간',
    text: '계정을 삭제할 때까지 보관해요. 삭제 요청을 처리하면(접수 뒤 7일 이내) 지우거나 알아볼 수 없게 바꿔요. 감사 기록·백업 등 일부는 정해진 기간 더 보관돼요(자세한 기간은 개인정보 처리방침).',
  },
  {
    heading: '동의하지 않으면',
    text: '동의하지 않을 수 있어요. 그러면 로그인이 필요한 방문 인증·도감·보상을 쓸 수 없고, 언제든 로그아웃할 수 있어요.',
  },
];

export const consentCopy = {
  title: '이용을 시작하기 전에\n확인해 주세요',
  intro: '월계 마스코트를 쓰려면 아래 세 가지에 모두 동의해야 해요. 선택 동의는 없어요.',
  noticeTitle: '개인정보 수집·이용 안내',
  details: '자세히 보기',
  detailsHint: '개인정보 수집·이용 안내의 전체 내용을 펼치거나 접습니다.',
  agreeAll: '전체 동의',
  agreeAllHint: '아래 필수 세 가지를 한 번에 선택하거나 모두 해제합니다.',
  individualHeading: '개별 확인',
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
