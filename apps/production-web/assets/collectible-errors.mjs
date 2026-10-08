// 수집품 제작·탐색·열람·집계 API가 돌려주는 오류 코드마다 한국어 안내를 붙인다(docs/COLLECTIBLE_CREATOR.md "서버 계약").
// 새 코드가 생기면 여기에 문구를 추가해야 한다. tests/site/collectible-errors.test.mjs가 문서·서버의 코드 목록과 맞는지 검사한다.
export const COLLECTIBLE_ERROR_MESSAGES = {
  AI_ART_NOT_CONFIGURED: '현재 AI 그림 생성이 준비되지 않았어요. 미리 준비한 이미지로 스튜디오를 시작해 주세요.',
  AI_ART_DAILY_LIMIT: '오늘 만들 수 있는 AI 초안을 모두 사용했어요. 기존 초안이나 준비한 이미지로 계속해 주세요.',
  AI_ART_ACCOUNT_DAILY_LIMIT: '이 계정의 AI 그림 생성 횟수가 오늘 한도에 도달했어요. 초안·완성은 모든 가게에서 각각 3회까지예요.',
  AI_ART_COOLDOWN: '계정당 AI 그림 생성은 최소 60초 간격이에요.',
  AI_ART_BUDGET_EXHAUSTED: 'AI 그림 생성 한도에 도달했어요. 기존 초안이나 준비한 이미지로 계속해 주세요.',
  AI_ART_TRIAL_DISABLED: '이 체험 점포에서는 AI 생성이 꺼져 있어요. 준비한 이미지로 스튜디오를 시작해 주세요.',
  AI_ART_ROUND_IN_PROGRESS: '이미 생성 중인 AI 초안이 있어요. 생성 상태를 다시 확인해 주세요.',
  AI_ART_MODERATION_BLOCKED: 'AI가 이 그림을 만들지 못했어요. 다른 자료로 제작을 시작해 주세요.',
  AI_ART_UPSTREAM_UNAVAILABLE: 'AI 서비스에 연결하지 못했어요. 잠시 뒤 상태를 확인하거나 준비한 이미지로 계속해 주세요.',
  AI_ART_TIMEOUT: 'AI 그림 생성 시간이 길어졌어요. 상태를 다시 확인하거나 준비한 이미지로 계속해 주세요.',
  AI_ART_INTERRUPTED: 'AI 그림 생성이 중단됐어요. 상태를 다시 확인하거나 준비한 이미지로 계속해 주세요.',
  INVALID_REQUEST: '요청 형식이 맞지 않아요. 화면을 새로 열어 다시 시도해 주세요. 입력은 그대로 있어요.',
  COLLECTIBLE_INVALID_PROJECT: '수집품 내용이 저장 조건에 맞지 않아요. 이름·스티커·효과·사진 크기를 확인하고 다시 저장해 주세요. 입력은 그대로 있어요.',
  COLLECTIBLE_MEDIA_TOO_LARGE: '사진이나 음성 파일이 너무 커요. 원본 사진은 3 MB, 음성은 1 MB·30초 이하로 줄여 다시 저장해 주세요. 입력은 그대로 있어요.',
  BODY_TOO_LARGE: '수집품 전체 크기가 8 MB를 넘었어요. 작은 사진·음성으로 바꾸거나 쓰지 않는 장면 사진과 등급을 줄여 다시 저장해 주세요. 입력은 그대로 있어요.',
  COLLECTIBLE_PROJECT_NOT_FOUND: '이 프로젝트를 찾을 수 없어요. 이미 삭제했거나 다른 점포의 것일 수 있어요. 저장 목록을 새로 불러와 주세요.',
  COLLECTIBLE_VERSION_CONFLICT: '다른 화면에서 초안이 변경됐어요. 현재 입력은 유지했어요. 목록에서 최신 초안을 다시 열거나 새 초안으로 저장해 주세요.',
  COLLECTIBLE_PUBLISHED_IMMUTABLE: '게시한 버전은 고칠 수 없어요. 새 초안으로 복사한 뒤 수정해 주세요. 현재 입력은 그대로 있어요.',
  COLLECTIBLE_CAMPAIGN_UNAVAILABLE: '방문 보상을 지금 게시할 수 없어요. 표준 1·3·5회 방문 보상 캠페인이 준비됐는지 확인해 주세요. 입력은 그대로 있어요.',
  COLLECTIBLE_DEFAULT_GRADE_MISSING: '편집기를 새로고침한 뒤 다시 게시해 주세요',
  COLLECTIBLE_PUBLICATION_SIZE_LIMIT: '게시할 등급 자료가 너무 커요. 음성·이야기 장면·추가 등급을 줄인 뒤 다시 게시해 주세요. 입력은 그대로 있어요.',
  COLLECTIBLE_NOT_READY: '게시에 필요한 자료가 덜 준비됐어요. 사진·보상 연결·이야기 장면 사진을 확인하고 다시 게시해 주세요. 입력은 그대로 있어요.',
  COLLECTIBLE_PROJECT_LIMIT: '수집품 프로젝트는 점포마다 100개까지 만들 수 있어요. 쓰지 않는 초안을 삭제한 뒤 다시 저장해 주세요. 입력은 그대로 있어요.',
  COLLECTIBLE_PUBLICATION_LIMIT: '이 점포는 게시를 100번까지 할 수 있어요. 게시한 수집품은 이미 받은 고객을 위해 보관돼 삭제해도 줄지 않아요. 더 게시해야 하면 운영자에게 문의해 주세요. 입력은 그대로 있어요.',
  COLLECTIBLE_NOT_PUBLISHED: '아직 게시하지 않은 프로젝트예요. 저장 목록을 새로 불러와 상태를 확인해 주세요.',
  COLLECTIBLE_RATE_LIMITED: '저장·게시 요청이 너무 잦아요. 점포마다 1분에 20번까지 할 수 있어요.',
  MERCHANT_ACCESS_DENIED: '이 점포의 수집품 제작 권한이 없어요. 점주 권한을 확인해 주세요.',
  ACCOUNT_DELETED: '계정이 삭제돼 처리할 수 없어요.',
  COLLECTIBLE_PROJECTS_NOT_CONFIGURED: '수집품 저장 기능이 아직 준비되지 않았어요. 잠시 뒤 다시 시도해 주세요. 입력은 그대로 있어요.',
  COLLECTIBLE_PREVIEW_NOT_CONFIGURED: '수집품 미리보기 기능이 아직 준비되지 않았어요. 잠시 뒤 다시 확인해 주세요.',
  COLLECTIBLE_PREVIEW_NOT_FOUND: '지금 공개된 수집품 미리보기가 없어요. 가게의 공개 상태와 수집품 연결을 확인해 주세요.',
  MERCHANT_NOT_FOUND: '공개 중인 가게를 찾을 수 없어요. 가게 목록을 새로 불러와 주세요.',
  MERCHANT_DETAIL_VIEWS_NOT_CONFIGURED: '가게 상세 열람 집계가 아직 준비되지 않았어요. 잠시 뒤 다시 확인해 주세요.',
  VIEW_SOURCE_INVALID: '가게 상세 화면에 들어온 경로를 확인하지 못했어요. 화면을 다시 열어 주세요.',
  VIEW_RATE_LIMITED: '가게 상세 열람 요청이 너무 잦아요.',
  ADMIN_FUNNEL_NOT_CONFIGURED: '방문 효과 집계가 아직 준비되지 않았어요. 잠시 뒤 다시 조회해 주세요.',
  FUNNEL_DAYS_INVALID: '방문 효과 조회 기간은 7일부터 90일까지 선택해 주세요.',
};
export const COLLECTIBLE_ERROR_CODES = Object.keys(COLLECTIBLE_ERROR_MESSAGES);

/** 편집기가 스스로 만든 안내(이미 한국어)는 그대로, 서버 코드·상태는 위 문구로, 그 밖은 fallback으로 바꾼다. */
export const localError = message => Object.assign(new Error(message), { local: true });

export function collectibleErrorMessage(error, fallback = '저장하지 못했어요. 사진과 편집 내용은 그대로 있어요. 잠시 뒤 다시 시도해 주세요.') {
  if (error?.local) return error.message;
  const seconds = Number.isFinite(error?.retryAfterSeconds) && error.retryAfterSeconds > 0 ? error.retryAfterSeconds : 0;
  const wait = seconds ? ` ${seconds}초 뒤에 다시 시도해 주세요.` : ' 잠시 뒤에 다시 시도해 주세요.';
  const known = COLLECTIBLE_ERROR_MESSAGES[error?.code];
  if (known && error?.code?.startsWith('AI_ART_')) return `${known}${seconds ? ` ${seconds}초 뒤에 다시 시도해 주세요.` : ''}`;
  if (error?.code === 'VIEW_RATE_LIMITED') return `${known}${wait}`;
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
