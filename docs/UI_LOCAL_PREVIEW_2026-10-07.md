# 최종 UI 로컬 테스트 앱

## 사용자 범위

2026-10-07 사용자는 최종 67개 화면 시안의 구현과 앱 실행을 요청하고, 추가 질문에서 **로컬 테스트 앱부터**를 선택했다. 후속 요청은 **PR만 생성하고 머지하지 않기**다. 실제 서버 저장 기능과 공개 배포는 이번 범위가 아니다. 시안의 숫자·보상은 예시이며 운영 보상 규칙으로 바꾸지 않는다.

## 수용 조건

- 기존 Expo/React Native 앱 안에서 동작하는 별도 개발용 진입점을 제공한다.
- 확정 홈, 친구, 꾸미기, 가게 이웃, 탐색, 방문, 도감, 리롤, NFT, 상점, 네 가지 놀이, 우편, 프로필, 설정과 계정 안내 67개 화면을 실제 버튼·입력·스크롤로 구성한다.
- 상단 프로필/한 줄 소개/마일리지/우편/설정과 하단 탐색·도감·홈·놀이·상점을 유지한다.
- 로컬 상태 저장과 초기화를 제공한다. 실제 API, Google 로그인, 지갑, 위치, 카메라, 친구 메시지, NFT 발행을 실행하지 않는다.
- 뽑기는 기존 코인을 보존한다. 리롤은 일반·브론즈·실버권 중 하나와 기존 코인을 소모하고 새 코인을 가게 풀에서 지급한다. NFT 처리 중/완료 코인은 리롤을 막는다.
- 마이룸 배치·공개 설정·바 테마·한 줄 소개가 재시작 후에도 유지된다. 이웃 방문은 공통 방문 가게와 공개 범위를 확인한다.
- 개발 플래그가 없는 일반 앱과 운영/시연 빌드에는 미리보기와 합성 자산이 포함되지 않도록 번들을 분리한다.

기준: 로컬 `C:/Hack/ui-concepts-2026-10-07/final-all-pages`의 23장. 원본 PNG는 그림 영역에만 쓰며 버튼과 글자는 앱 컴포넌트로 구현한다.

추가 참고: 사용자가 전달한 [독립 HTML/CSS/JS 모바일 시제품](UI_SANDBOX_REFERENCE_2026-10-07.md)은 원본 비교·모바일 배치·조작 사례로 사용한다. 그 시제품의 브라우저 통과 결과를 이 Expo 앱의 검증 결과로 합치지 않는다.

## 작업 분리

기준 커밋 `c0691e8f`, 작업 브랜치 `feat/mint-ui-local-preview`. 시작할 때 존재하던 README/app.config.ts/build-environment.test.ts/AI_USAGE/HANDOFF 수정은 보존한다. 사용자 후속 요청에 따라 시각 검증 미완료를 명시한 Draft PR을 생성하되 머지·자동 머지는 하지 않는다. PR 준비 시 fetch한 `origin/main`은 `51e2df21`로 기준보다 2커밋 앞서 있다. 최신 main의 별도 UI/코인·방 기능을 이 미리보기의 결과로 주장하지 않으며 통합 후 재검증은 별도 미완료 항목이다.

## 검증

2026-10-07 재개 작업은 [Issue #394](https://github.com/2026-KW-HACKATHON/27_MassCOM/issues/394)에 기록했다. 기존 #388은 GitHub 커넥터에서 종료 상태를 확인했고 새 작업의 완료로 재사용하지 않는다. 아래 검증은 커밋 전 수행했으며 최종 PR/커밋 상태는 [HANDOFF](HANDOFF.md)의 최신 항목을 따른다. 공개 서버·APK·Play는 변경하지 않는다.

Windows·PowerShell·Node 24.16.0, HEAD `c0691e8f3bae79029ffa7c036bf2eee20454d400`의 **미커밋 작업트리** 기준이다.

| 결과 | 명령·확인 | 근거와 한계 |
| --- | --- | --- |
| PASS | `npm.cmd test --prefix apps/mobile` | 최종 1,804/1,804, 0 FAIL·0 SKIP, 46.4초. 미리보기 집중 27개 포함 |
| PASS | `npm.cmd run typecheck --prefix apps/mobile`, `npm.cmd run lint --prefix apps/mobile` | 타입/lint 오류 없음 |
| PASS | `npm.cmd run ui:test-render --prefix apps/mobile` | 67개 화면 + 빈 뽑기권/없는 코인/NFT 잠금. 실제 React Native Web JSX의 Node 렌더이며 console error 0. 이미지 로딩·픽셀·클릭 검사가 아님. shadow/pointerEvents 폐기 예정 경고는 남음 |
| PASS | `npm.cmd run ui:test-isolation --prefix apps/mobile` | 플래그를 일부러 1로 둔 production/showcase 각각 Android JS export, 파일 84/87개, 합성 코드 표식/시안 자산 SHA-256 일치 0. 설치·서명 빌드 아님. 시연 OAuth는 구문 시험용 무효 placeholder |
| PASS | `http://localhost:8091` HTML 및 참조 Metro 번들 요청 | 각각 HTTP 200, 미리보기 표식 있음. 화면 클릭·실행 성공의 대체 증거가 아님 |
| PASS | 독립 경계 검토 및 수정 재검토 | 카탈로그의 무확인 게임 기록 소실 P2 1건을 수정. 재검토 추가 확정 결함 0, 이탈 시험 3/3 PASS |
| BLOCKED | 브라우저 시각·상호작용 검증 | `Browser is not available: iab`, `cua.getState()` → `apps: [], browsers: []`. 클릭·새로고침 복원·320/390px·큰 글씨는 미검증 |
| NOT_RUN | 운영/시연 Android 설치본·TalkBack·센서/오디오·API/DB 종단·공개 배포·Play | 자동 시험·Node 렌더로 대체하지 않음 |

전체 모바일 시험의 최초 결과는 1,788 PASS / 7 FAIL이었다. 기존 6개 소스 검사 파일이 CRLF 줄바꿈을 LF 전용 문자열로 자르던 Windows 호환 결함이었다. **시험 입력만** CRLF→LF 정규화했으며 제품 인증/보상 코드나 assertion·skip은 바꾸지 않았다. Node 렌더에서 발견한 View 아래 잘못된 텍스트 노드도 수정했다. 타입/lint 명령 최초 1회는 작업 디렉터리와 prefix가 중복돼 ENOENT였으며 올바른 디렉터리에서 재실행했다.

로컬 원본 로그: `.tmp/ui-preview-qa/`의 `mobile-tests-final.log`, `typecheck.log`, `lint.log`, `render.log`, `http-smoke.json`, `isolation-1791354652818/summary.json` 및 variant별 로그. [보존 요약](evidence/ui-local-preview-2026-10-07/validation.json)을 따른다.

서버 최종 확인에서 이전 실행기의 `CI=1`이 Metro 파일 감시를 꺼 오래된 번들을 제공한 사실을 확인했다. 실행기에서 상속된 CI를 제거하고 `BROWSER=none`으로 자동 브라우저 실행만 막았다. 확인한8091 프로세스만 재시작했으며 최신 번들에서 `replacesGame`·`requestNavigation`·`ownedTickets`·`collectionProgress`를 직접 확인했다. HTTP200/기존 미리보기 표식만으로 최신 수정 반영을 판정하지 않는다.

## 구현과 의도적인 로컬 한계

- 보유량 0인 뽑기권 제외·빈 상태, 일반 뽑기 중복 요청 방지, 코인 종류별 4등급 집계, 소진 풀/권 및 NFT 잠금, 검색 조건 유지·관심 가게 로컬 저장을 보완했다.
- 방 미저장 변경은 저장/버리기/계속 편집을 고른다. 게임 중 탭 이탈과 카탈로그의 같은/다른 놀이 교체도 기록을 지우기 전에 확인한다. 카탈로그가 열린 동안 놀이는 일시정지한다.
- 로컬 저장은 직렬화하고 저장 중/완료/실패를 구분한다. 쓰기 실패는 명시적으로 재시도하며 최초 읽기 실패에서는 기존 기록을 자동 덮어쓰지 않는다.
- **로컬 시뮬레이션만** 남은 허용 등급 중 균등 선택·동일 가게 풀·회수 코인 재입고 없음·중복 보유 가능을 사용한다. 운영 확률/풀/중복 정책 승인이 아니다. 방문 샘플 코드 `MOON-2026`, 놀이 30P와 가격도 실제 지급 권리가 아니다.
- 사진/공유, 실제 지도·권한·음악·알림·지갑은 안내 또는 로컬 선택 상태만 제공한다. 방은 시안 그림 위에 선택 가구/전시를 올리는 미리보기이지 실제 3D 편집기가 아니다. 완전한 실제 서비스 구현으로 주장하지 않는다.

## 사용자가 바로 확인할 순서

1. `npm.cmd run ui:preview --prefix apps/mobile` → `http://localhost:8091`(이미 실행 중이면 링크만 열기).
2. 홈 권 → 사용 확인 → 결과 → 도감에서 기존 코인 보존 확인.
3. 코인 → 리롤의 회수/권 소모 확인. NFT 받기 → 테스트 지갑 → 확인 → 발급 중/완료의 리롤 잠금 확인.
4. 방 편집 → 다른 탭에서 계속/버리기/저장 비교. 한 줄 소개·공개 범위·바 테마 저장 뒤 새로고침.
5. 놀이 → 시작 → 다른 탭 또는 상단 목록 → 이탈 확인창에서 계속/나가기 비교.
6. 설정의 테스트 초기화는 로컬 합성 기록만 되돌린다. 시각·상호작용 검증 결과는 Draft PR에 추가하되, 사용자의 별도 지시 없이 머지하지 않는다.
