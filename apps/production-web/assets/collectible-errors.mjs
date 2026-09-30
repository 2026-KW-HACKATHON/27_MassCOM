// 수집품 제작·저장 API가 돌려주는 오류 코드마다 점주가 바로 할 수 있는 말을 붙인다(docs/COLLECTIBLE_CREATOR.md "서버 계약").
// 새 코드가 생기면 여기에 문구를 추가해야 한다. tests/site/collectible-errors.test.mjs가 문서·서버의 코드 목록과 맞는지 검사한다.
export const COLLECTIBLE_ERROR_MESSAGES = {
  INVALID_REQUEST: '요청 형식이 맞지 않아요. 화면을 새로 열어 다시 시도해 주세요. 입력은 그대로 있어요.',
  COLLECTIBLE_INVALID_PROJECT: '수집품 내용이 저장 조건에 맞지 않아요. 이름·스티커·효과·사진 크기를 확인하고 다시 저장해 주세요. 입력은 그대로 있어요.',
  COLLECTIBLE_MEDIA_TOO_LARGE: '사진이나 음성 파일이 너무 커요. 원본 사진은 3 MB, 음성은 1 MB·30초 이하로 줄여 다시 저장해 주세요. 입력은 그대로 있어요.',
  BODY_TOO_LARGE: '수집품 전체 크기가 8 MB를 넘었어요. 작은 사진·음성으로 바꾸거나 쓰지 않는 장면 사진과 등급을 줄여 다시 저장해 주세요. 입력은 그대로 있어요.',
  COLLECTIBLE_PROJECT_NOT_FOUND: '이 프로젝트를 찾을 수 없어요. 이미 삭제했거나 다른 점포의 것일 수 있어요. 저장 목록을 새로 불러와 주세요.',
  COLLECTIBLE_VERSION_CONFLICT: '다른 화면에서 초안이 변경됐어요. 현재 입력은 유지했어요. 목록에서 최신 초안을 다시 열거나 새 초안으로 저장해 주세요.',
  COLLECTIBLE_PUBLISHED_IMMUTABLE: '게시한 버전은 고칠 수 없어요. 새 초안으로 복사한 뒤 수정해 주세요. 현재 입력은 그대로 있어요.',
  COLLECTIBLE_CAMPAIGN_UNAVAILABLE: '선택한 캠페인에는 지금 게시할 수 없어요. 진행 중인 공개 캠페인인지, 연결한 방문 목표가 그 캠페인에 있는지 확인해 주세요. 입력은 그대로 있어요.',
  COLLECTIBLE_NOT_READY: '게시에 필요한 자료가 덜 준비됐어요. 사진·보상 연결·이야기 장면 사진을 확인하고 다시 게시해 주세요. 입력은 그대로 있어요.',
  COLLECTIBLE_PROJECT_LIMIT: '수집품 프로젝트는 점포마다 100개까지 만들 수 있어요. 쓰지 않는 초안을 삭제한 뒤 다시 저장해 주세요. 입력은 그대로 있어요.',
  COLLECTIBLE_NOT_PUBLISHED: '아직 게시하지 않은 프로젝트예요. 저장 목록을 새로 불러와 상태를 확인해 주세요.',
  COLLECTIBLE_RATE_LIMITED: '저장·게시 요청이 너무 잦아요. 점포마다 1분에 20번까지 할 수 있어요.',
  MERCHANT_ACCESS_DENIED: '이 점포의 수집품 제작 권한이 없어요. 점주 권한을 확인해 주세요.',
  ACCOUNT_DELETED: '계정이 삭제돼 처리할 수 없어요.',
  COLLECTIBLE_PROJECTS_NOT_CONFIGURED: '수집품 저장 기능이 아직 준비되지 않았어요. 잠시 뒤 다시 시도해 주세요. 입력은 그대로 있어요.',
};
export const COLLECTIBLE_ERROR_CODES = Object.keys(COLLECTIBLE_ERROR_MESSAGES);

/** 편집기가 스스로 만든 안내(이미 한국어)는 그대로, 서버 코드·상태는 위 문구로, 그 밖은 fallback으로 바꾼다. */
export const localError = message => Object.assign(new Error(message), { local: true });

export function collectibleErrorMessage(error, fallback = '저장하지 못했어요. 사진과 편집 내용은 그대로 있어요. 잠시 뒤 다시 시도해 주세요.') {
  if (error?.local) return error.message;
  const seconds = Number.isFinite(error?.retryAfterSeconds) && error.retryAfterSeconds > 0 ? error.retryAfterSeconds : 0;
  const wait = seconds ? ` ${seconds}초 뒤에 다시 시도해 주세요.` : ' 잠시 뒤에 다시 시도해 주세요.';
  const known = COLLECTIBLE_ERROR_MESSAGES[error?.code];
  if (error?.code === 'COLLECTIBLE_RATE_LIMITED' || error?.status === 429) return `${COLLECTIBLE_ERROR_MESSAGES.COLLECTIBLE_RATE_LIMITED}${wait} 입력은 그대로 있어요.`;
  if (known) return known;
  // 코드 없이 상태만 온 응답(프록시·세션 만료 등)도 원인별로 안내한다.
  if (error?.status === 401) return '로그인이 만료됐어요. 입력은 그대로 있으니 다시 로그인한 뒤 저장해 주세요.';
  if (error?.status === 403) return COLLECTIBLE_ERROR_MESSAGES.MERCHANT_ACCESS_DENIED;
  if (error?.status === 413) return COLLECTIBLE_ERROR_MESSAGES.BODY_TOO_LARGE;
  if (error?.status >= 500) return '서버가 지금 응답하지 못했어요. 입력은 그대로 있어요. 잠시 뒤 다시 시도해 주세요.';
  // 상태가 없으면 요청이 서버에 닿지 못한 것(오프라인 등)이다. 인터넷 안내는 이 경우에만 쓴다.
  if (error?.status === undefined && error instanceof TypeError) return '인터넷 연결을 확인하고 다시 시도해 주세요. 입력은 그대로 있어요.';
  return fallback;
}
