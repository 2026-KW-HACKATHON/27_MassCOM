# 웹 디자인 체계: 앱 탐험 여권과 같은 언어 (Issue #218)

앱(`apps/mobile/src/theme/palette.ts`, `medal-colors.ts`, `src/gamification/`)이 정본이다. 웹은 색·글자 크기·카드·버튼·브랜드를 앱과 같게 쓰고, 화면 폭에 맞춰 배치만 넓힌다. 새 외부 글꼴·CDN·이미지 서비스는 쓰지 않는다(CSP `default-src 'none'` 유지, 이미지는 `img-src 'self'`만 추가).

## 1. 색 토큰 (모든 웹 CSS 첫 블록에 그대로)

```css
:root {
  color-scheme: light dark;
  --mc-bg: #FFFFFF; --mc-surface: #F5F7FA; --mc-label: #192331; --mc-secondary: #58677D; --mc-separator: #DDE3EC;
  --mc-primary: #2456D6; --mc-on-primary: #FFFFFF; --mc-primary-container: #EBF1FF; --mc-on-primary-container: #192331;
  --mc-success: #2D6A4F; --mc-success-container: #DDEFE5; --mc-on-success-container: #174D35;
  --mc-error: #9A371D; --mc-error-container: #FCE4DA; --mc-on-error-container: #7B2718;
  --mc-accent-container: #F7E8C9; --mc-on-accent-container: #4D3516;
  --mc-sky-1: #BFE3FF; --mc-sky-2: #E4F3FF; --mc-sky-3: #F7FBFF; --mc-sky-ink: #192331; --mc-sky-muted: #3B4A5E;
  --mc-bronze: #C47A3F; --mc-bronze-edge: #8A5226; --mc-bronze-container: #F6E6D6; --mc-on-bronze-container: #7A4A1E;
  --mc-silver: #B8C3D0; --mc-silver-edge: #6F7C8C; --mc-silver-container: #E8EDF3; --mc-on-silver-container: #3F4A5A;
  --mc-gold: #E2B33A; --mc-gold-edge: #8F6708; --mc-gold-container: #FBEFC4; --mc-on-gold-container: #6B4E00;
  --mc-locked-edge: #7A8595; --mc-locked-fill: #EEF1F5; --mc-stamp-ink: #A3401F;
  --mc-radius-card: 20px; --mc-radius-control: 14px; --mc-radius-pill: 999px;
  --mc-page: min(72rem, calc(100vw - 40px));
  --mc-font: Pretendard, system-ui, -apple-system, BlinkMacSystemFont, "Apple SD Gothic Neo", "Noto Sans KR", sans-serif;
}
@media (prefers-color-scheme: dark) {
  :root {
    --mc-bg: #14171D; --mc-surface: #20252F; --mc-label: #F3F5F9; --mc-secondary: #A6B0C0; --mc-separator: #343C49;
    --mc-primary: #9BB8FF; --mc-on-primary: #14254A; --mc-primary-container: #25334F; --mc-on-primary-container: #D9F2FC;
    --mc-success: #75D6A2; --mc-success-container: #163A29; --mc-on-success-container: #D8F8E5;
    --mc-error: #FFB4A1; --mc-error-container: #512015; --mc-on-error-container: #FFE2DA;
    --mc-accent-container: #45371B; --mc-on-accent-container: #F8E9CC;
    --mc-sky-1: #1D3A63; --mc-sky-2: #1A2A45; --mc-sky-3: #182131; --mc-sky-ink: #F3F5F9; --mc-sky-muted: #C4D0E0;
    --mc-bronze: #D08A4E; --mc-bronze-edge: #D08A4E; --mc-bronze-container: #3A2716; --mc-on-bronze-container: #F2C8A0;
    --mc-silver: #B7C2CF; --mc-silver-edge: #B7C2CF; --mc-silver-container: #2A313C; --mc-on-silver-container: #D6DEE8;
    --mc-gold: #E6B93A; --mc-gold-edge: #E6B93A; --mc-gold-container: #3A3012; --mc-on-gold-container: #F7D774;
    --mc-locked-edge: #7E8A9A; --mc-locked-fill: #262C37; --mc-stamp-ink: #FFB09A;
  }
}
```

기존 변수(`--ink`, `--stream` 등)는 이 토큰을 가리키는 별칭으로 바꾸거나 제거한다. `tests/site/verify_design_tokens_test.mjs`가 `palette.ts`·`medal-colors.ts`의 값과 각 웹 CSS의 `--mc-*` 라이트·다크 값을 대조한다.

## 2. 글자

- 글꼴: `var(--mc-font)`만. Georgia·serif 로고 글자는 쓰지 않는다.
- h1 `clamp(1.9rem, 4.2vw, 3.2rem)` / 줄 1.2 / 굵기 800 / 자간 -0.02em, h2 `clamp(1.35rem, 2.6vw, 2rem)`, h3 1.15rem, 본문 1rem / 1.65, 보조 0.9rem `--mc-secondary`. `word-break: keep-all`.
- 앱 기준(대표 제목 24~26dp)보다 웹은 조금 크게 허용하지만 첫 화면에 본문이 보여야 한다.

## 3. 구성 요소

- **머리글**: 마스코트 스탬프(`mascot-stamp.png`, 원형 36px) + "월계 마스코트". 점주·관리자 화면은 이름 옆에 `점주`·`관리자` 칩. 머리글 배경 `--mc-bg`, 아래 1px `--mc-separator`.
- **여권 히어로**: 앱 탐험 여권처럼 `linear-gradient(180deg, var(--mc-sky-1), var(--mc-sky-2) 55%, var(--mc-sky-3))`, 반경 `--mc-radius-card`, 글자 `--mc-sky-ink`/`--mc-sky-muted`, 마스코트 원형 이미지. 포털·시연 웹·운영 웹 도감 첫 구획에 쓴다.
- **카드**: `--mc-surface`, 반경 20px, 테두리 없음(필요하면 1px `--mc-separator`), 그림자 없음 또는 아주 약하게.
- **버튼**: 주 버튼 `--mc-primary`/`--mc-on-primary`, 보조 `--mc-primary-container`/`--mc-on-primary-container`, 반경 14px, 최소 높이 48px, 굵기 800. 글자 링크는 `--mc-primary` 밑줄.
- **칩**: 반경 pill, 작은 굵은 글자. 성공 `--mc-success-container`, 경고/시연 `--mc-accent-container`, 오류 `--mc-error-container`.
- **메달(웹)**: 원형 88px, 링 6px(`--mc-bronze|silver|gold-edge`, 미획득은 `--mc-locked-edge` 점선), 안쪽 마스코트(미획득은 `filter: grayscale(1); opacity: .45`), 아래 등급 칩(`--mc-*-container`/`--mc-on-*-container`)과 "브론즈까지 1곳 더" 같은 글자. 색만으로 뜻을 전하지 않는다.
- **보상 상자**: 세로 행 카드(앱과 같음) — 상자 아이콘(순수 CSS/인라인 SVG), 이름, 상태 칩(잠김·열 수 있어요(앱에서)·혜택 준비 중·받음), 혜택 한 줄.
- **쿠폰 티켓**: `--mc-accent-container` 바탕, 양옆 반원 홈(`radial-gradient` 마스크), 점선 구분, 상태 칩, 사용 완료는 `--mc-stamp-ink` 도장 글자.
- **정직성 안내**: 시연/가상/예시 안내는 구획당 한 번, `--mc-accent-container` 띠로.

## 4. 배치·접근성

- 페이지 폭 `var(--mc-page)`, 모바일 좌우 20px, 구획 간격 48~64px(데스크톱)/32px(모바일).
- 360·390·768·1280·1440px에서 가로 넘침 없음, 200% 확대에서 잘림 없음.
- 대비 AA, 포커스 링 `2px solid var(--mc-primary)` + offset, `prefers-reduced-motion`이면 전환 효과 없음.
- 모든 이미지 `alt`(장식은 `alt=""`), 상태는 글자로.
