# HANDOFF

마지막 갱신 시각: 2026-09-30 KST

## 2026-09-30 사장님 AI 가게 그림(Issue #236)

- 기준 커밋: main `29f2574`(PR #238) 위의 브랜치 `feat/236-ai-store-art`(로컬 worktree `.worktrees/236-ai-store-art`). 서버·앱 구현과 독립 리뷰 반영이 끝났고 코드는 `e9344ba`까지이며 그 위에 문서 커밋이 있다. **아직 원격에 push하지 않았고 PR도 없다.** PR 전에 `git fetch origin`으로 main이 앞서 있는지 확인하고, 문서 충돌이 나면 두 쪽 문단을 모두 남겨라. 제목·본문은 `bash scripts/check-pr-korean.sh "$PR_TITLE" "$PR_BODY"`로 검사한다.
- 내용: D-048을 구현했다. 서버: migration 0029(라운드·이미지·가게 그림·호출별 비용), 점주용 그림 API 6개, 공개 `/merchant-art/<sha256>.webp`, OpenAI 이미지 클라이언트, 하루 한도·월 예산, 계정 삭제 시 요청자 식별자 비우기. 앱: 시연 점주 화면의 "가게 그림 만들기"와 고객 화면 그림 표시. 리뷰 반영([설계 §11](superpowers/specs/2026-09-29-ai-store-art-design.md), [D-050](DECISIONS.md) `PROPOSED`): `docs/privacy.html`에 OpenAI(미국)·국외 이전, `MANAGE_ART`는 활성 OWNER만(STAFF는 `AI_ART_STAFF_MAY_MANAGE=true`인 시연 compose에서만), 네트워크 오류 무재시도·본문 바이트 상한, 잘못된 설정에도 API 기동, 기본 주소 고정(`https://api.openai.com`과 loopback http), 프롬프트 강화, 최종 예상 비용 $0.18, 적용 뒤 시안 삭제와 30일 지난 적용 라운드의 이미지 정리, `merchant_art.sha256` 비유일 색인(migration 0029를 그 자리에서 고침), `FINALIZING` 조회에서 시안 제외, 커밋 뒤 조회 실패에도 생성 시작, 최종 실패 뒤 같은 라운드에서 다시 고르기(다시 고른 뒤 옛 시도의 늦은 덮어쓰기는 시도 표지 `final_spend_id`로 막음), 502·504 무재시도, 처리방침의 국외 이전 고지 항목·보관 기간, 운영 compose의 STAFF 키 금지 시험, 서버 그림 불러오기 실패 시 글자로 복귀, 확인 창 하나만 열림, 단계 관리 순수 도우미와 행동 시험, 그림 내리기 관리자 SQL([API README](../apps/api/README.md), 그림 한 장은 `sha256`으로). **이미 migration 0029를 적용한 로컬 DB는** `ALTER TABLE merchant_art DROP CONSTRAINT merchant_art_sha256_key; CREATE INDEX merchant_art_sha256_idx ON merchant_art (sha256); ALTER TABLE merchant_art_rounds ADD COLUMN IF NOT EXISTS final_spend_id bigint;`로 맞춘다(운영·시연에는 아직 0029가 없다).
- 검증: API 단위 196/196, PostgreSQL 통합 159건 중 157 PASS·0 FAIL·2 SKIP(일회용 `_test` DB), 모바일 725/725·typecheck·lint, 운영/시연 두 `export:android`와 `verify-mobile-variant-assets`, 개인정보·비밀·접근성 semantics·지갑 표면·사이트 검사 PASS. 오케스트레이터가 실제 휴대전화(SM-S928N) 개발 빌드 + 로컬 API + 가짜 이미지 서버로 시안→선택→최종→적용→고객 화면 표시를 확인했고(`9932e4d`), 리뷰 반영 뒤(`82c1d54`) 고급 그림 실패 뒤 다시 고르기까지 다시 확인해 [캡처 9장](evidence/ai-store-art-2026-09-30/README.md)을 남겼다([시험 상태](TEST_STATUS.md)). 독립 리뷰: sonnet 코드 APPROVE, opus 보안·비용·개인정보 REQUEST_CHANGES(반영 완료), opus 재리뷰(`9932e4d..82c1d54`) APPROVE(🔴 0, 🟡·🔵는 반영 완료). `NOT_RUN`: 실제 OpenAI 호출·비용·지연 측정, 실제 1024² 이미지의 기기 표시, 정책 차단·준비 중·하루 한도 화면의 기기 확인, TalkBack, 시연 APK, 배포.
- 다음 작업: ⓪ 병합 뒤 운영·시연 서버에 migration 0029를 배포하고(키가 비어 있어 기능은 꺼진 채) **새 `docs/privacy.html`을 웹에 먼저 반영**한다. 개인정보 안내의 OpenAI 문의 주소는 공식 페이지를 확인하지 못해 처리방침 링크만 두었으니 소유자가 확인해 채운다. ① 소유자가 시연 서버 `/opt/masscom-showcase/runtime.env`에 **`SHOWCASE_OPENAI_API_KEY`를 직접 넣고 월 예산(기본 USD 5)을 확인**한다(에이전트는 키를 만들거나 저장소·대화에 두지 않는다. 절차는 [`infra/showcase-host/README.md`](../infra/showcase-host/README.md)). ② 그 뒤 시연 API를 배포한다(migration 0029 적용, `showcase-api` 컨테이너를 다시 만들어 기동 로그 `AI store art: enabled` 확인, 시연 compose가 `AI_ART_STAFF_MAY_MANAGE=true`를 켠다). ③ 시연 Preview 10 APK를 빌드·공개하고 실제 호출로 비용(`ai_art_spend`)·지연·정책 차단을 실측해 최종 예상 비용 $0.18을 다시 정한다. ④ **운영 서버의 `OPENAI_API_KEY`는 비워 둔다**: 운영에는 OWNER를 부여하는 경로가 없어 STAFF를 열지 않는 한 아무도 이 API를 쓸 수 없고, STAFF를 열면 활성 STAFF 누구나 비용을 쓸 수 있으므로 소유자 채널을 설계·승인한 뒤에 넣는다. ⑤ PR·CI·병합.

## 2026-09-29 친구 운영·시연 배포와 시연 Preview 9 공개(Issue #234)

- 기준 커밋: main `87e98f4`(PR #233 친구 병합, main CI 36577029769 PASS). 브랜치 `docs/234-preview9`(로컬 worktree `.worktrees/234-preview9`, main `87e98f4` 기준)는 **아직 원격에 push하지 않았고 PR도 없다.** 앱·API 코드 변경 없이 배포·릴리스 증거 JSON 두 개와 설치 링크(README·`docs/open.html`·`ANDROID_DOWNLOADS.md`·B-018 포인터)를 Preview 8에서 9로 바꾸고 포털 검사 기대값만 Preview 9로 옮긴다. PR 전에 `git fetch origin`으로 main이 앞서 있는지 확인하고, 문서 충돌이 나면 두 쪽 문단을 모두 남겨라.
- [친구 배포 증거](evidence/friends-deployment-2026-09-29.json): 운영 API·웹은 `scripts/deploy-lightsail.sh --deploy`로 API `758f214`·웹 `cd527dd`에서 `87e98f4`로 바뀌었고(약 13:40Z, api·production-web·caddy 컨테이너 재생성·healthy, `/opt/masscom/DEPLOYED_COMMIT` `87e98f4`), migration 0028은 추가만 하는 변경이라 `backward_compatible=yes`다. **운영 배포는 migration 전에 별도 pg_dump 백업을 만들지 않았다**(추가만 하는 변경). 시연 API는 `/opt/masscom-showcase`의 수동 compose 절차(릴리스 디렉터리 `/opt/masscom-showcase/releases/87e98f4…`)로 배포 전 백업 `/opt/masscom-showcase/backups/pre-87e98f4-20260929.dump`(196항목·97297바이트·mode 600)를 만든 뒤 이미지 `87e98f4`·migrate·container 교체·host seed(`SHOWCASE_HOST_SEEDED`)를 했고, 두 서버 모두 친구 테이블 5개가 있다. 운영·시연 API health 200·로그인 없는 `/me/friends` 401, `masscom.kr`·`www`의 `/privacy` 본문 해시 앞 16자 `961c0f06270b8d8c`가 저장소 `docs/privacy.html`과 같고 `/account-deletion`에 친구 문구가 있다.
- [Preview 9 공개 사전 릴리스](evidence/showcase-preview9-release-2026-09-29.json): `MassCOM-showcase-android-87e98f4.apk` 156537981바이트, SHA-256 `efebe0fff8aa9cf5ca896e550caed8a15b05763b19df3e1123fc9749708878f5`, provenance(632바이트, SHA-256 `0801447ee5c358ecd919e87fd37ba36271cf40042ebe0ae107e30a7a89d780ea`)·SHA256SUMS.txt(218바이트) 포함, GitHub digest 일치, 익명 다운로드 HTTPS 200, package `kr.masscom.wolgye.demo`·versionName/code `0.1.0-test.2`/`2`·시연 API 출처·서명 인증서 SHA-256 `cdb0dc37750c907eaa2f1b9eb172b0911f14b9c9f2dab78b481f1751d8ebf28a`, 빌드 스크립트 사전 검사와 지갑 요청 표면 검사(AAB 기준) PASS. Samsung SM-S928N에서 기존 시연 앱 위 `adb install -r` Success, 첫 실행은 역할 선택 화면, 사용자 역할로 들어가 다섯 칸 탭 바(탐색·지도·방문 인증·도감·친구)의 탐색 화면과 이미 로그인된 소유자 시연 계정의 배지 1/9, 친구 탭이 시연 API에서 불러와져 기본 별명·친구 코드·QR이 보였다(소유자 본인의 친구 코드라 캡처는 저장하지 않음). 이 릴리스의 새 기능은 친구 탭·코드/QR 추가·친구 순위와 여권(메달 등급·배지 수·가본 가게 이름만, 다음 0시 KST부터 보임)·끊기와 재추가 차단·코드 바꾸기 권유·시스템 공유창의 `친구에게 추천`이며 시연 앱은 코드 문구와 `https://masscom.kr/open` 안내를 공유하고 QR은 `masscom-demo://open#friend=`다.
- `NOT_RUN`: 두 시연 계정의 친구 추가·순위·여권·끊기, 시연 앱 링크 열기(`demo.masscom.kr`에 DNS·Caddy·assetlinks가 없음, [B-024](BLOCKERS.md)), 시스템 공유창, 지도 화면·TalkBack·다크·글자 200%, 로그인 뒤 메달→상자→쿠폰→점원 사용 처리, 새 2분 고객 QR의 두 기기 수령, 시연 DB 백업의 실제 복원. 운영 test.3 앱에는 친구 탭이 없어 운영 서버의 친구 기능을 쓰는 설치본은 아직 없다. 소유자의 친구 화면 판정은 사용자 판정 필요다.
- 다음 작업: ① 이 문서 PR 병합 뒤 `scripts/deploy-lightsail-web.sh`로 웹만 재배포해 공개 `/open`이 Preview 9 링크를 안내하게 한다(재배포 전까지 Preview 8 링크이며 API·DB 컨테이너는 바꾸지 않는다). ② 휴대전화 두 대(또는 두 시연 계정)로 코드·QR 친구 추가·순위·여권·끊기와 시스템 공유창을 확인한다. ③ 시연 앱의 https 친구 링크를 쓰려면 `demo.masscom.kr` 인프라(DNS, Caddy, 시연 서명 인증서용 assetlinks)를 먼저 만든다. ④ 그다음 D-048(사장님 AI 스탬프·수집품 시안, OpenAI 이미지 API)이며 **소유자가 서버 비밀 파일에 API 키를 직접 넣어야** 착수할 수 있다.

## 2026-09-29 친구(Issue #230)

- 기준 커밋: main `cd527dd`(PR #232 Preview 8 문서 병합)를 브랜치에 병합했다(`da55f40`). 브랜치 `feat/230-friends`(로컬 worktree `.worktrees/230-friends`)는 [PR #233](https://github.com/2026-KW-HACKATHON/27_MassCOM/pull/233)으로 main `87e98f4`에 병합됐다(main CI 36577029769 PASS). 서버 커밋(`a9dc871`~`cfa1ad4`)과 앱 커밋(`e85f464`~`bc830c0`) 위에 리뷰 반영 커밋들과 문서 커밋이 있다.
- 내용: 소유자가 고른 친구 코드·QR과 공개 범위(D-047)를 구현했다. 서버: migration 0028(별명·친구 코드·친구 관계·끊은 기록 `friend_blocks`·코드 입력 실패 기록), 친구 API 5개, 친구에게 보이는 값은 허용 필드만·하루 늦게(KST 어제까지), 코드 입력은 계정당 10분에 10회 실패까지, 끊으면 그 계정으로는 재추가 불가(계정 기준 차단, 코드를 바꿔도 유지), 계정 삭제가 양쪽 칸까지 정리. 앱: 다섯 칸 탭 바, 친구 탭(내 카드·코드 입력/QR 촬영 추가·순위), 친구 여권(읽기 전용, 끊기 확인 뒤 내 코드 바꾸기 권유), 가게 추천, `https://masscom.kr/open#friend=CODE`·`#merchant=ID` 링크 열기. 리뷰 반영 결정([설계 §8 C~G](superpowers/specs/2026-09-29-friends-design.md), 소유자가 확인하지 않은 엔지니어링 결정이라 [D-049](DECISIONS.md) `PROPOSED`): 차단은 다른 계정으로 우회되므로 앱이 안내, **시연 앱은 https 링크를 만들지 않고**(`demo.masscom.kr`에 DNS·Caddy·assetlinks가 없음) `masscom-demo://` QR과 앱 받기 안내만 쓴다, 각 빌드는 자기 링크만 받는다(운영·개발은 같은 https 링크를 써서 서로 격리되지 않고 시연 앱만 격리된다), 가게 id는 경로로 풀리는 값을 거절, 쓸 수 없는 친구 링크와 내 코드는 알림.
- 검증: 모바일 598/598·typecheck·lint(`dc82677`)·API 단위 149/149 PASS, 운영/시연 두 export·`verify-mobile-variant-assets`는 `c597017`에서 PASS(이후 배치 뒤 재실행 안 함), PostgreSQL 통합은 일회용 로컬 DB에서 117 PASS·0 FAIL·2 SKIPPED(주 스레드 보고), [시험 상태](TEST_STATUS.md)에 실제 휴대전화(SM-S928N) 로컬 확인 결과가 있다. 독립 리뷰: sonnet 코드·opus 보안 모두 APPROVE(🔴 0)이고 지적 16건을 반영했다. 필수 36개 상태는 31 PASS / 2 BLOCKED / 3 NOT_RUN 그대로다. `NOT_RUN`: PostgreSQL 통합의 호스팅 시드 시험 2개(전용 55435 컨테이너 필요), 시스템 공유창, 실제 App Link, 시연 링크 열기, 이 배치의 재리뷰, 내 코드 링크 수정의 폰 재확인.
- 다음 작업(병합 당시 계획): ①~③ PR·CI·병합, 운영·시연 서버 migration 0028 적용, 웹의 개인정보·계정 삭제 안내 공개와 ④ Preview 9 APK 공개는 아래 Issue #234 항목처럼 끝났다. 아직 남은 것: ⑤ 시연 앱이 https 링크를 쓰려면 **`demo.masscom.kr` 인프라**(DNS, Caddy, 시연 서명 인증서용 assetlinks)가 먼저 있어야 한다. ⑥ 그다음 D-048(사장님 AI 스탬프·수집품 시안, OpenAI 이미지 API)이며 **소유자가 서버 비밀 파일에 API 키를 직접 넣어야** 착수할 수 있다.

## 2026-09-29 시연 Preview 8 공개 릴리스와 설치 링크(Issue #231)

- 기준 커밋: main `fea9f29`(PR #229 동네 지도 병합, PR #227 하늘 동네 개편 포함, main CI 36562952858 PASS). 브랜치 `docs/231-preview8`(로컬 worktree `.worktrees/231-preview8`)은 **원격에 push했고 [PR #232](https://github.com/2026-KW-HACKATHON/27_MassCOM/pull/232)로 올렸다.** 앱·API 코드 변경 없이 Preview 8 릴리스 증거와 설치 링크(README·`docs/open.html`·`ANDROID_DOWNLOADS.md`·B-018 포인터)를 Preview 7에서 8로 바꾸고 포털 검사 기대값만 Preview 8로 옮긴다. PR 전에 `git fetch origin`으로 main이 앞서 있는지 확인하고, 문서 충돌이 나면 두 쪽 문단을 모두 남겨라.
- [Preview 8 공개 사전 릴리스](evidence/showcase-preview8-release-2026-09-29.json): `MassCOM-showcase-android-fea9f29.apk` 156468121바이트, SHA-256 `59a92388971a641ad3872db62e615fb5311e97fa9babc57d2d9909a03f5d4242`, provenance(632바이트)·SHA256SUMS.txt(218바이트) 포함, GitHub digest·체크섬 일치, 익명 다운로드 HTTPS 200, package `kr.masscom.wolgye.demo`·versionName/code `0.1.0-test.2`/`2`·시연 API 출처·서명·지갑 요청 표면 검사 PASS. **휴대전화가 연결돼 있지 않아 이 APK의 설치는 `NOT_RUN`**이다. 같은 디자인의 이전 빌드 `c75143a`는 Samsung SM-S928N에서 새 역할 선택 화면과 점포 그림이 있는 탐색 화면을 보였고(작업 보고, 캡처는 이 저장소에 없음) 지도는 개발 앱으로만 실폰 확인했다([증거](evidence/town-map-2026-09-29/README.md)).
- 다음 작업: ① 이 문서 PR 병합 뒤 `scripts/deploy-lightsail-web.sh`로 웹만 재배포해 공개 `/open`이 Preview 8 링크를 안내하게 한다(재배포 전까지 Preview 7 링크이며 API·DB 컨테이너는 바꾸지 않는다). ② 휴대전화를 연결해 Preview 8을 기존 시연 앱 위에 설치하고 역할 선택·탐색의 점포 그림·지도 핀·길찾기 선택·TalkBack·다크·글자 200%·로그인 뒤 메달→상자→쿠폰→점원 사용 처리를 확인한다(전부 `NOT_RUN`). ③ 하늘 동네와 지도에 대한 소유자의 판정은 사용자 판정 필요다. ④ 시연 서버 `runtime.env`의 `MASSCOM_SHOWCASE_IMAGE_TAG`는 `7dba450`으로 남아 있으므로 다음 시연 API 배포는 실제 태그를 명령 환경 변수로 지정한다.

## 2026-09-29 동네 지도·길찾기(Issue #228)

- 기준 커밋: main `c75143a`(PR #227 하늘 동네 개편 병합). 브랜치 `feat/228-town-map`(로컬 worktree `.worktrees/228-town-map`)은 그 위에서 갈라졌고 **아직 원격에 push하지 않았다.** 코드 커밋은 `1945c1a`까지이고(`e151a34` 설계 · `3a63c76` 자리 배정·길찾기 순수 함수 · `5be58ee` 지도 화면·탭 · `d880692` 탐색 칩·도장판 이름 · `f4e32bf` DESIGN.md · `1945c1a` 보상 상자 이름) 그 위에 문서 커밋이 하나 있다. PR 전에 `git fetch origin`으로 main이 앞서 있는지 확인하고, 앞서 있으면 병합한다. `README.md`·`TEST_STATUS.md`·`PROJECT_STATE.md`·`HANDOFF.md`·`AI_USAGE.md`에서 문서 충돌이 나면 두 쪽 문단을 모두 남겨라.
- 내용: 소유자가 고른 앱 안 일러스트 동네 지도 + 네이버·카카오맵 길찾기(D-046)를 구현했다. 탭 바는 `탐색 · 지도 · 방문 인증(가운데 도장) · 도감` 네 칸(내 정보는 머리글 아바타 그대로)이다. 지도 탭은 동네 그림 위에 가게 핀을 올린다: 도장 받은 곳은 이중 테두리와 체크, 아직 없는 곳은 점선이라 색만으로 구분하지 않는다. 핀을 누르면 이름·도로명 주소·도장 상태·다음 목표와 `자세히 보기`·`길찾기` 카드가 올라오고, 가상 점포는 실제 주소가 없어 `길찾기` 대신 "가상 위치라 길찾기를 할 수 없어요"를 보인다. `길찾기`는 네이버 지도·카카오맵 앱(거절되면 웹)을 **도로명 주소 검색**으로 열며 앱은 위치를 쓰지 않는다. 핀 자리는 그림 속 건물 8곳에 가게 ID 해시로 배정하고 9번째부터는 지도 아래 목록으로 보인다. 값·구조의 정본은 `apps/mobile/src/screens/town-map/`이고 [설계](superpowers/specs/2026-09-29-town-map-design.md)와 [`DESIGN.md`](../DESIGN.md)가 정리한다. 지도 API 키·과금 자원·새 의존성·API/DB 변경은 없다. 검수 중 찾은 도감 공통 결함 둘(도장판 이름 둘째 줄 잘림 `d880692`, 보상 상자 이름 잘림 `1945c1a`)도 같은 브랜치에서 고쳤다.
- 검증: 모바일 477/477 PASS(문서 작성 중 재실행), 타입·린트·운영/시연 두 export·variant 자산 검사·접근성 semantics 검사 PASS(작업 보고), [실제 휴대전화(SM-S928N) 로컬 확인](evidence/town-map-2026-09-29/README.md)에서 지도·핀 구분·핀 카드·길찾기 선택 창·네이버 지도와 카카오맵 앱 열림·가상 점포 길찾기 차단과 두 결함 수정이 PASS. 길찾기 검수에는 **로컬 QA DB에만 넣은** 검수용 가게 `qa-local-real-shop`(공개 주소 서울특별시 중구 세종대로 110)을 썼고 시연·운영 DB에는 넣지 않았다. 외부 지도 앱 화면은 네이버 지도가 휴대전화 위치로부터의 거리를 보여 저장하지 않았다. `NOT_RUN`: 지도의 다크·글자 200%, TalkBack, 앱이 없는 기기의 웹 대체 경로(단위 시험만), 시연 빌드(Preview 8)의 지도, 가게 8곳 초과 넘침 목록의 화면, 소유자의 지도 판정. 필수 36개 상태는 31 PASS / 2 BLOCKED / 3 NOT_RUN 그대로다. 독립 리뷰는 아직 하지 않았다.
- 다음 작업: ① PR·CI·병합. 제목·본문은 `bash scripts/check-pr-korean.sh "$PR_TITLE" "$PR_BODY"`로 검사하고, `gh pr list`·`gh run list`로 CI를 확인하며, 병합 전에 독립 리뷰(코드·디자인·접근성)를 받는다. 시연·운영 두 variant 영향은 두 export와 variant 자산 검사로 PR에 적는다. ② 병합 뒤 지도가 들어간 시연 Preview 8 APK를 빌드·공개 사전 릴리스하고 실제 휴대전화에서 시연 점포 그림 핀·TalkBack·다크·글자 200%·앱이 없는 기기의 웹 대체 경로를 확인한다(소유자의 지도 판정 요청). ③ 공개 `/open` 설치 안내를 Preview 8로 갱신하고 `scripts/deploy-lightsail-web.sh`로 웹만 재배포한다(API·DB 컨테이너는 바꾸지 않는다). ④ 하위 프로젝트 3 친구(D-047)는 별도 Issue·설계 뒤에 진행한다. 친구 코드·QR과 공개 범위(메달 등급·배지 수·스탬프판만, 방문 날짜·시간은 비공개)가 개인정보 노출 범위의 결정이므로 개인정보 안내·계정 삭제와의 관계를 먼저 확인하고, 탭 바가 `탐색 · 지도 · (방문 인증) · 도감 · 친구` 다섯 칸으로 바뀐다. 사장님 AI 시안(D-048)은 그 뒤이며 OpenAI 키는 소유자가 서버 비밀 파일에 넣는다.

## 2026-09-29 하늘 동네·여권 도장 개편(Issue #224)

- 병합: [PR #227](https://github.com/2026-KW-HACKATHON/27_MassCOM/pull/227)로 main `c75143a`에 병합됐고 PR CI PASS. 아래는 병합 전 기록이다.
- 기준 커밋: main `d03665e`(PR #226 병합; 웹 배포 확인 스크립트 수정). 브랜치 `feat/224-sky-town-redesign`(로컬 worktree `.worktrees/224-sky-town`)은 main `758f214`에서 갈라졌고 **아직 원격에 push하지 않았다.** 코드 커밋은 `a964766`까지이고 그 위에 문서 커밋이 하나 있다. main이 그 사이 `README.md`·`TEST_STATUS.md`·`PROJECT_STATE.md`·`HANDOFF.md`·`AI_USAGE.md`에 Preview 7 내용을 더해 같은 자리에서 문서 충돌이 날 수 있다. PR 전에 main을 병합하고 두 쪽 문단을 모두 남겨라.
- 내용: 앱 디자인을 하늘 동네 + 여권 도장으로 개편(D-045). 하늘 그림·구름이 머리글 안에서 내용과 함께 스크롤되고, 카드는 떠 있으며, 하단 탭은 `탐색 · 방문 인증(가운데 도장) · 도감` 세 칸(내 정보는 머리글 아바타), 도감은 도장이 찍히는 여권 페이지다. 마스코트 포즈 10종과 배경 2종은 Codex 내장 이미지 생성으로 만들어 `apps/mobile/assets/images/mascot/v2/`에 두었다(출처 `SOURCES.md`). 값·구조의 정본은 `theme/world.ts`·`src/ui/`·`src/motion/`이고 [`DESIGN.md`](../DESIGN.md)와 [스펙 10절](superpowers/specs/2026-09-29-sky-town-redesign-design.md)이 구현 중 바뀐 점을 정리한다. D-046 지도·D-047 친구·D-048 사장님 AI 시안은 [결정 기록](DECISIONS.md)에만 있고 코드는 없다.
- 검증: 모바일 388/388, 타입·린트·운영/시연 두 export PASS(작업 보고), [에뮬레이터 로컬 확인](evidence/sky-town-redesign-2026-09-29/README.md). 필수 36개 상태는 31 PASS / 2 BLOCKED / 3 NOT_RUN 그대로다. 독립 리뷰: sonnet 코드 APPROVE(🔴 0), opus 디자인·접근성 1차 REQUEST_CHANGES(🔴 3: 탭 선택 색만 구분·스크롤 시 상태 표시줄 겹침·증거) → 세 번째 수정·증거 재촬영 → 재리뷰 APPROVE(🔴 0).
- 증거 정리: 빈 화면이던 `02`와 `01`의 탐색 칸, 스크롤 수정 전이던 `03`을 스크롤 수정 뒤 캡처로 교체했고 `01`의 실기기 상태 표시줄은 잘라냈다. 다크 탐색 100%와 글자 200% 도감은 폴더 안 이미지가 없다.
- 다음 작업: ① PR·CI·병합(main `d03665e` 병합·충돌 해결 완료). ② 병합 뒤 시연 Preview 8 APK를 빌드하고 실제 휴대전화(SM-S928N)에서 전후 화면·TalkBack·동작 줄이기·점포 그림이 있는 점포 상세를 확인(소유자의 "꾸민 느낌" 판정 요청). ③ 하위 프로젝트 2 지도(D-046): `town-map` 일러스트 지도와 네이버·카카오맵 길찾기, 탭 바 `지도` 추가. 이후 친구(D-047)와 사장님 AI 시안(D-048)은 각각 별도 Issue·설계 뒤에 진행하며 D-048의 OpenAI 키는 소유자가 서버 비밀 파일에 넣는다.
- 웹 전용 재배포 기록(PR #226 이후): main `d03665e`로 웹만 다시 배포해 공개 `/open`이 Preview 7 설치 안내를 보이게 했고 apex와 `www` 모두 확인했다. API·DB 컨테이너는 바꾸지 않았다. 배포 담당 작업자의 보고를 옮긴 것이며 별도 증거 JSON은 이 브랜치에 없다.

## 2026-09-29 탐험 여권 운영·시연 배포와 Preview 7(Issue #222)

- 기준 커밋: main `758f214`(PR #221 발표 페이지 제거 병합, PR #217 탐험 여권·#219 웹 디자인 포함). 브랜치 `docs/222-deploy-preview7`은 앱·API 코드 변경 없이 배포·릴리스 증거와 Preview 7 설치 링크를 문서화하고 포털 검사 기대값만 Preview 7로 바꾼다. 운영 API·웹은 `scripts/deploy-lightsail.sh --deploy`로, 시연 API는 기존 `/opt/masscom-showcase` 수동 절차로 배포했고 migration 0027·시연 체험 혜택 3건·백업·외부 HTTPS 결과는 [배포 증거](evidence/explorer-passport-deployment-2026-09-29.json)에 있다. 운영 배지 혜택·쿠폰·점주·시연 점주는 0건이다.
- [Preview 7 공개 사전 릴리스](evidence/showcase-preview7-release-2026-09-29.json): `MassCOM-showcase-android-758f214.apk` 155101897바이트, SHA-256 `4a1d6b81ba535f5408b9e25ea5e2664f396d3e147b2969dc14cb2505a2584c9b`, GitHub digest·체크섬 일치. Samsung SM-S928N에서 기존 시연 앱 위 `adb install -r` Success·첫 실행 역할 선택 화면 PASS.
- 다음 작업: ① 이 문서 PR 병합 뒤 `scripts/deploy-lightsail-web.sh`로 웹만 재배포해 공개 `/open`이 Preview 7 링크를 안내하게 한다(재배포 전까지 Preview 6 링크). ② 실제 폰에서 로그인 뒤 메달→상자→쿠폰 발급→점원 사용 처리와 TalkBack은 `NOT_RUN`이다. ③ 운영 혜택 등록은 점주와 혜택·비용·기간·상한을 합의(D-043)한 뒤에만 수동으로 하며 그 전까지 0건을 유지한다. ④ 시연 서버 `runtime.env`의 `MASSCOM_SHOWCASE_IMAGE_TAG`는 `7dba450`으로 남아 있고 이번에도 수정하지 않았으므로, 다음 시연 배포도 실제 태그를 명령 환경 변수로 지정한다.

## 2026-09-29 발표 페이지 제거(Issue #220)

- 기준 커밋: main `63b1ab8`(PR #219 웹 디자인 체계 병합). 브랜치 `chore/220-remove-presentation`에서 소유자 결정에 따라 공개 발표 페이지(`docs/presentation.html`·`docs/assets/presentation.css`)와 발표 원고(`docs/PRESENTATION.md`), 발표 검사기(`scripts/verify-presentation.sh`·`tests/site/verify_presentation_test.sh`)를 제거했다. 발표 자료는 팀이 저장소 밖에서 준비한다. 포털 링크·공개 빌드 허용 목록·Lightsail 배포/스모크 경로·Caddy `/presentation` 재작성도 함께 뺐다. 발표와 무관한 검사(README·PROJECT_STATE·HANDOFF의 필수 시험 합계 문장, 제출 증거의 현장 성과 부풀림 금지)는 `scripts/verify-evidence-consistency.mjs`로 옮겨 변형 시험으로 실패를 확인했다. 과거 증거 파일과 날짜 기록은 그대로 둔다.
- 다음 작업: PR 병합 뒤 `scripts/deploy-lightsail-web.sh`로 웹을 배포해야 운영 Caddy에서 `/presentation`이 404가 된다(배포 전까지 기존 URL은 이전 페이지를 유지). 발표 리허설·최종 영상은 계속 `NOT_RUN`이다.

## 2026-09-29 웹 디자인 체계(Issue #218)

- 기준 커밋: main `bd8fc1a`(PR #217 탐험 여권 병합). 브랜치 `feat/218-web-design-system`(PR #219, main `63b1ab8`로 병합)에서 공개 포털·법률 안내·시연 웹·운영 웹을 [웹 디자인 체계](superpowers/specs/2026-09-29-web-design-system.md)로 통일했다. 디자인 토큰 5/5·운영 웹 74/74·시연 웹 30/30·시연 테마 1/1·웹 빌드/경로 4/4·세션 프록시 2/2 PASS([전후 화면](evidence/web-design-system-2026-09-29/README.md)).
- 다음 작업: PR 병합 뒤 `scripts/deploy-lightsail-web.sh`로 웹만 배포(마스코트 경로 3개 200 확인)하고, 시연 API migration 0027·체험 혜택 seed와 Preview 7 APK를 진행한다.

## 2026-09-29 탐험 여권(Issue #216)

- 브랜치 `feat/216-explorer-passport`: 서버 메달·보상 상자·쿠폰(`apps/api/src/badge-*`, `postgres/badge-rewards.ts`, migration 0027), 고객 앱 `apps/mobile/src/gamification/`·도감·방문 축하, 시연 점원 쿠폰 처리(`screens/merchant-claim/staff.tsx`), 운영 점주 웹 쿠폰 처리와 웹 도감 서버 배지(`apps/production-web`), Caddy `/api/web/badges`. 모바일 276/276·API 단위 133/133·PostgreSQL 89 PASS/2 SKIP·운영 웹 66/66 PASS, opus 보안·sonnet 코드 리뷰 🔴 0([설계](superpowers/specs/2026-09-29-explorer-passport-design.md), [규칙](NEIGHBORHOOD_BADGES.md), [실측](evidence/explorer-passport-emulator-2026-09-29/README.md)).
- 다음 작업: PR 병합 뒤 ① 시연 API 배포(migration 0027 + `npm run seed:showcase:host`로 체험 혜택 3건) ② 새 네이티브 모듈이 들어간 시연 Preview 7 APK 빌드·실기(공유창·햅틱·TalkBack) ③ 운영 API/웹 배포(혜택 0건 확인) ④ 점주와 혜택·비용·기간·상한 합의 후에만 운영 혜택 수동 등록([절차](NEIGHBORHOOD_BADGES.md)). 운영 등록 전 과제: 점원 본인 방문 제외 규칙은 실제 점포에 적용됨, 숨긴 점포의 기존 쿠폰은 유효.

## 2026-09-29 동네 탐험 배지와 웹 배포 상태

- [PR #214](https://github.com/2026-KW-HACKATHON/27_MassCOM/pull/214) merge 2dda864·PR/main CI PASS 뒤 기존 웹 전용 스크립트로 [apex/www /open Preview 6 링크](evidence/public-open-preview6-deployment-2026-09-29.json)를 반영했다. 두 URL HTTPS 200·docs/open.html SHA-256 일치, 웹 이미지 2dda864 healthy, 운영 API fd0a9b2·시연 API 6585614·PostgreSQL 불변. 이 웹 배포는 실제 Preview 6 Android 설치·쿠폰 사용 검증이 아니다.

- [Issue #212](https://github.com/2026-KW-HACKATHON/27_MassCOM/issues/212)의 [PR #213](https://github.com/2026-KW-HACKATHON/27_MassCOM/pull/213) merge 5caec3a·PR/main CI PASS로 인정된 서로 다른 점포 1·2·3곳 배지, 안전한 Android 공유, 시연 전용 사용 불가 쿠폰 예시와 운영 읽기 전용 웹 배지를 통합했다([규칙](NEIGHBORHOOD_BADGES.md)). 모바일 244/244·웹 48/48·타입·린트·Android 개발 export PASS. [운영 웹](evidence/neighborhood-badges-web-deployment-2026-09-29.json)은 실계정 빈 배지 3개와 익명 401/no-store를 확인했다. [시연 Preview 6 APK](evidence/showcase-preview6-release-2026-09-29.json)는 서명·원격 digest 확인 후 공개했으나 휴대전화 화면·공유창·TalkBack은 NOT_RUN. 실제 쿠폰 발급은 없다.
- 기존 조직 main 19c5ae4의 /open Preview 5 소스는 첫 두 SSH exit 255 때 이전 웹을 보존했고, 작은 tar→SSH·원격 사전검사·단독 빌드 PASS 뒤 이 Mac의 해당 호스트에만 keepalive를 설정해 [기존 웹 전용 스크립트로 배포](evidence/public-open-preview5-deployment-2026-09-29.json)했다. apex/www /open HTTPS 200·소스 SHA-256 일치, 운영/시연 API·DB 불변을 확인했다. 새 유료 자원은 만들지 않았다. 이 배포는 아직 PR 전인 신규 배지 웹 UI를 포함하지 않는다.

## 2026-09-29 조직 저장소 복귀

- 조직 저장소가 `PUBLIC`·활성으로 재개됐고 [PR #207~#210](PUBLIC_SYNC.md)의 PR/main CI 통과와 병합을 확인했다. 개인 PR의 원래 커밋·작성 이력을 유지한 채 기능 묶음으로 옮겼으며, [공개 시연 Preview 5](evidence/showcase-preview5-public-release-2026-09-29.json)는 개인 비공개 자산과 SHA-256이 같다. [PR #211](https://github.com/2026-KW-HACKATHON/27_MassCOM/pull/211)·main CI는 PASS, 공개 /open 배포는 [완료](evidence/public-open-preview5-deployment-2026-09-29.json), Preview 5 휴대전화 설치는 NOT_RUN이다.
- [원래 개인 PR과 조직 PR 대응](PUBLIC_SYNC.md), [Android 설치본](ANDROID_DOWNLOADS.md), [남은 차단 항목](BLOCKERS.md)을 재개 기준으로 사용한다. `feat/merchant-claim-status`의 응답 유실 조정은 별도 로컬 작업이며 이번 이력 통합에 포함하지 않는다.

## 2026-09-28~29 개인 비공개 저장소의 당시 작업

- **시연 Preview 5 GitHub Release:** `main` 소스 `88932cb`에서 [시연 전용 APK](https://github.com/choijunhuk/MassCOM/releases/tag/showcase-android-v0.1.0-preview.5)와 AAB를 빌드했다. [증거](evidence/showcase-preview5-release-2026-09-29.json): 전용 package·Keychain 서명·source marker·지갑 표면 PASS, APK 154132481바이트의 SHA-256 `bc8c5bd6e0cd1ac0ae6a53db806dbad70714169f9c5573483c01386173ed19e0`이 GitHub 자산 digest와 일치한다. 개인 저장소는 `PRIVATE`이고 내부 versionName/code는 `0.1.0-test.2`/`2`; 실제 휴대전화 설치·새 2분 고객 QR·두 기기 수령은 `NOT_RUN`이다. 기존 Preview 4와 운영 test.3은 대체/삭제하지 않았다.
- **운영 캠페인 초안 배포:** 개인 [Issue #3](https://github.com/choijunhuk/MassCOM/issues/3)의 [PR #15](https://github.com/choijunhuk/MassCOM/pull/15) merge `fd0a9b2`를 PR/main CI PASS 뒤 [기존 Lightsail API·웹](evidence/operating-campaign-draft-deployment-2026-09-29.json)에 배포했다. migration 0026은 관리자 감사 작업 허용값만 확장하고 DRAFT 캠페인의 기간·정원·목표 1·3·5·감사를 한 거래로 저장한다. API 122/122·웹 47/47·별도 `_test` PostgreSQL 관리자 12/12 PASS, mode 600 백업 목록, 운영/시연 API health·주요 www 200, 미로그인 목록 401·Origin 없는 생성 403. 지정 관리자 계정에는 '저장된 비공개 초안이 없습니다'가 표시되고 점포 0곳이라 입력 폼은 숨김. 운영 점포·캠페인·mint 0, 시연 3/3/2 유지. **실제 점포 초안 입력·공개·정원 적용은 `NOT_RUN`**이며 D-023 정책은 미정이다.
- **운영 재발급 배포:** 개인 [Issue #3](https://github.com/choijunhuk/MassCOM/issues/3)의 [PR #13](https://github.com/choijunhuk/MassCOM/pull/13) merge `c02da0f`를 PR/main CI PASS 뒤 [기존 Lightsail API·웹](evidence/operating-merchant-reissue-deployment-2026-09-28.json)에 배포했다. 첫 발급 응답 손실 시 재생 응답의 슬롯 버전을 이용해 기존 코드를 명시적으로 폐기하고 새 QR을 발급하는 화면이며, 응답 불명 상태는 성공으로 꾸미거나 자동 반복하지 않는다. mode 600 백업 목록 PASS, migration 25건 불변, 두 API health·주요 www 페이지 200, 미로그인 재발급 401·Origin 없는 요청 403, 운영 관리자 1명/점포·직원·슬롯·mint 0과 시연 3/3/2 유지. 지정 계정의 `/admin/` 로그인 화면은 재배포 후에도 정상이다. 실제 직원·고객의 재발급 및 두 휴대전화 수령은 `NOT_RUN`, 재발급 응답 자체가 유실된 뒤 서버 상태 조정은 후속이다.
- **운영 현황 조회 배포:** 개인 [Issue #3](https://github.com/choijunhuk/MassCOM/issues/3)의 [PR #14](https://github.com/choijunhuk/MassCOM/pull/14) merge `88932cb`를 PR/main CI PASS 뒤 [기존 Lightsail API·웹](evidence/operating-admin-status-deployment-2026-09-29.json)에 배포했다. 최대 100개 실제 점포의 QR·방문·보상·NFT 작업·오류 코드 수만 반환하고 고객 ID·지갑 주소·QR/주문 원문은 제외한다. 별도 `_test` PostgreSQL 11/11과 리뷰 MEDIUM 2건 수리, 작은 DB EXPLAIN 약 1.847ms는 PASS이나 대량 부하는 미측정. mode 600 백업 목록, API·웹 건강, 미로그인 현황 401, 관리자 주 Google 계정의 빈 점포 현황 화면 PASS; 운영 점포·직원·슬롯·mint 0, 시연 3/3/2 유지. 실제 운영 점포 수치 화면은 `NOT_RUN`이다.
- **비공개 캠페인 초안 소스:** `feat/admin-campaign-drafts`는 기존 DRAFT DB 상태와 관리자 감사를 써서 실제 점포의 기간·정원·목표 1·3·5를 저장·조회한다. 공개·참여·보상·NFT 작업은 시작하지 않으며 D-023 미확정 수령 규칙을 적용하지 않는다. API 122/122·운영 웹 47/47·별도 `_test` PostgreSQL 관리자 12/12·타입/build/gate PASS; 첫 fixture 필수 점포 상태 누락을 수정했다. 시험 DB는 제거했고 운영 점포·캠페인·mint는 0이다. PR·배포·실계정 초안 입력은 `NOT_RUN`.
- **운영 점주 QR 발급 배포:** 개인 [Issue #3](https://github.com/choijunhuk/MassCOM/issues/3)의 [PR #12](https://github.com/choijunhuk/MassCOM/pull/12) merge `c1ea375`는 PR/main CI PASS. 기존 Lightsail API·웹에 고객 2분 식별 QR 확인, 실제 이용 확인 뒤 계정 귀속 방문 수령 QR, 카메라 지원·직접 입력 대체, 발급 중 중복 클릭 방지를 [배포](evidence/operating-merchant-qr-deployment-2026-09-28.json)했다. API/웹 건강·외부 페이지 200·미로그인 401·Origin 없는 발급 403, 운영 관리자 1명/점포·직원·슬롯·mint 0과 시연 3/3/2 유지. mode 600 백업을 별도 임시 DB에 실제 복원해 migration 25건·핵심 테이블 8개 수량 일치 후 임시 DB를 삭제했다. 지정된 주 Google 계정의 인증 브라우저가 `/admin/` 빈 점포 등록 화면에 진입했고 같은 계정의 `/merchant/`에는 승인 점포가 없음도 확인했다. 소스 API 120/120·웹 39/39, PR CI PostgreSQL/Android/Worker PASS; 실제 점주 계정 브라우저·두 휴대전화 촬영/수령은 `NOT_RUN`. 응답 손실 후 재발급은 `feat/merchant-claim-reissue` 소스 작업 중이고 **아직 운영 배포 아님**.
- **운영 점포 메뉴·영업시간 배포:** 개인 [Issue #3](https://github.com/choijunhuk/MassCOM/issues/3)의 [PR #11](https://github.com/choijunhuk/MassCOM/pull/11) merge `8a8ba78`을 PR/main CI PASS 뒤 기존 Lightsail API·웹에 배포했다([증거](evidence/operating-merchant-menu-deployment-2026-09-28.json)). migration 0025, mode 600 DB 백업 목록 PASS, 운영/시연 API health 200, 운영 웹 `/admin/`·`/merchant/` 200, 미로그인 관리/직원 API 401. 운영 점포·직원·슬롯·mint 0, 관리자 1명, 시연 3/3/2 유지. 관리자 입력→고객 웹·Android 상세 연결 소스는 API 117/117·PostgreSQL 75 PASS/2 SKIP·웹 31/31·모바일 242/242와 구형 API 응답 호환성 재검토 CLEAR; 실제 점포 입력·공개 캠페인·새 Android 설치본은 `NOT_RUN`. 이후 QR 발급 소스는 위 PR #12로 별도 병합·배포했다.
- **최신 개인 통합·시연 배포:** [Issue #1](https://github.com/choijunhuk/MassCOM/issues/1)의 [PR #2](https://github.com/choijunhuk/MassCOM/pull/2)를 `main` merge `6585614`로 병합했고 PR CI `36370159651`·병합 후 main CI `36370675407`이 PASS했다. 첫 CI `36369704684`는 README 문구 시험이 낡아 FAIL했으며 21/21 RED→GREEN 수정 뒤 재검사했다. [Preview 4 APK](https://github.com/choijunhuk/MassCOM/releases/tag/showcase-android-v0.1.0-preview.4)는 같은 커밋의 전용 서명·원격 SHA-256 확인까지 완료했고, 별도 Lightsail 시연 API만 이미지 `6585614`로 교체·migration 0019 적용했다([증거](evidence/showcase-customer-qr-deployment-2026-09-28.json)). 백업 custom archive 목록 PASS, 시연 DB 가상 점포/방문/보상권 3/3/2 불변, 운영 가상 점포 0·운영 컨테이너 불변, 두 API와 www HTTPS 200. **휴대전화가 adb에 없어 새 APK 설치·2분 고객 식별 QR 실기는 `NOT_RUN`**. 구 Preview 3 STAFF 발급은 새 API와 호환되지 않으므로 직원 실기는 Preview 4로 수행한다. Issue #1은 실기까지 열어 둔다.
- **운영 관리자 첫 구간 배포:** 개인 [Issue #3](https://github.com/choijunhuk/MassCOM/issues/3)의 [PR #5](https://github.com/choijunhuk/MassCOM/pull/5) API 소스 `139e122`와 [PR #7](https://github.com/choijunhuk/MassCOM/pull/7) 운영 웹 이미지 `977a385`를 PR/main CI PASS 뒤 기존 Lightsail에 배포했다. 처음 `/admin/`만 `500`이었던 `admin.html` 이미지 누락을 수정하고 apex/www `200`, 미로그인 `401`, Origin 없는 쓰기 `403`·두 API health `200`을 [검증](evidence/operating-admin-deployment-2026-09-28.json)했다. 운영 DB 백업 archive 목록·migration 0017→0022, 사용자가 지정한 주 Google 계정과 시연 STAFF 신원 1:1 일치 후 관리자 권한 1명·감사 1건 확인; 신원 원문은 출력/기록하지 않았다. 실제 점포/운영 가상 점포 0/0, 시연 가상 점포 3. 인증된 브라우저의 실제 점포 업무·직원·캠페인·그림·상태 관리는 `NOT_RUN/후속`이다. 운영 Android는 고객 전용이며 시연 자료는 운영 DB에 넣지 않았다.
- **운영 직원 등록 배포:** 개인 [Issue #3](https://github.com/choijunhuk/MassCOM/issues/3)의 [PR #10](https://github.com/choijunhuk/MassCOM/pull/10) merge `83357d6`는 PR/main CI PASS. 계정·점포 귀속 15분 코드·관리자 승인/STAFF 회수·감사 거래와 `/merchant/` 웹을 [기존 Lightsail에 배포](evidence/operating-staff-deployment-2026-09-28.json)했다. DB 백업 archive 목록·migration 23→24, apex/www `/merchant/`·JS 200, 미로그인 401·Origin 없는 등록 403·Google 계정 선택 302, 운영 관리자 1명/직원 요청·권한·점포·mint 0과 시연 3/3/2 유지. 소스 로컬 API 116/116·PostgreSQL 73 PASS/2 SKIP·웹 28/28·Caddy 2/2 통합 검증. 실제 직원 권한 부여·고객 QR 촬영/방문 수령은 `NOT_RUN`; 운영 DB에 가상 점포·직원은 추가하지 않았다.
- **삭제 요청 접수·보안 운영 배포:** 개인 [Issue #6](https://github.com/choijunhuk/MassCOM/issues/6)의 [PR #8](https://github.com/choijunhuk/MassCOM/pull/8) merge `183d5ed`와 [PR #9](https://github.com/choijunhuk/MassCOM/pull/9) merge `4d59347`의 PR/main CI PASS 뒤 기존 Lightsail API·웹·Caddy를 `4d59347`로 배포했다. [증거](evidence/operating-deletion-intake-deployment-2026-09-28.json): DB 백업 archive 목록·migration 21→23, apex/www 안내 200, 미로그인 접수 401·Origin 없는 접수 403·GET 405, Google 계정 선택 302, 브라우저의 미로그인 안내와 접수 행 0. 관리자 권한 1명·운영 점포/mint 0, 시연 3/3/2는 유지했다. 삭제 거래는 서명된 `auth_time` 원시각과 잠긴 세션 행의 최신 5분을 재확인하고 비종결 mint를 대기시킨다. **인증된 실계정 접수·실제 삭제·삭제 후 자동 재정산/결과 통지는 `NOT_RUN/BLOCKED`**이며 Google의 강제 최근 재인증도 공식 문서에서 보장되지 않는다.

## 2026-09-28 보관된 조직 저장소와 개인 비공개 저장소 — 당시 기록

- **진행 중 통합 PR:** 개인 [Issue #1](https://github.com/choijunhuk/MassCOM/issues/1)의 `feat/customer-first-loop`를 [PR #2](https://github.com/choijunhuk/MassCOM/pull/2)로 열었다. QR 소스·도감 다음 목표·이전 시연 카메라 증거를 merge commit `698af5b`·`8c6feb3`으로 결합했고 로컬 API 109/109·모바일 239/239·PostgreSQL 16 전용 `_test` 52 PASS/2 SKIP·타입·린트·API build·Android export·문서 검사 PASS. 첫 PR CI `36369704684`는 README의 오래된 문구 assertion으로 FAIL했고 로컬 RED→GREEN 21/21 수정은 원격 재검증 전이다. 병합·새 APK/API 배포와 새 고객 식별 QR 실기는 `NOT_RUN`. Play 목표는 [D-040](DECISIONS.md)대로 유지하되 제출하지 않는다.

- **실제 시연 카메라 QR 결과:** [Preview 3 Samsung 실측](evidence/showcase-preview3-camera-claim-2026-09-28.json)은 같은 Google 계정의 시연 STAFF·고객 역할 전환으로 점주 발급 QR을 Mac에 표시하고 휴대전화 카메라로 촬영→미리보기→수령 확정→도감 가상 점포 A 방문 1회를 확인했다. 시연 DB 슬롯 1(`CLAIMED`)·유효 방문 1·보상권 1·mint 0, 운영 가상 점포 0. 앞선 다른 계정용 QR 거절은 슬롯이 미사용·미만료였고 계정 불일치가 원인이다. 코드·계정 ID·이메일·세션은 증거에 없다. 두 계정·두 휴대전화, 새 2분 고객 식별 QR 브랜치, 오프라인/권한 거부는 `NOT_RUN`; A01 전체 상태는 유지한다.

- **원격 상태:** `2026-KW-HACKATHON/27_MassCOM`은 `PUBLIC`·`Archived`다. 사용자는 보관 해제 대신 개인 GitHub를 선택했다. [개인 `choijunhuk/MassCOM`](https://github.com/choijunhuk/MassCOM)을 `PRIVATE`로 생성하고 기존 Git 커밋 이력을 보존한 `main`(`9706e61`)을 push했다. 원격 이름 `personal`이며 기존 조직 `origin`은 보존하되 더 이상 push·merge하지 않는다. 개인 저장소의 default branch는 `main`, 보관 상태는 false로 확인했다.
- **마지막 조직 통합 기준선:** [PR #204](https://github.com/2026-KW-HACKATHON/27_MassCOM/pull/204) merge `9706e61`, PR/main CI PASS. 비로그인 공개 점포 탐색과 개인 화면 로그인 안내의 **소스**만 통합됐고 공개 운영 test.3·시연 Preview 3 APK는 이전 코드다. Issue #202의 새 APK 로그인 복귀·두 계정 격리는 `NOT_RUN`으로 유지한다.
- **보관으로 중단된 PR:** [PR #207](https://github.com/2026-KW-HACKATHON/27_MassCOM/pull/207)은 도감 다음 목표 소스 브랜치 `feat/205-collection-next-goal`의 HEAD `dd769ae`다. 로컬 모바일 230/230·타입·린트·Android export PASS, 독립 리뷰 CLEAR. GitHub CI run `36353558484`는 Android 단계 도중 **`repository archived`로 CANCELLED**됐으므로 PR은 OPEN·미병합이고 CI PASS로 표시하지 않는다. 조직 설정을 우회하지 않는다.
- **개인 작업 브랜치:** `feat/205-collection-next-goal` `dd769ae`, `feat/203-customer-identity-qr` `90fa019`, `feat/194-verified-deletion-intake` `d051ef3`, `docs/personal-handoff-archive` `6932649`를 모두 `personal`에 push하고 원격 SHA를 일치 확인했다. QR은 API 109/109·PostgreSQL 16 전용 `_test` migration 후 52 PASS/2 SKIP·모바일 231/231·타입·린트·build/export PASS, 리뷰 HIGH 2·MEDIUM 2 수정 후 재검토. 처음 PostgreSQL 테스트는 migration 선행 누락으로 FAIL했고 같은 코드로 PASS했다. 도감은 모바일 230/230·타입·린트·export 및 독립 리뷰 CLEAR. 새 APK·외부 API 배포·실제 QR 촬영은 `NOT_RUN`; **구 Preview 3 STAFF 발급과 새 API는 호환되지 않으므로 서버만 먼저 배포하지 않는다.**
- **다음 통합 경계:** 개인 `main` `9706e61`의 첫 [CI run `36354490206`](https://github.com/choijunhuk/MassCOM/actions/runs/36354490206)은 `SUCCESS`다. 개인 [PR #2](https://github.com/choijunhuk/MassCOM/pull/2)는 열려 있고 현재 첫 CI 실패를 수정해 재검사 전이며 개인 병합·Release는 없다. private Actions는 무료 포함 분량 초과 시 과금될 수 있지만 현재 사용량 API가 권한 부족(404)이라 추가 PR CI의 비용 상한을 확인하지 못했다. 기존 조직 PR #207은 보관 때문에 중단됐다. 개인 PR CI/리뷰가 통과하기 전 QR·도감을 `main` 완료로 쓰지 않는다.

## 현재 GitHub·운영 상태 — 2026-09-28

- **제품 코드·검사:** [PR #197](https://github.com/2026-KW-HACKATHON/27_MassCOM/pull/197) merge `174aa13`(PR/main CI `36332791455`/`36333774247` PASS)와 [PR #198](https://github.com/2026-KW-HACKATHON/27_MassCOM/pull/198) merge `c5cba68`(PR/main CI `36334339405`/`36334694626` PASS). 운영 웹 tar의 검증 파일 누락과 운영 AAB의 `CI=1` Metro 캐시로 인한 Google 설정 누락을 회귀 시험으로 고쳤다. [PR #199](https://github.com/2026-KW-HACKATHON/27_MassCOM/pull/199)의 출시 증거와 [PR #200](https://github.com/2026-KW-HACKATHON/27_MassCOM/pull/200)의 공개 설치 페이지도 PR/main CI 뒤 병합했다.
- **공개 웹:** 기존 Lightsail의 웹·Caddy만 갱신했다. `174aa13`에서 [계정 삭제 안내·www 웹](evidence/web-only-deployment-2026-09-28.json)을 반영했고, 최신 `088cebe`에서 [apex/www `/open`의 운영 test.3·시연 Preview 3 다운로드 안내](evidence/public-open-page-2026-09-28.json)를 반영했다. 첫 `088cebe` 전송은 SSH exit 255로 중단됐으나 이전 웹 마커와 API/DB가 유지됐고 재시도는 exit 0. 두 `/open` URL은 HTTPS 200/TLS·소스 해시 일치, 다른 www 경로와 두 API도 200이며 운영 점포 0·시연 가상 3을 유지한다. 운영 API/DB 전체 배포와 migration은 수행하지 않았다.
- **두 설치본:** [운영 test.3 APK](https://github.com/2026-KW-HACKATHON/27_MassCOM/releases/tag/android-v0.1.0-test.3)는 source `c5cba68`의 업로드 키 서명본이다. AAB/APK 번들에 운영 API URL·Google Web client가 들어 있고 GitHub digest·익명 다운로드를 확인했다. Samsung 4KB 설치·운영 빈 점포·승인된 계정의 새 Google 로그인·콜드 복원, Android 36 16KB AVD 설치·콜드 실행을 [기록](evidence/operating-android-test3-2026-09-28.json)했다. 이전 `22283d7` AAB는 서명됐지만 설정 누락 실기 때문에 배포하지 않았다. [시연 Preview 3](https://github.com/2026-KW-HACKATHON/27_MassCOM/releases/tag/showcase-android-v0.1.0-preview.3)은 [Samsung 설치·가상 3점포·Google 취소 후 재진입](evidence/showcase-preview3-phone-2026-09-28.json)까지만 확인했다.
- **남은 게이트:** 초대 밖 실제 Google 계정의 시연 새 로그인(#191/B-019), 운영 release 외부 지갑·실제 QR 수령, 16KB 화면 캡처/TalkBack, 사용자 설정상 자동 App Link 열기, 실제 점주·현장 자료는 별도 미검증이다. 운영 계정 삭제의 안전한 계정 매핑·실제 처리 [#194/B-020](BLOCKERS.md)과 Play 제출은 `BLOCKED/NOT_RUN`. APK 내부 `versionCode`는 아직 2라 test.3 태그를 Play 버전 증가로 보지 않는다. 비밀번호·복구 문구·OAuth secret은 Git·문서에 없다.

## 이전 GitHub·운영 상태 — 2026-09-27 당시 기록

- **최신 시연 앱·운영 준비:** [PR #195](https://github.com/2026-KW-HACKATHON/27_MassCOM/pull/195) merge `128ce5f`, PR CI `36322060841`·main CI `36322378979` PASS. 로그인 시간초과/안내, 웹 삭제 요청 링크, 시연 그림의 운영 Android bundle 제외, PG16·두 variant CI, 운영 전체 배포 실패 복구를 반영했다. 기존 시연 전용 키로 [Preview 3 APK](https://github.com/2026-KW-HACKATHON/27_MassCOM/releases/tag/showcase-android-v0.1.0-preview.3)를 서명·게시하고 GitHub digest/익명 HTTPS 200을 [확인](evidence/showcase-preview3-release-2026-09-27.json)했다. **현재 폰은 `adb` 미연결**이라 Preview 3 설치·초대 밖 실계정 로그인은 `NOT_RUN`; 운영 최신 AAB/APK·전체 운영 재배포도 미실행이다. 삭제 이메일 요청은 검증된 Google 계정 ID에 안전하게 연결되지 않아 [Issue #194](https://github.com/2026-KW-HACKATHON/27_MassCOM/issues/194) 출시 차단을 유지한다. 문서·배포 증거는 [PR #196](https://github.com/2026-KW-HACKATHON/27_MassCOM/pull/196)에서 추적한다. 재개 시 `git status -sb`, `gh pr list`, `gh run list`, `adb devices`를 다시 확인한다.

- **시연 API 배포 당시:** [PR #192](https://github.com/2026-KW-HACKATHON/27_MassCOM/pull/192) merge `7455791`, PR/main CI PASS 뒤 시연 API 이미지 하나만 교체했다. [당시 실측](evidence/showcase-open-login-api-deployment-2026-09-27.json)에서 가상 점포 3·방문 2·보상권 1·활성 세션 2 보존, 운영 가상 0·운영 컨테이너 불변을 확인했다. 그때 Preview 2는 이전 설치본이었고 이후 Preview 3의 서명·게시 상태는 위 최신 항목을 따른다. 실제 초대 밖 계정 로그인은 아직 `NOT_RUN`이다.
- **가상 점포 수집품 그림(Issue #189):** [PR #190](https://github.com/2026-KW-HACKATHON/27_MassCOM/pull/190)의 `feat/showcase-merchant-collectible-art`에서 A·B·C 그림 3종을 본인 가상 보상권 카드에만 연결했다. PR 첫 CI `36310316973` PASS, 모바일 206/206·typecheck·lint·Android JS export, 서명 APK source `7322470`/SHA-256 `cdc30ef9222c0b2557dc934958e99dce0d4dcd69df6cb7d12916cc57503184e1`의 Samsung 설치·라이트/다크/200% 글자 실기는 PASS([증거](evidence/showcase-collectible-art-2026-09-27/device-check.json)). 첫 빌드 `71a569a`의 카드 이미지 넘침은 수정·재실기했다. [Preview 2](https://github.com/2026-KW-HACKATHON/27_MassCOM/releases/tag/showcase-android-v0.1.0-preview.2)에 새 그림 APK를 올리고 재다운로드 해시·바이트를 확인했다. Preview 1은 이전 설치본이다. TalkBack·외부 지갑 썸네일은 `NOT_RUN`, 실제 `image` 없는 Base Sepolia 메타데이터는 변경하지 않았다([범위](SHOWCASE_COLLECTIBLE_ART.md)). PR 재검사·merge·main CI 상태는 `gh pr view 190`, `gh run list --branch main`, `git log origin/main -1`로 확인한다.
- **UI 개편 완료:** Issue #183·#184를 [PR #185](https://github.com/2026-KW-HACKATHON/27_MassCOM/pull/185)·[PR #186](https://github.com/2026-KW-HACKATHON/27_MassCOM/pull/186)으로 병합했다(main `95aaba1`). Samsung에는 같은 코드의 시연 APK `c956d1f`가 설치돼 있고 라이트 모드 네 화면을 [실기 기록](evidence/ui-mascot-2026-09-27/device-check.json)으로 남겼다. 다크·200% 글자·TalkBack은 `NOT_RUN`. 빌드 도우미 `/Users/choi/Desktop/MassCOM/run-showcase-build.command`는 첫 인자로 worktree 경로를 받고 기본값은 `.worktrees/184-mascot`이다(Keychain 승인은 사용자). README 화면은 Issue #187에서 새 캡처로 교체했다.
- **재개 기준:** `main` 기준선은 PR #195 merge `128ce5f`; 열린 Issue #191·#193은 Preview 3 실기와 운영 최신 설치본·웹 배포 완료 전까지 유지한다. 재개 시 `git log origin/main -1`, `gh pr list`, `gh issue list`, 새 릴리스·서버 이미지 상태를 확인하고 로컬 빠른 검사는 `tools/gate.sh`로 한다. 과거 닫힌 PR #180 출처 문구는 당시 후속 정합 PR에 포함됐다.
- **사용자 결정 대기:** 중간 제출(2026-09-28 07:00 KST) 발표·리허설, 무로그인 탐색 유지 여부(B-017), 실제 점주 현장 파일럿(`docs/FIELD_VALIDATION.md`), 팀원별 기여 설명. 저장소 public 전환(D-010)은 사용자가 완료했다. 에이전트가 대신 최종 제출하지 않는다.
- **최신 시연 실기:** [두 초대 계정 폰·DB 근거](evidence/showcase-two-account-phone-2026-09-27.json)에서 같은 Samsung·시연 APK `c53c199`로 STAFF 발급→다른 초대 Google 계정 로그인→직접 코드 미리보기·수령→도감 방문 2/앱 수집품1/NFT0→재입력 추가 효과 0을 확인했다. 시연 DB 슬롯 3·방문 2·보상권 1·mint 0, 운영 DB 가상 점포 0. 실제 카메라 QR 촬영 수령·시연 지갑·`demo.masscom.kr` App Link는 `NOT_RUN`; Issue #137은 OPEN. 이번 README 개편은 user-provided MassCOM 콘셉트 그림을 오해 없는 Hero로 편집하고 실제 Android 화면 4장·Mermaid·최신 근거를 연결한다. 일회용 코드·계정 식별자는 문서/이미지에 넣지 않는다.

### 아래 한 항목은 시연 APK 첫 릴리스 시점의 기록

- **최신 재개 기준:** [PR #177](https://github.com/2026-KW-HACKATHON/27_MassCOM/pull/177) merge `74d9eb1`, PR/main CI `36266216091`/`36266648303` PASS. [시연 Android 실증](evidence/showcase-android-apk-2026-09-27.json)의 source `c53c199` APK를 Samsung SM-S928N Android 16에 운영 앱과 함께 설치하고 전용 Google 로그인·가상 점포 A/B/C·빈 도감·카메라·가상 A점포 STAFF 발급을 확인했다. [private Preview 1 Release](https://github.com/2026-KW-HACKATHON/27_MassCOM/releases/tag/showcase-android-v0.1.0-preview.1)에 APK·체크섬·provenance를 올리고 다시 내려받아 SHA-256과 바이트 일치를 확인했다. 고객의 **폰 QR 촬영→수령·두 계정 도감 분리, `demo.masscom.kr` App Link·별도 Reown·NFT는 미검증**이라 Issue #137을 닫지 않는다. 로컬 실행 도우미 `/Users/choi/Desktop/MassCOM/run-showcase-build.command`는 기존 Keychain 값만 사용하고 비밀번호를 Git/채팅에 기록하지 않는다. 이 도우미는 현재 작업공간 경로를 사용하므로 worktree를 옮기면 경로를 갱신한다. 한 번 노출된 구 QR은 즉시 재발급으로 폐기했고 새 코드는 남기지 않았다. 이전 빌드 산출물은 `apps/mobile/release-artifacts/`(Git 무시)에 보존했다.

### 아래 한 항목은 APK 전 단계의 당시 기록

- **재개 기준:** [PR #175](https://github.com/2026-KW-HACKATHON/27_MassCOM/pull/175) merge `036f31f`, PR/main CI `36258512932`/`36260544567` PASS. [공개 edge 증거](evidence/showcase-public-edge-2026-09-27.json)의 기존 Lightsail `https://demo-api.masscom.kr/health` 200·TLS 검증, 가상 점포 A/B/C 3곳·익명 도감 401, 운영 API/웹 200·운영 점포 0곳을 확인했다. Samsung 폰의 자체 curl도 시연 API·운영 API·시연 웹에서 HTTPS 200/TLS 검증 성공. 운영 Caddyfile/Compose는 서버의 `/opt/masscom/backups/showcase-edge-036f31f`에 백업했고 Caddy만 재생성했으며 운영 API/DB/웹 컨테이너 ID·재시작 횟수는 불변이다. 서버의 Caddy·Compose는 merge `036f31f`, 시연 API 이미지는 변경 없는 기존 `7dba450`이다. 별도 시연 서명 키/Google client·Samsung ADB·142GiB 여유·APK `--check`는 준비됐지만 Keychain 비밀번호 자동 읽기가 OS 승인 대기에서 멈춰 **서명 APK·설치·GitHub Release·카메라 QR 실기는 없음**. 이 배포 상태는 문서 PR #176에 기록하고 비밀번호·토큰은 남기지 않는다. 다음 안전 단계는 기존 키에 대한 로컬 접근 완료 → 같은 키 지문 재검증 → 시연 release APK 빌드 → 삼성 폰 동시 설치·QR/로그인 실기 → private Release다. 새 키를 임의로 다시 만들거나 운영 키·DB를 건드리지 않는다.

### 이하 항목은 공개 전 단계의 당시 기록

- 사용자 승인으로 가비아 `demo-api.masscom.kr` A `43.200.56.97` TTL 600을 저장했고 권한 DNS·1.1.1.1·8.8.8.8 일치를 확인했다. 운영 Web OAuth에 `http://localhost:4176` 원본을 일시 허용해 실제 운영 audience Google 토큰을 내부 시연 API에 보냈을 때 `401 ID_TOKEN_AUDIENCE_MISMATCH`·DB 쓰기 0을 확인한 뒤 임시 원본을 제거·재조회했다([증거](evidence/showcase-dns-audience-2026-09-27.json)). 사용자에게는 **공개 시연 API 전환**을 별도 질문으로 요청했고 응답 전에는 운영 Caddy를 변경하지 않는다. [PR #175](https://github.com/2026-KW-HACKATHON/27_MassCOM/pull/175) HEAD `189e937`의 CI `36256581264` PASS지만 Draft·미병합이다. 이 브랜치의 Caddy-only override는 현재 운영 Compose와 읽기 전용 합성 PASS; 실제 적용·공인 TLS·서명 APK는 `NOT_RUN`이다.

- Issue #137 내부 실계정 검증: `localhost:4175` 로컬 화면과 SSH 터널에서 전용 Google Web audience의 실제 두 계정 로그인 200/200, 임시 한 계정 초대 프로세스의 두 번째 계정 `403 INVITE_REQUIRED`·DB 쓰기 0을 확인했다. 첫 계정만 가상 A점포 STAFF이고 API context/발급 빈 입력은 첫 계정 200/400, 두 번째 403/403이다. 가상 A점포 STAFF 발급→고객 미리보기→첫 수령→같은 코드 재수령은 201/200/200/200(`replayed=true`), DB claim slot/방문/보상권 1/1/1·mint 작업 0, 고객 도감 1/1·STAFF 도감 0/0이다. 시험 세션은 모두 철회했고 임시 비초대 프로세스·터널은 중지했다([증거](evidence/showcase-internal-auth-claim-2026-09-27.json)). 실제 Android QR·운영 audience 유효 토큰 401·외부 HTTPS·APK는 `NOT_RUN`. [PR #175](https://github.com/2026-KW-HACKATHON/27_MassCOM/pull/175)은 독립 리뷰의 서비스 이름 충돌/배포 probe 결함을 수정한 뒤 CI PASS, **아직 병합·공개 배포하지 않음**. 기존 운영 Caddy/DNS는 변경하지 않았다.

- [PR #174](https://github.com/2026-KW-HACKATHON/27_MassCOM/pull/174) merge `7dba450`의 PR/main CI PASS 뒤, 기존 Lightsail의 별도 `/opt/masscom-showcase`에 그 커밋의 API를 배포했다. `runtime.env`는 Git 밖 mode 600이고 초대 해시 2개는 앞서 검증된 Google 로그인 subject에서 서버 내부에서만 산출했다. 별도 Compose `masscom-showcase`의 API/DB는 healthy이며 API host binding은 `127.0.0.1:3301`뿐이다. seed 3회 뒤 가상 점포/캠페인/목표 `3/3/9`, 시연 방문·identity·session `0/0/0`, 운영 DB 가상 점포 0, 운영 네 컨테이너 ID·재시작 횟수 불변, 운영 HTTPS health 200을 [내부 증거](evidence/showcase-internal-2026-09-27.json)에 기록했다. 현재 `feat/137-showcase-edge`는 전용 Docker edge/Caddy 코드와 시험을 준비 중이지만 **서버의 Caddy/DNS는 변경하지 않았다**. 실제 Google 초대 로그인·STAFF·외부 HTTPS·시연 서명 APK는 `NOT_RUN`이다.

- 2026-09-26 시점: 시연 Android APK 빌드 경계는 [PR #173](https://github.com/2026-KW-HACKATHON/27_MassCOM/pull/173) merge `8d69c5b`, PR CI `36247822210`·main CI `36248205679` PASS다. 사용자 승인으로 시연 전용 서명 키를 Git 밖에 만들고 로컬 Keychain 비밀번호로 인증서를 열었다([D-035](DECISIONS.md)). Google Web/Android 전용 client와 OAuth 테스트 사용자 2명, Samsung SM-S928N ADB `device`, 실제 공개 ID·키 지문의 `scripts/build-showcase-apk.sh --check`를 확인했다([OAuth 준비 근거](evidence/showcase-oauth-2026-09-26.json)). 검사는 운영값·개발 DEMO·운영/디버그 키 재사용을 거절하지만 APK를 만들지는 않는다. 당시 브랜치 `feat/137-showcase-live`는 기존 Lightsail의 [비용·용량 사전검사](evidence/showcase-host-preflight-2026-09-26.json)와 비밀값 생성 경계를 준비했다. 키 백업은 미확인이고 운영 API/DB·기존 키·운영 APK는 변경하지 않았다.

- D-034 www/apex 공존 코드는 [PR #169](https://github.com/2026-KW-HACKATHON/27_MassCOM/pull/169)로 병합했고 PR/main CI PASS, 기존 Lightsail에 merge `3c59ac0`을 배포했다. 정적 `/preview` 허용 목록, 호스트별 OAuth state·웹 세션, 정확한 Host·Origin 거부 경계를 구현했고 독립 리뷰의 지연 콜백 롤백 시험 지적을 수정했다([로컬 증거](evidence/www-web-local-2026-09-25.json)). 운영 DB 0016·0017 적용·기존 컨테이너 보존·백업, Google `www` 콜백 추가, 가비아 `www` A 전환, 공인 TLS와 시연 원본 바이트 일치까지 PASS. Samsung Chrome에서 www 실계정 1개의 빈 도감·재열기·로그아웃과 apex 세션 유지도 확인했다([전환 증거](evidence/www-web-cutover-2026-09-25.json)). www의 두 번째 계정·실제 기록이 있는 도감·시연 Android APK는 여전히 미완료다.

- 시연 웹의 대표 주소는 [https://www.masscom.kr/preview/](https://www.masscom.kr/preview/)이며, 이전 Vercel 주소는 장애 복구 후보로 보존한다([전환 증거](evidence/www-web-cutover-2026-09-25.json)). 별도 private [웹 전용 사전 릴리스 태그](https://github.com/2026-KW-HACKATHON/27_MassCOM/releases/tag/showcase-web-v0.1.0-preview.1)는 `f96c324`를 가리키고 정적 HTML/CSS ZIP만 담는다([태그 생성 당시 근거](evidence/showcase-web-release-2026-09-25.json)); 릴리스 설명의 바로 보기 주소도 www로 갱신했다. 시연 Android APK·태그는 없다. `demo-api.masscom.kr` DNS가 없어 운영 APK를 시연용으로 재포장하지 않는다.

- 이전 운영 웹 실증 기준선: [PR #166](https://github.com/2026-KW-HACKATHON/27_MassCOM/pull/166) merge `c0ad8d6`, PR CI `36047283723`·당시 병합 후 main CI `36048047690` PASS. 당시 운영 API 배포는 `d787471`이었고 최신 배포는 위 D-034 항목을 따른다. `masscom.kr`의 Google 로그인 시작 302·익명 도감 401, `api.masscom.kr/health` 200을 확인했었다. 재개 시 `git status -sb`, `git log origin/main -1`, `gh pr list`, `gh run list --branch main`을 우선한다.
- Samsung SM-S928N Chrome의 기존 apex에서 두 Google 계정 순차 로그인·A 로그아웃 후 B 세션 유지 PASS([이전 실기 증거](evidence/android-web-auth-2026-09-25.json)). 새 www는 한 계정의 로그인·로그아웃·apex 세션 보존까지 PASS([전환 증거](evidence/www-web-cutover-2026-09-25.json)). www의 두 번째 계정, 비어 있지 않은 도감의 교차 노출, 최신 운영 APK·일반 App Link 자동 선택·시연 API/앱은 `NOT_RUN`. [Issue #137](https://github.com/2026-KW-HACKATHON/27_MassCOM/issues/137)은 OPEN이며, [최신 시험 원장](TEST_STATUS.md)을 따른다. 비밀번호·인증 숫자·OAuth 비밀값은 문서·채팅·Git에 기록하지 않는다.

## 이전 작업 시점 기록 — 현재 브랜치·PR 상태로 읽지 말 것

아래의 날짜별 결과는 기록 당시의 스냅샷이다. 그 안의 “현재”, “다음 작업”, “NOT_RUN”은 최신 판정이 아니며, 위 현재 상태·`docs/TEST_STATUS.md`의 최신 항목과 실제 `git`·`gh` 결과가 우선한다.

- `main`의 [PR #164](https://github.com/2026-KW-HACKATHON/27_MassCOM/pull/164) merge `d787471`, PR CI `36042479248`·main CI `36043259636` PASS. 같은 커밋을 기존 AWS Lightsail에 재배포했고 PostgreSQL 컨테이너 `e0d14fb7c803`은 유지됐다. `api.masscom.kr/health` 200, 공개 `/merchants` 200/0건. Google 로그인 시작은 `accounts.google.com`으로 302이며 정확한 `https://masscom.kr/api/web/auth/callback`·state·PKCE·Secure/HttpOnly state 쿠키를 확인했다. 비밀값은 채팅·Git에 남기지 않고 로컬·서버 mode 600 런타임 환경 파일에 저장, 클립보드는 비웠다.
- 실제 데스크톱 브라우저에서 기존 Google 계정 1개가 로그인해 본인 도감의 기록 0건을 표시했고 새로고침 후 세션 유지·로그아웃 후 재로드에서 미로그인 안내를 확인했다. 서버에서 최근 웹 세션 1건 중 1건이 `revoked_at` 설정됐고 익명 `GET /api/web/collection`은 401이었다. 이 결과는 실제 A/B 계정 데이터 격리나 휴대전화 브라우저 로그인·최신 Android APK 검증이 아니다. Issue #137은 시연 API/앱 등을 포함해 계속 OPEN이다.

### 더 이른 GitHub 이슈 상태 — 2026-09-25

- 최신 운영 기준: [PR #163](https://github.com/2026-KW-HACKATHON/27_MassCOM/pull/163) merge `ec57eb4`, main CI `36034481207` PASS. `masscom.kr` 가비아 apex A는 `43.200.56.97`로 저장됐고 공인 DNS, Let's Encrypt 인증서, 외부 포털·`/app/`·API 경로 HTTPS를 확인했다. 같은 커밋의 API/DB migration 0014·0015도 운영 서버에 배포했다. 기존 DB의 서버 내부 mode 600 백업 `/opt/masscom/backups/pre-web-auth-20260925.dump`를 생성하고 archive 목록을 검증했으며 PostgreSQL 컨테이너는 유지됐다. `https://api.masscom.kr/health` 200, 공개 `/merchants` 200/0건, 웹 인증 경로는 비밀값 미설정으로 예상대로 503이다. Google Web client에 `https://masscom.kr/api/web/auth/callback`을 등록해 재조회했지만 기존 비밀값은 콘솔에서 재표시되지 않는다. 소유자의 새 비밀값 생성·클립보드 복사를 기다리고 있다. 채팅·Git에는 값을 남기지 말 것.

- 이전 원격 staging 게이트: [PR #162](https://github.com/2026-KW-HACKATHON/27_MassCOM/pull/162) merge `cde6a2d`, PR CI `36031150450`·main CI `36031948040` PASS. 첫 웹 전용 `--deploy`는 없는 `/opt/masscom/web/current` fallback 처리 오류로 실패했지만 `fix/137-first-web-release`·PR #163 이후 재시도와 실제 운영 이관으로 해소됐다. 아래 과거 실패 기록을 현재 서버 상태로 해석하지 않는다.

- 이전 CI 게이트: 웹 원격 점검 [PR #161](https://github.com/2026-KW-HACKATHON/27_MassCOM/pull/161) merge `fec90ff`, PR CI `36029206895` PASS. 병합 후 main CI `36029974084`의 시연 호스트 PostgreSQL 초기화 경합은 후속 PR #162와 main CI로 해소됐다.

- 이전 #137 웹 기준선: [PR #159](https://github.com/2026-KW-HACKATHON/27_MassCOM/pull/159) merge `e6dcc82`, PR CI `36019777124`·병합 후 main CI `36020699683` PASS. 당시 웹 전용 세션/Google OIDC·읽기 전용 도감은 코드·로컬/CI 검증 단계였다. 현재 원격 웹·TLS·DNS 완료와 실계정 미완료의 분리는 맨 위 최신 기준을 따른다.

- #137 AWS 웹 이관 PR #158: [설계·실행 계획](superpowers/plans/2026-09-24-lightsail-web-consolidation.md)과 [당시 로컬 Caddy 증거](evidence/aws-web-local-2026-09-24.json)를 작성해 병합했다. 당시 원격 배포는 미실행이었으며 후속 결과는 맨 위 최신 기준을 따른다.
- #137 시연 호스트 경계는 [PR #157](https://github.com/2026-KW-HACKATHON/27_MassCOM/pull/157) merge `96341e8`, main CI `36005667769` PASS다. 이는 로컬·CI seed와 격리 근거이지 외부 시연 API 배포 증거가 아니다.
- #136 시연 역할 진입은 [PR #156](https://github.com/2026-KW-HACKATHON/27_MassCOM/pull/156) merge `5e91728`, main CI `35998825263` PASS까지 확인했다. 실제 시연 APK/외부 API·OAuth/지갑 실기는 `NOT_RUN`이므로 Issue는 계속 OPEN이다.
- [#136](https://github.com/2026-KW-HACKATHON/27_MassCOM/issues/136)과 [#137](https://github.com/2026-KW-HACKATHON/27_MassCOM/issues/137)은 `OPEN`이다. 이전 `CLOSED / NOT_PLANNED` 처리는 실행 계획 없이 미완료 수용 기준을 닫은 오류여서 되돌렸다. 그때의 종료 댓글은 이력일 뿐 완료 증거가 아니다.
- #137의 [정적 시연 웹](https://masscom-showcase-web.vercel.app)은 공개됐지만 `demo.*` DNS·외부 시연 API/DB·전용 OAuth·시연 APK/실기·운영 웹 도감의 외부 실계정 검증은 미완료다. [외부 시연 전달](superpowers/plans/2026-09-24-issue137-showcase-delivery.md)과 [운영 웹 도감](superpowers/plans/2026-09-24-issue137-production-collection.md)을 별도 검증 게이트로 진행한다.
- 당시 다음 작업이었던 OAuth 비밀값 반영·운영 웹 실계정 로그인은 위 현재 상태에서 완료 범위를 다시 판정했다. 별도 시연 환경과 실제 기록이 있는 계정 간 격리 등 남은 기준은 Issue #137 및 최신 시험 원장을 따른다.

## Issue #137 시연 웹 Chrome CI 시작 지연

- PR #151 병합 후 main CI `35988191241` 첫 시도와 PR #152 병합 후 main CI `35990461496`가 Chrome 프로세스는 살아 있으나 10초 안에 `DevToolsActivePort`가 생기지 않아 실패했다. 첫 run의 재시도는 코드 변경 없이 PASS. 같은 원인이 두 번 발생해 단순 무한 재시도 대신 `fix/137-chrome-startup-timeout`에서 시작 대기를 30초로 늘렸다. 첫 PR CI `35990774434`가 Chrome 단계에서 2분 넘게 멈춰 수동 취소했고, HTTP page list·WebSocket open·CDP 명령에 각각 8초 제한 및 진단 메시지를 더했다. 실제 웹 계산색·대비·반응형·키보드 검사는 유지한다. 수정 PR·main CI가 통과하기 전까지 #152 병합 커밋을 완전 검증 기준선으로 부르지 않는다.

## Issue #137 공개 시연 API 초대 제한 준비

- `feat/137-showcase-invite-guard`: 초대되지 않은 Google `sub`는 계정·세션 쓰기 전에 거절한다. 초대 변경은 모든 시연 API 인스턴스 재시작·이전 인스턴스 종료 후 기존 세션 조회에도 적용된다. `SHOWCASE_MODE=true` 설정은 정확한 `masscom_showcase` DB·Google audience 한 개·초대 `sub` SHA-256 목록을 요구한다. 운영 API는 해당 설정이 없어 기존 정책을 유지한다([경계 문서](SHOWCASE_AUTH_GUARD.md)). API 단위 90/90·PostgreSQL 45/45·typecheck/build 로컬 PASS.
- 기존 Lightsail의 운영 Caddy는 `admin off`이고 운영 API/DB가 같은 Compose 프로젝트에 있으므로 현재 `infra/showcase-local`을 그대로 공개하면 안 된다. 별도 시연 Compose·네트워크·비밀·초대 STAFF 연결과 Caddy 변경/되돌리기 검증 전에는 외부 API·Android 시연 로그인 `NOT_RUN`. 새 유료 자원은 생성하지 않았다.

## Issue #137 무료 시연 웹과 Android 인증 경계

- 기존 `feat/137-showcase-auth-readiness` 브랜치는 계획 커밋 `ee849f4`에서 재개했다. 별도 Vercel Hobby 프로젝트 `masscom-showcase-web`의 배포 `dpl_46Ug4QohG2bfoMEdxnT7WuJ6g5UC`가 READY이고 [기본 HTTPS 주소](https://masscom-showcase-web.vercel.app) HTML/CSS 200·A/B/C 표기 PASS다([증거](evidence/showcase-web-vercel-2026-09-24.json)). `demo.masscom.kr`은 Vercel 프로젝트에 등록됐지만 가비아 DNS가 없어 미연결. 가비아 로그인은 소유자에게 비밀번호를 보내지 않고 직접 하도록 요청했다.
- 시연 Android는 `MASSCOM_SHOWCASE_GOOGLE_WEB_CLIENT_ID` 형식을 빌드에서 요구하고 Expo config `extra.masscomShowcase`에 담는다. 런타임은 설치 package `.demo`에서만 이 값을 읽고 기존 운영 Google/Reown ID fallback을 차단한다. 시연 지갑은 별도 Reown 프로젝트 전까지 비활성. 모바일 186/186·typecheck·lint·Android JS export·W08 PASS. 이는 실제 Google client 발급·외부 시연 API·APK 실기를 증명하지 않는다.
- 기존 Lightsail의 `free -m`은 total 1906MiB·available 1257MiB, 디스크 53GiB 여유, 운영 Caddy/API/PostgreSQL healthy였다(읽기 전용 SSH). 신규 Lightsail 인스턴스·Paid Plan은 만들지 않았다.

## Issue #137 가상 점포 세 곳 확장

- 사용자 요청으로 시연 웹과 로컬 `_test` DB를 가상 점포 A·B·C 총 3곳으로 확장했다. A 방문을 가정한 웹 도감은 고정 예시이며 실제 앱 진행과 동기화되지 않는다. 기존 A점포만 있는 전용 DB에 B·C를 추가할 때 A의 진행 수치를 보존하도록 seed를 바꿨다. 운영 DB·API·공개 사이트·기존 GitHub APK는 변경하지 않는다.
- 검증: 시연 웹 19/19·실제 Chrome 테마 1/1, API 단위 87/87·PostgreSQL 43/43·typecheck PASS. 전용 테스트 DB의 반복 seed 3/3/9/3행, A 기존 진행 보존, 동시 생성·손상 거절과 loopback API의 가상 점포 A·B·C `demo=true` 응답 PASS. 127.0.0.1:4174 브라우저의 데스크톱 3열·390px 1열·가로 넘침 없음 확인. 외부 시연 웹·Android 시연 APK·전용 외부 인증 API는 아직 `NOT_RUN`; Issue #137은 OPEN 유지한다.

## Issue #137 운영 웹·두 Android 배포 경계

- 과거 브랜치 `feat/137-web-download-surfaces`에서 `apps/production-web`에 공개 음식점 전용 로컬 운영 웹을 추가했다. 같은 출처의 `GET /merchants`만 `https://api.masscom.kr/merchants`로 전달했고 응답은 `200 {"merchants":[]}`였다. 당시 개인 도감은 닫혀 있었으며, 현재 외부 웹 배포·웹 전용 세션의 미완료 상태는 이 문서 맨 위 최신 #137 항목을 따른다. 실제 점포 확보 실증은 `NOT_RUN`이다.
- [GitHub 다운로드 상태](ANDROID_DOWNLOADS.md): private test.2 운영 APK만 실제 asset으로 존재하며 현재 `main` 최신 UI 빌드가 아니다. 시연 APK는 외부 `demo-api.masscom.kr` DNS/인증·전용 DB와 실기 검증 전까지 없다. 기존 앱 링크·운영 API/DB·릴리스 파일은 변경하지 않았다.
- 새 운영 웹 회귀: `node --test tests/site/verify_production_web_test.mjs`; 저장소 포털 회귀: `bash tests/site/verify_project_site_test.sh`. PR·CI·병합 상태는 `gh pr list`와 `git log origin/main -1`로 확인한다. Issue #137은 계속 OPEN이다.

## Issue #137 로컬 가상 방문 수령 실기 (후속 증거)

- Samsung SM-S928N Android 16 개발 앱, `.env.local` 없는 격리 checkout과 loopback DEMO API/전용 `_test` DB로 STAFF 발급→고객 수동 코드 미리보기→방문 확정→도감→추천을 실제 기기에서 PASS. 도감은 방문 1/앱 수집품 1/실제 NFT 0, DB는 방문 1/보상권 1/mint job 0/`CLAIMED` 슬롯 1. 동일 코드 재확인도 추가 효과 0이었다. [증거](evidence/android-local-claim-2026-09-24/README.md).
- 앞선 USB 해제로 수령하지 못한 시도는 [별도 기록](evidence/android-dev-ui-2026-09-24/README.md)에 BLOCKED로 남긴다. 이번 PASS는 다른 포트·새 코드의 로컬 수동 입력이며 카메라 QR·외부 지갑·시연/운영 release APK·공개 HTTPS를 완료로 바꾸지 않는다. Issue #137 전체는 계속 OPEN이다.

## Issue #146 Android 내 정보 렌더 오류 (PR 준비)

- Samsung SM-S928N Android 16 개발 앱에서 `Link asChild` 아래 역할 시안 `Pressable`의 스타일 배열로 Expo Router 오류를 재현했다. 브랜치 `fix/146-account-link-style` 코드 `f177c0a`는 해당 스타일만 `StyleSheet.flatten`으로 단일 객체로 전달한다. 자동 182/182·typecheck·lint PASS, 동일 폰에서 내 정보·역할 시안·점주 화면 실제 진입 PASS. [증거](evidence/android-dev-ui-2026-09-24/README.md).
- 별도 `.env.local` 없는 격리 checkout과 loopback DEMO API/DB에서 수정 전 기준선의 탐색·방문 인증·빈 도감·가상 점포 상세·추천을 확인했다. 수정 후 코드의 내 정보·시안·점주 화면과 발급·미리보기는 별도 확인이다. 수령 확정 직전 USB 연결 해제로 DB 방문 0/보상권 0/슬롯 1(`ISSUED`)이므로 해당 경로는 BLOCKED. 운영 release·시연 APK·외부 지갑·QR 카메라 촬영은 NOT_RUN. PR·CI·병합 상태는 `gh pr list`와 `git log origin/main -1`로 확인한다.

## Issue #142 파란 UI 일관화 (PR #143)

- 작업 브랜치 `feat/142-design-consistency`; 시안 색상 정본은 `apps/mobile/src/theme/palette.ts`다. 운영 네 탭·보조/인증/지갑/점주 11개 화면은 라이트/다크 palette를 렌더 시점에 선택하고, 시연 웹은 같은 의미색 CSS 변수와 명시적 다크 media를 사용한다. 기능·라우트·API·지갑 요청·시연 웹 읽기 전용 경계는 유지한다.
- 자동 검증: 모바일 180/180, typecheck·lint·Android 개발 JS export, 시연 웹 19/19·정적 verifier·접근성, bootstrap·운영 문서·privacy·모바일 접근성 의미·W08 회귀 PASS. `MassCOM_Design_QA` Android 36 AVD에 개발 debug APK 설치·실행, 로그인 화면 라이트/다크·200% 확인 PASS. 로그인 후 네 탭, 실물 휴대전화, 시연 APK/외부 HTTPS는 NOT_RUN. [증거](evidence/design-consistency-2026-09-24/README.md).
- PR #143의 실제 CI·리뷰·병합 상태는 `gh pr view 143`으로 확인한다. Issue #137 별도 API/DB·OAuth/Reown·실기와 운영 웹 개인 도감은 별개이며 아직 남아 있다.

## Issue #137 시연 Android 빌드 경계 (병합, 후속 진행 중)

- 후속 브랜치 `feat/137-showcase-local-runtime`은 운영 Compose를 건드리지 않는 독립 `masscom-showcase-local` PostgreSQL/API를 준비했다. 로컬 127.0.0.1:55434 DB에 seed를 반복해 가상 점포 1곳 유지, 127.0.0.1:3301 공개 목록 1곳, `/collection`·`/auth/google` 503 인증 미설정, 세션·방문·mint 작업 0건, Compose down/up 후 자료 유지 PASS. 설정 변조 검사와 실제 Docker config PASS([증거](evidence/showcase-local-runtime-2026-09-24.json)). PR·CI·merge 상태는 `gh pr list`로 확인한다. 별도 시연 OAuth·초대·외부 HTTPS·실기 기능은 NOT_RUN.

- 브랜치 `feat/137-showcase-android-boundary`는 main `d257d0b`에서 시작했다. 계획 `d98b228`은 독립 Astra 검토 CLEAR, URL·variant 차단 `9e378d5`, 세 Android 정체성과 지갑 복귀 `2cf97c2`, 빈 URL 구분자 차단 `5c20215`를 완료했다. PR #141은 `b093fbd`로 main에 병합됐고 main CI `35889398325` PASS다.
- `showcase`는 `kr.masscom.wolgye.demo`/`masscom-demo`/`월계 마스코트 체험용`과 정확한 `https://demo-api.masscom.kr`만 허용한다. 운영은 `https://api.masscom.kr`만 허용한다. 개발 빌드의 API URL은 기존 규칙대로 HTTPS 또는 허용된 loopback HTTP가 가능하지만, 불안전한 DEMO 계정 헤더를 받는 API 서버 자체는 loopback 바인드로 제한한다. 시연 빌드가 기존 Google/Reown 공개 ID를 받으면 거절한다. 164개 모바일 단위·typecheck·lint·개발 Android JS export·W08 검사 도구 회귀는 PASS.
- 아직 없는 것으로 **확인된 것**은 외부 시연 API/DB의 인증·배포 연결, 시연 OAuth/Reown 프로젝트의 저장소 연결과 실제 시연 설치본 증거다. 로컬 전용 API·DB 검증과 구분하며, 외부 자원 자체의 존재 여부는 재확인 전 단정하지 않는다. Android 시연·운영 동시 설치, 실제 QR/지갑 복귀, 외부 HTTPS, 시연 AAB W08은 NOT_RUN. 운영 DB에는 가상 seed를 넣지 않는다.
- 후속 브랜치 `fix/137-demo-auth-boundary`에서 런타임의 개발 DEMO 인증 분류를 정확한 `.dev` package로 좁혔다. RED→GREEN 회귀, 모바일 181/181·typecheck·lint·W08·bootstrap은 로컬 PASS; PR·CI·병합은 `gh pr list`로 확인한다. 이로써 빌드 설정 거절과 런타임 권한 경계가 함께 적용되지만, 실제 시연 인증이 구현됐다는 뜻은 아니다.
- 다음: #137의 외부 시연 API 인증·전용 DB 연결, 운영 웹 읽기 전용 개인 도감, 외부 환경·실기 증거를 각각 진행한다. 새 유료 자원·DNS·공개 배포는 승인 경계를 확인한다.

## Issue #136 PR #138 수정 작업 (당시 기록)

- 사용자가 최근 PR 검토 뒤 참고할 부분을 가져와 수정하도록 요청했다. [PR #138 검토 답글](https://github.com/2026-KW-HACKATHON/27_MassCOM/pull/138#issuecomment-5796835197)을 남겼다. 기존 CI `35836456584`는 `navigation/route-boundary.tsx`의 비허용 Reown import 때문에 FAIL이었다.
- `main de6f168`을 `feat/mobile-ui-foundation`에 일반 merge로 반영했다(공유 이력 force push 없음). 역할 카드·선택적 지갑 문구·다섯 공간은 개발용 `foundation-preview`로 격리하고, 실제 앱은 기존 `탐색 / 방문 인증 / 도감 / 내 정보` 네 탭과 루트 인증·지갑 제공자 경계를 유지한다. 설정의 미리보기 진입점은 `__DEV__`에서만 표시한다.
- 수정본 로컬 모바일 단위 152/152, typecheck·lint·Android JS export와 release wallet surface 회귀 PASS. 새 UI 시안 Android 실기·TalkBack·200% 글꼴·실제 외부지갑 복귀는 아직 `NOT_RUN`. Android 16 에뮬레이터에서 개발 앱은 실행됐으나 인증 화면에서 미리보기까지 진입하지 못했다. [수정 범위와 최초 캡처 구분](evidence/mobile-ui-foundation/README.md).
- 현재 브랜치의 수정·PR CI·Android 실기 상태는 작업 완료 후 `git status -sb`, `gh pr checks 138`과 아래 검증 기록으로 다시 확인한다. 원래 시안의 브라우저 캡처를 수정본 실기 증거로 사용하지 않는다. Issue #136의 최초 “첫 화면 역할 선택” 수용 기준은 현재 운영 시작 화면에 적용되지 않으므로 PR의 자동 종료 문구를 제거하고 Issue는 별도 판단 전 OPEN으로 둔다.

## Issue #136 모바일 UI 기초 PR 작업 (최초 head의 과거 기록)

- 브랜치 `feat/mobile-ui-foundation`, 당시 기준 main `60d37a7`. 기존 checkout과 분리해 최신 원격 저장소를 clone했다. 최초 요청은 PR 작성까지만이었으나 이후 사용자가 검토·수정을 다시 요청했다.
- 첫 화면 역할 선택 → 사용자 선택적 외부지갑 안내 / 점주 DEMO → 콘텐츠 없는 5면 스와이프 UI. 기존 기능 탐색은 `/explore`로 보존한다. `DESIGN.md` 상단이 이번 UI 범위의 우선 기준이다.
- 공개 화면은 데이터 없는 index/open으로 제한하고 기존 기능은 인증 경계를 유지한다. root navigator는 인증 복원 중에도 유지하고, 보호 콘텐츠만 계정에 따라 remount한다. 외부지갑 연결·서명·세션 구현은 변경하지 않는다.
- 구현 commit `0917d8e`, [PR #138](https://github.com/2026-KW-HACKATHON/27_MassCOM/pull/138) OPEN·미병합. 모바일 153개 시험·typecheck·lint·Android export, bootstrap·운영 문서·접근성·비밀·개인정보 검사 PASS. [화면 및 검증 범위](evidence/mobile-ui-foundation/README.md). GitHub CI는 생성 직후 실행 중이며 실제 최신 상태를 PR에서 확인한다.
- 다음 명령: `gh pr checks 138 --repo 2026-KW-HACKATHON/27_MassCOM`. 새 Android UI 실기·TalkBack·실제 지갑 복귀는 NOT_RUN. 과거 Android 실기 PASS를 이번 UI 실기 증거로 재사용하지 않는다. 사용자 요청대로 병합하지 않는다.

## Issue #133 공식 서비스 출처·배포 체크포인트

- [Issue #133](https://github.com/2026-KW-HACKATHON/27_MassCOM/issues/133), [PR #134](https://github.com/2026-KW-HACKATHON/27_MassCOM/pull/134) merge `e9f5b58eef219a1e0a639d2605c2bb98744f4fa1`. PR CI `35809652307`와 main CI `35809960551` 전체 PASS, 독립 코드 리뷰 APPROVE. 실기 미완료로 Issue를 다시 열었다.
- MetaMask의 `github.com` 표시는 `apps/mobile/src/wallet/appkit.ts`의 메타데이터 URL에서 왔다. 이를 공식 포털 `https://masscom.kr`과 기존 포털 표식의 HTTPS 자산으로 바꿨다. `api.masscom.kr` 서버 SIWE 검증·Android native 복귀·지갑 메서드는 그대로다.
- README 첫 웹 진입점과 포털의 Android `/open` CTA, 공개 페이지 canonical URL을 정리했다. private GitHub 코드·PR·APK 링크는 대체하지 않는다. Vercel 연결 대상은 기존 `choijunhuks-projects/masscom-wolgye`로 읽기 확인했고 새 프로젝트·유료 자원은 만들지 않았다.
- 로컬 모바일 149/149·typecheck·lint·Android export, 포털·접근성·bootstrap·비밀 검사는 PASS. 기존 Vercel 프로젝트에 `dpl_5uoWV6TVcDFRsqviVxbbe2rPuLb4`를 운영 배포했고, 공개 SVG HTTPS 200·MIME `image/svg+xml`·소스와 SHA-256 일치, `/open` 200·홈 canonical/CTA 확인까지 PASS([증거](evidence/domain-wallet-origin-2026-09-23.json)).
- Samsung Android 16 개발 앱에서 새 Metro JS와 외부 지갑 화면을 열고 기존 WalletConnect 세션을 해제했다. MetaMask 8.11.0 재연결은 지갑 비밀번호 잠금 화면 때문에 `BLOCKED`; 앱은 `NOT_CONNECTED / UNVERIFIED`로 돌아왔다. 비밀번호·복구 문구는 수집·입력하지 않았다. 기존 test.2 release APK에는 이번 JS 메타데이터가 없다.
- 다음: 소유자가 기기에서 MetaMask를 직접 잠금 해제하면 개발 앱에서 다시 연결해 승인 화면의 `masscom.kr`·표식·앱 자동 복귀를 확인한다. 새 운영 APK 빌드·설치와 Play는 별도 `NOT_RUN`이며, 실제 완료 전 Issue #133을 닫지 않는다.

## Issue #129 병합·운영 배포 체크포인트

- 기준: [Issue #129](https://github.com/2026-KW-HACKATHON/27_MassCOM/issues/129)·[PR #130](https://github.com/2026-KW-HACKATHON/27_MassCOM/pull/130) merge `fcaa1c0c096408d15d064600047bccefd7896cb6`. PR CI `35772111371`과 main CI `35772682920` PASS. 현재 main·후속 PR은 `git status -sb`, `git log -1`, `gh pr list --state all`에서 확인한다. 이전 UI 작업을 반복하지 않는다.
- 탐색: 실제 공개 점포 목록에 한정한 검색·참여 가능 필터와 정직한 0건 화면을 구현했다. 새 마스코트/점포 자산은 추가하지 않았다.
- 보안: DEMO 외부 바인드 거부, Caddy 단일 원 클라이언트 IP를 명시적으로 신뢰하는 로그인 제한, Worker 이벤트/정식 블록 해시 일치, 오프라인 로그아웃의 서버 회수 실패 표시를 추가했다.
- 자동 검증: 모바일 148/148, API 82/82, Worker 47/47, 세 패키지 typecheck와 모바일 lint·Android export·Lightsail 배포 설정 회귀·Caddy 구문 검사 PASS. Samsung에서 실제 공개 점포 0건의 라이트·다크·상태표시줄을 확인하고 원래 라이트 모드로 복원했다. [화면 증거](evidence/android-discovery-2026-09-23.json). 검색·필터 실기·TalkBack·외부 2-IP 제한·Anvil 재구성 통합은 `NOT_RUN`; 운영 API·Caddy 배포와 HTTPS 확인은 아래 증거대로 PASS.
- 모델: 개인 Codex 기본은 GPT‑6 Sol medium, 탐색은 Luna low, 고위험 독립 리뷰는 Astra medium/high로 조정했다. `docs/AI_MODEL_ROUTING.md`가 팀 가이드다. 현재 실행 중인 대화의 모델은 소급 변경되지 않는다.
- PR #130의 첫 CI `35771836501`은 운영 문서 검사에 남은 과거 자동 시험 수(API 80·모바일 146) 때문에 실패했다. 새 기준 82/47/148과 변경 검출 회귀 시험으로 수정해 PR·main CI를 통과시켰다.
- [운영 배포 증거](evidence/lightsail-api-deployment-2026-09-23.json): 기존 Lightsail에 `fcaa1c0` API·Caddy를 배포하고 PostgreSQL/API healthy, Caddy running, 외부 HTTPS health 200·DEMO 헤더만 사용한 `/collection` 401을 확인했다. 이전 release `73e07c8cf1e3`와 이미지가 되돌리기 경로로 남아 있다. 새 유료 자원·키·메인넷 전송은 없다.
- 남은 것: 실제 공개 점포 검색·필터 조작·TalkBack·200% 글꼴, 외부 두 IP 로그인 제한, Worker 운영 배포·Anvil 재구성 통합, D02·B-017·Play/공개/제출. 오프라인 서버 세션 자동 재회수는 별도 보안 설계가 필요하다.

## 2026-09-23 모바일 UI 병합 완료

- Issue #126과 [PR #127](https://github.com/2026-KW-HACKATHON/27_MassCOM/pull/127)을 merge commit `4437607`로 main에 통합했다. PR 최종 CI `35762617508`과 main CI `35763199480`은 전체 PASS했다.
- 코드 커밋 `d874502`(네 탭), `28f5c45`(강조색), `59c6eae`(탐색), `6445a2d`(방문·도감·내 정보), `9c2daac`(48dp), `e03b24d`(Samsung 반응형·live dark·DEMO 경계)와 증거 commit `29d2dcf`가 merge 이력에 보존됐다.
- 모바일 `146/146 PASS`, typecheck·lint·Android export·bootstrap PASS. Android 36 16KB AVD용 arm64 개발 APK 97MB 빌드·설치/실행과 Samsung Android 16 네 탭 실기까지 PASS. 전체 로컬 secret scan은 Git-ignored 환경 파일 2개로 BLOCKED, 깨끗한 tracked archive scan은 PASS.
- Samsung에서 네 탭·빈 상태·360dp·200% 글씨·실시간 다크 모드·추천 뒤로 가기·`masscom-dev://collection`/`open`을 확인했다. 운영 계정의 DEMO 점주 링크, 200% 탭 잘림, live dark 불일치, Link asChild 런타임 오류를 재현 후 수정했다. TalkBack 앱 낭독·현재 코드 production App Link·완전한 D02는 `NOT_RUN`; `docs/evidence/android-ui-navigation-2026-09-23.json`을 본다.
- RQ-001의 로그인 없는 탐색과 현재 앱 루트 인증 게이트가 충돌하므로 PRD 상태를 `IN_PROGRESS`로 바로잡았다(B-017). 이번 UI PR에서 인증 모델을 바꾸지 않는다.
- 다음: UI를 다시 만들거나 새 PR로 분할하지 않는다. TalkBack 앱 낭독·현재 코드 production App Link·완전한 D02는 별도 `NOT_RUN`으로 유지하고 B-017 무로그인 탐색 정책을 결정하기 전 인증 모델을 바꾸지 않는다.

## 2026-09-23 모바일 UI 설계 단계 기록(과거 상태)

- 현재 작업: Issue #126, 브랜치 `feat/126-mobile-ui-navigation`, 기준 main `de1448f`.
- 사용자는 ‘따뜻한 동네 음식 탐험 + 마스코트 수집’ 및 B안 기본 이동(`탐색 / 방문 인증 / 도감 / 내 정보`)을 승인했다.
- 루트 `DESIGN.md`와 `docs/superpowers/specs/2026-09-23-mobile-ui-navigation-design.md`의 상세 설계를 사용자가 승인했다. 당시에는 `docs/superpowers/plans/2026-09-23-mobile-ui-navigation.md`의 구현 계획이 검토 대기였고 UI 코드가 없었다. 현재 상태는 맨 위 구현 체크포인트를 따른다.
- 두 번째 Google 계정은 연결된 Samsung 기기에 있고 운영 앱 로그인 및 서버 session 발급을 확인했다. 계정 이메일은 Git·문서에 기록하지 않는다. A↔B 데이터/지갑 분리와 콜드 복원까지 확인하지 않았으므로 D02는 `NOT_RUN` 유지한다.
- 이 항목은 설계 단계의 기록이다. 새 세션은 맨 위 구현 체크포인트와 실제 `git`/`gh` 상태를 우선한다.

이전 작업 기록 갱신 시각: 2026-09-22 22:03 KST
작업 브랜치: `feat/124-release-closeout`
연결 Issue: `#124 GitHub Android 설치와 남은 출시·시험망 검증을 마감한다`
기준 main 커밋 SHA: `83e1c29`. 현재 App Link APK 기준은 `0d93c49`, Base Sepolia proof 기준선은 main `83e1c29`다. 이후 상태는 `git status`, `git log`, `gh pr list`를 우선한다.

새 세션이나 다른 계정은 Phase 0을 반복하지 말고 아래 “다음 세션이 가장 먼저 해야 할 작업”부터 이어간다. 문서와 GitHub가 다르면 실제 commit·merge 기록을 따른다.

## 2026-09-22 중단 체크포인트 — 반복 금지

- AWS Free Plan의 `$100` 크레딧 범위에서 서울 리전 Lightsail `masscom-api-seoul`(Ubuntu 24.04, 2GB, 월 최대 `$12`)을 생성했다. Paid Plan 전환은 하지 않았다.
- 고정 IP `masscom-api-ip`(`43.200.56.97`)를 연결하고 Lightsail 방화벽에 HTTP 80·HTTPS 443을 추가했다. SSH 22는 배포 마감 전 임시로 열려 있다.
- 커밋 `73e07c8`을 `/opt/masscom/releases/73e07c8cf1e3`에 배포했다. PostgreSQL·API·Caddy가 healthy이고 `/opt/masscom/DEPLOYED_COMMIT`이 해당 전체 SHA를 가리킨다. PostgreSQL 5432와 API 3000은 인터넷에 publish하지 않았다.
- `A api 43.200.56.97 TTL 600`을 가비아에 저장하고 공용 DNS 전파를 확인했다. Caddy 재시작 뒤 Let’s Encrypt 인증서, `https://api.masscom.kr/health` HTTP/2 200·`{"status":"ok"}`·`no-store`·HSTS·nosniff·frame DENY를 확인했다.
- Vercel `masscom-wolgye` production deployment `dpl_6MrwqxM8cxwoV7jSvLBiPHJhYY3Z`가 READY다. 포털·법적 페이지·`/.well-known/assetlinks.json`·`/open`을 HTTPS로 확인했다.
- Google Cloud 새 프로젝트 `MassCOM`(`masscom-wolgye-2026`, project number `172380658768`)에 아래 OAuth client를 만들었다. 다시 만들지 않는다.
  - Web server: `172380658768-n5r2vad5f2g6ndb9kh2cbcig1j9i792g.apps.googleusercontent.com`
  - 개발 Android: `172380658768-4rpku6qkj265b7p1m55tduvegks5dv91.apps.googleusercontent.com`, `kr.masscom.wolgye.dev`, debug SHA-1 `0A:15:0F:D7:20:43:47:B3:D2:D1:E1:10:36:D9:89:4C:BD:A7:0D:C7`
  - 운영 직접 설치용 Android: `172380658768-kk7r7rnhvqr6799q4thcjfjkq3flasha.apps.googleusercontent.com`, `kr.masscom.wolgye`, upload SHA-1 `06:CB:25:F6:60:11:56:57:E7:8C:75:EF:DC:1E:75:43:A1:54:2A:7D`
- 잘못 사용하던 `dailycoding-492802` 프로젝트에서 MassCOM Web·개발 Android·운영 Android client 3개를 삭제했다. 기존 `DailyCoding` Web client는 보존했다. 삭제 항목은 Google에서 30일 내 복원 가능하지만 복원하지 않는다.
- `apps/mobile/.env.local`은 Git 비추적 상태로 새 Web client ID와 `https://api.masscom.kr`을 가리킨다.
- Google OAuth 테스트 사용자 1명을 등록했다. 기본 Credential Manager flow는 Samsung Android 16에서 622,528바이트 `TransactionTooLargeException`으로 시스템 selector가 종료됐다. 커밋 `e84a7a8`이 explicit Google button flow를 우선하도록 고쳤고 실제 동의→ID token→외부 API session, 콜드 스타트 SecureStore 복원, logout과 서버 revoke를 PASS했다. 두 번째 계정 전환은 `NOT_RUN`이다.
- 중단하면서 Metro·로컬 API를 종료하고 ADB reverse를 제거했으며 개발 앱을 force-stop했다. AWS와 Vercel 서비스만 계속 실행 중이다.

### 다음 실행의 정확한 재개 순서

1. private GitHub test.2 APK와 Samsung 4KB·Android 36 16KB AVD 설치/콜드 실행·HTTPS `/open` App Links를 완료해 A02 PASS다.
2. Base Sepolia 계약·role·cap 1 series·Worker service minter mint #1·재실행 무작업을 완료했다. 다시 배포·발행하지 않는다.
3. 두 번째로 승인된 Google 테스트 계정이 생길 때만 계정 전환 D02를 실기한다.
4. 현재 문서 갱신 커밋을 push한 후 한글 PR 하나로 CI·리뷰·merge한다. Google Play 제출·저장소 공개·대회 최종 제출은 실행하지 않는다.

## 이번 세션에서 완료한 것

- Issue #118: PR #119에서 release provenance·W08·privacy·서비스 민터 fail-closed 검사를 강화하고 merge `48aa435`, main CI `35606071753` PASS
- Issue #118: PR #120에서 모바일 Bearer/DEMO 인증 배타, SecureStore 부분 실패 복구, 로그아웃·계정 전환 직렬화, mint polling 단조성을 보강하고 merge `a50f678`, main CI `35620303554` PASS
- `docs/118-design-evidence`: 라이트·다크 의미색 대조, Reown 테마 동기화, TalkBack live region·QR 설명, 새 clone/PR 검사 문서, API·Worker 운영 경계, 포털·발표·증거 일관성 검사를 추가. 포털·발표 1440px/390px 시각 판정 96점, 가로 넘침 없음
- Issue #116: Reown 허용 목록의 개발 package 실기, MetaMask 연결→Base Sepolia→`personal_sign`→서버 `VERIFIED` 자동 복귀, 콜드 스타트에서 서버 binding 주소·체인 대조 복원, 미설치 SafePal 복귀를 Samsung SM-S928N에서 PASS. 수정 전에는 DB binding이 있어도 `UNVERIFIED`로 돌아가는 결함을 재현
- 저장소 밖 upload PKCS12 키의 권한 `0600`·별칭·공개 인증서 지문을 확인하고 SHA-256만 고정. commit `f13a283`의 upload-key AAB 서명·bundletool manifest·W08·provenance·16KB 정적 검사를 PASS
- Issue #110: Google `auth_time` 최근성, JWKS 최대 stale 24시간, `/auth/google` 검증 전 요청 제한, 만료·폐기 세션 bounded cleanup(migration 0013), Play 카메라·NFT award 초안 정합
- Issue #112: EIP-1559 priority fee 관계·signed sender 대조, raw-key 이름 변형, keystore 전체 상위 경로, lock timeout·pool 설정 보강
- PR #111 merge `205d273`, main CI `35561417735` PASS. PR #114 merge `595f70f`, 최종 PR CI `35563298914`·main CI `35563583964` PASS. PR #113은 GitHub가 CI run을 만들지 않아 동일 커밋으로 대체 후 종료
- Issue #59: 체인 cursor에서 `CHAIN_REORG_MARGIN`만큼 되돌아가 조회하고, 못 찾으면 배포 기준 블록까지 다시 조회. cursor 조회 실패는 `CHAIN_CURSOR_READ_FAILED` 재시도 오류. ethers 요청 cache 때문에 Anvil에서 간헐적으로 30초 대기하던 원인 제거
- Issue #61: Worker 재시도 지수 backoff(1초→최대 5분)와 전송 시도 5회 도달 시 `MANUAL_REVIEW`(`RETRY_LIMIT_EXCEEDED`) 전환. migration 없음
- Expo 57.0.24·expo-router 57.0.22·@expo/ui 57.0.19 patch 적용. 모바일 moderate 권고 14건은 upstream 수정이 없어 B-008 유지
- Issue #66: SIWE challenge를 PostgreSQL `wallet_challenges`(migration 0008)에 저장, 원자적 claim, 만료 정리. 보안 리뷰 지적 반영: binding 기록 뒤 nonce를 되돌리지 않아 서명 재사용 차단, 계정 삭제 transaction 안에서 challenge 제거
- Base Sepolia keystore 전용 배포 스크립트와 실체인 시뮬레이션 PASS(전송 없음). 계정 삭제가 접수되면 앱이 지갑 연결을 끊고 기기의 WalletConnect 세션 제거(D-021)
- 운영 package ID `kr.masscom.wolgye`(D-022)와 개발 variant 분리, `scripts/build-release-aab.sh`, 로컬 debug 서명 운영 AAB에서 package·scheme·overlay 권한 제거·16KB 정렬 48개 PASS
- Google Play Console 제출 초안 `docs/PLAY_CONSOLE_DRAFT.md`(입력·제출 없음)
- Issue #92: 백업·복원 drill 스크립트와 회귀 시험, `docs/DEVICE_TEST_PLAN.md`(실기 시험 절차), `docs/HOSTING_LOGIN_PROPOSAL.md`(외부 HTTPS·로그인 승인 요청 묶음, 자원 미생성)
- Issue #90: 스마트 지갑(계약 계정) 서명 3가지 형태가 `SIGNER_MISMATCH`로 거절되고 binding이 생기지 않으며 challenge가 재시도 가능함을 fixture로 고정, 앱 안내에 미지원 설명 추가. W05는 실기 환경이 없어 `BLOCKED` 유지(B-011)
- Issue #88: 배포 안내의 `cast wallet import`→`cast wallet new <이름>` 정정, 배포 스크립트 사전 검사(keystore 계정·chainId·역할 주소·기존 broadcast 기록 시 `--redeploy` 요구), 빌드 스크립트 산출물 출처 출력과 debug 서명 종료 코드 3, `android.injected.signing.*` 주입을 일회용 키로 확인. 실제 전송·upload key 서명은 하지 않음
- Issue #86: 로컬 production AAB를 `scripts/check-release-wallet-surface.sh`로 정적 검사해 W08 PASS. SDK는 `features.onramp` 미지정 시 온램프를 켜고 계정 화면의 송금 버튼에는 flag가 없으므로, 명시적 false와 “`open()`은 Connect view만·SDK 버튼 미렌더링”을 CI 회귀 시험으로 고정. upload key 서명본에서 같은 명령을 다시 실행해야 함
- Issue #84: 같은 주문 참조 아래 사람별 슬롯 독립성을 PostgreSQL로 실증해 Q04 PASS(스키마 변경 없음). 단체 최대 인원·1인 최소 금액·명단 고정은 v3 제안값이라 구현하지 않음. 발표 첫 화면의 오래된 집계(26/8)를 고치고 검증기가 그 위치도 검사하게 함
- Issue #78: 연속 재시도를 `mint_jobs.retry_streak`(migration 0010)에 기록해 지연을 최대 5분까지 늘림(수동 검토 전환에는 쓰지 않음). 전송 직후 중지로 revert된 거래는 일시 조건이면 hash를 지우고 재시도. reward key 조회 실패도 인터페이스 불일치와 장애를 구분
- Issue #80: 지갑 세션 저장을 계정별 tag로 분리하고 시작 시 다른 계정 세션을 제거, 점주·지갑 화면에 remount 보호 추가. API `no-store`는 이미 구현돼 있어 회귀 시험만 추가. D02는 실기 계정 전환을 못 해 `NOT_RUN` 유지
- Issue #77: RPC 연결 불가가 작업을 `MANUAL_REVIEW`로 보내던 분류를 `RPC_UNAVAILABLE` 재시도로 수정. 계약 중지 `MINT_PAUSED`, 민터 잔액 부족 `MINTER_BALANCE_LOW`는 전송 준비 직전에 확인해 전송 시도를 소모하지 않음. code는 있지만 인터페이스가 다른 계약은 재시도하지 않고 `CONTRACT_INTERFACE_MISMATCH`로 수동 검토. 필수 테스트 O02를 Local Anvil·PostgreSQL 증거로 `NOT_RUN`→`PASS` 전환
- Issue #75: 경로 값의 잘못된 percent-encoding을 8개 라우트 공통 helper로 400 `INVALID_PATH_PARAMETER` 처리(기존 500)
- Issue #73: `POST /campaigns/:id/enrollments` 캠페인 참여 등록과 정원 원자 예약(migration 0009). 필수 테스트 R02를 실제 PostgreSQL 동시성 증거로 `NOT_RUN`→`PASS` 전환. 같은 계정의 마지막 자리 경합에서 정원 마감으로 잘못 거절하던 빈틈을 결정적 재현 시험으로 확인해 수정
- Issue #71: README·앱별 README·`.env.example`·EVALUATION_MAP·SUBMISSION_EVIDENCE·TEST_STATUS·PROJECT_STATE·HANDOFF를 실제 병합 상태에 맞춤

## 생성한 Issue

- #110 운영 로그인 재인증·요청 제한·세션 정리 (종료)
- #112 서비스 민터 서명·키 파일·lock 설정 보강 (종료)
- #61 Worker 재시도 상한과 지수 backoff (종료)
- #66 SIWE challenge PostgreSQL 공유 저장소 (종료)
- #71 9월 20일 병합분 문서 정합 (종료)
- #73 캠페인 참여 등록과 정원 원자 예약 R02 (종료)
- #75 잘못된 경로 인코딩을 400으로 거절 (종료)
- #77 RPC·발행 중지·민터 잔액 장애 복구 O02 (종료)
- #80 계정 전환 시 이전 사용자 데이터 미노출 D02 (종료)
- #78 전송 전 장애의 재시도 간격과 전송 직후 중지 처리 개선 (이 문서를 담은 PR로 종료)
- #116 Phase 1 실제 MetaMask 복귀·서명과 출시 입력 상태 검증 (이 문서를 담은 PR로 종료)
- #65·#69·#70 작업은 Issue 없이 진행했다. 이후 작업은 Issue를 먼저 만든다.

## 생성한 브랜치

- `feat/59-chain-cursor-restart`, `feat/61-worker-retry-limit`, `chore/expo-patch-advisory-recheck`, `feat/66-siwe-challenge-postgres`, `docs/66-closeout`, `feat/base-sepolia-deploy-script`, `feat/release-package-id`, `docs/71-state-sync`, `feat/73-campaign-enrollment`, `fix/75-path-param-decoding`, `fix/77-worker-outage-recovery`, `fix/80-account-switch-isolation`, `fix/78-presubmit-backoff`, `test/116-device-wallet-release-inputs`, `fix/118-security-release-gates`, `feat/118-mobile-auth-recovery`, `docs/118-design-evidence`
- 남아 있는 원격 브랜치 `feat/59-chain-cursor-read`, `feat/61-worker-retry-cap`은 같은 내용을 새 브랜치로 대체한 뒤 닫은 PR #60·#62의 것이다. main에 병합되지 않았으며 삭제 여부는 소유자가 정한다.

## 생성한 PR

- #63, #64, #65, #67, #68, #69, #70, #72 #74, #76, #79, #81, #82, #83(PragmoB), #85, #87, #89, #91, #93, #96, #98, #99, #102, #104, #105(PragmoB), #107, #108, #109, #111, #114, #115, #117, #119, #120 (모두 병합)
- #60·#62는 #63·#64로 대체했고, #113은 CI run 미생성으로 #114로 대체해 닫았다.

## merge된 PR

| PR | merge 커밋 | main CI run |
| --- | --- | --- |
| #63 체인 cursor 재시작·reorg 여유 | `6bbf58c` | `35458855491` PASS |
| #64 Worker 재시도 상한·backoff | `695210c` | `35459019638` PASS |
| #65 Expo patch·B-008 재평가 | `4c4d744` | `35459313304` PASS |
| #67 SIWE PostgreSQL 저장소 | `9c3c04a` | `35460087002` PASS |
| #68 재개 기록 마감 | `f386c84` | `35460432649` PASS |
| #69 Base Sepolia 배포 스크립트·기기 세션 정리·Play 초안 | `a83cef9` | `35486460953` PASS |
| #70 운영 package ID·release AAB 경로 | `9e670ab` | `35487020999` PASS |
| #72 문서 정합 | `761ac42` | `35487858774` PASS |
| #74 캠페인 참여 등록·R02 | `b04af56` | PASS |
| #76 경로 인코딩 400 | `640bb83` | PASS |
| #79 Worker 장애 복구·O02 | `e4e633c` | `35499451454` PASS |
| #81 계정 전환 분리·D02 | `5aafafc` | PASS |
| #82 재시도 backoff·revert 재분류 | `e4d4edb` | `35504888279` PASS |
| #85 단체 슬롯 독립·Q04 | `367f26b` | `35505367620` PASS |
| #83 하단 safe-area 여백(PragmoB, 후속 수정 포함) | `6417b0c` | PASS |
| #87 운영 AAB 지갑 진입점·W08 | `a2a0452` | PASS |
| #89 배포·빌드 사전 검사 | `fe2be9a` | PASS |
| #91 W05 fixture·미지원 안내 | `f28737b` | 병합 뒤 main CI는 `gh run list --branch main`으로 확인 |
| #111 운영 로그인 후속 보안·Play 초안 | `205d273` | `35561417735` PASS |
| #114 서비스 민터 후속 보안 | `595f70f` | `35563583964` PASS |
| #115 운영 로그인·민터 후속 문서 마감 | `edf72a5` | `35564447379` PASS |
| #119 보안·출시 gate 보강 | `48aa435` | `35606071753` PASS |
| #120 모바일 인증·복구 보강 | `a50f678` | `35620303554` PASS |

코드 PR은 서로 다른 모델의 독립 리뷰에서 CRITICAL·HIGH 0을 확인한 뒤 병합했다. #63·#67·#69는 두 모델, #64·#65·#70은 단일 모델 리뷰(지적 반영 뒤 재리뷰)로 병합했다.

## 실행한 테스트

- API 단위 `80/80`, API PostgreSQL `37/37`(운영 로그인·claim replay·R02 7개·Q04 포함)
- Worker 단위 `45/45`, Worker PostgreSQL `23/23`, Anvil `12/12`(W07 M01~M08 + O02a~e)
- 모바일 `146/146`, typecheck·lint·Android export PASS; 실제 Google 첫 로그인·SecureStore 복원·logout revoke와 새 UI Samsung 실기 PASS
- Foundry `8/8`, fuzz 128, fmt·build·lint PASS
- Base Sepolia 계약 `0x1edca95bb453d8456cfe28c6e24c4e51172e36c4`, role·Worker token #1·중복 방지 PASS
- private GitHub APK, upload-key AAB gate, Samsung 4KB와 Android 36 16KB AVD 설치·cold launch PASS
- secret·privacy·bootstrap·portal·presentation verifier PASS
- 포털·발표 1440px/390px 브라우저 검증 PASS, 가로 넘침 없음, 시각 판정 각 96/100. 발표 timing·프로젝터 가독성·공개 호스팅은 NOT_RUN
- 필수 36개 `31 PASS / 2 BLOCKED / 3 NOT_RUN`. 남은 NOT_RUN: D02·O01·A01
- `NOT_RUN`: 운영 package 지갑 복귀, 두 Google 계정 전환, 운영 fresh reauthentication 삭제, Play Console

## 당시 열려 있던 PR

- 최종 상태는 `gh pr list`가 기준이다. PR #127은 병합됐고 이 문서 마감용 PR 외 새 기능 PR을 만들지 않는다.

## 당시 작업 중이던 기능

- Issue #124의 private GitHub test.2 APK·16KB runtime·verified App Links·Base Sepolia 계약/Worker mint와 Issue #126 모바일 UI를 완료했다. D02·O01·A01과 별도 출시/현장 항목이 남았다.

## BLOCKER

- B-002 저장소 공개 전환: 명시 승인 필요
- B-004 Google Play 정책·국내 분류 공식 확인
- B-008 모바일 moderate 권고 14건: Expo upstream 수정 대기
- B-010·B-011 W04·W05용 실제 지갑 환경 부재
- Base Sepolia 계약·Worker proof와 upload-key AAB·16KB runtime·App Links는 PASS. Play는 별도 `NOT_RUN`

## 사용자 승인이 필요한 사항

승인된 것(D-019~D-022): SIWE PostgreSQL 저장소, 외부 HTTPS·Base Sepolia·release AAB·Google Play 준비, 기기 세션 저장 정책, 운영 package ID. 소유자는 Codex와 Claude 세션을 번갈아 쓰므로 어느 쪽이든 이 문서와 저장소 기록에서 상태를 복원한다.

소유자가 직접 해야 하는 것(대신 수행하지 않음):

1. upload-key AAB·provenance·APK set 로컬 보존 상태를 확인한다. 비밀번호를 다시 입력하거나 키를 다시 만들 필요는 없다.
2. Base Sepolia 계약·series·token #1은 다시 배포·발행하지 않는다. 공개 주소·tx hash만 증거로 사용하고 private key·비밀번호는 기록하지 않는다.
3. Play Console에서 App Signing SHA-1을 받은 뒤 `kr.masscom.wolgye`용 Play Android OAuth client를 별도로 만든다. 현재 upload-key client를 Play signing client로 오인하지 않는다.
4. Play Console package 등록·Data safety·금융 기능 NFT award·계정 삭제 URL은 실제 제출 직전 다시 확인하고 승인 없이 제출하지 않는다.
5. 실제 카메라 QR 촬영→수령과 오프라인 안내(A01), 두 Google 계정 전환(D02), 운영 package Reown 복귀(E02)는 별도 실기한다. A02는 PASS다.

여전히 승인 전 금지: mainnet, 사용자 자산 이동, 저장소 공개, Play 프로덕션 공개, 대회 최종 제출.

## 다음 세션이 가장 먼저 해야 할 작업

1. `git fetch && git log origin/main -3`, `gh pr list`, `gh issue list`, `gh run list --branch main --limit 3`으로 이 문서와 실제 상태를 대조한다.
2. 소유자 입력이 도착했는지 확인한다. 도착 순서대로 처리한다.
   - **App Links**: 운영 `/open` intent filter와 upload 인증서 `assetlinks.json`을 배포하고 실제 Android 복귀를 확인한다. Play App Signing 인증서는 Play Console 생성 뒤 별도 추가한다
   - **Google OAuth client ID**: 제공된 ID의 client 유형을 확인하고 Android/Web 구성이 갖춰지면 모바일의 `x-account-id` DEMO 헤더를 Bearer 세션으로 교체하는 Issue를 연다(서버 측은 Issue #106으로 완료, D-024~D-026)
   - **A02**: APK 설치·4KB/16KB 실행은 PASS. HTTPS `/open` App Link 복귀만 마감한다
3. 입력이 없으면 새 기능을 시작하지 않는다. 자동화 가능한 운영 로그인·서비스 민터·문서/디자인 후속은 모두 병합 또는 최종 PR 검증 단계다. 서비스 민터의 다중 민터 지원은 실제 두 번째 민터 요구가 생기기 전에는 추가하지 않는다.
## 실행 명령

```bash
npm test --prefix apps/api
npm run test:postgres --prefix apps/api
npm test --prefix apps/worker
npm run test:postgres --prefix apps/worker
ANVIL_RPC_URL=http://127.0.0.1:8545 npm run test:anvil --prefix apps/worker
npm test --prefix apps/mobile
npm run typecheck --prefix apps/mobile
npm run lint --prefix apps/mobile
npm run export:android --prefix apps/mobile
./scripts/forge.sh test -vvv
bash scripts/check-secrets.sh
bash scripts/check-privacy.sh
bash tests/bootstrap/verify_bootstrap_test.sh
bash tests/site/verify_evidence_consistency_test.sh
PR_TITLE='한국어 PR 제목'
PR_BODY='변경 내용과 실제 검증 결과를 설명하는 한국어 본문'
bash scripts/check-pr-korean.sh "$PR_TITLE" "$PR_BODY"
bash tests/bootstrap/check_pr_korean_test.sh                     # checker 자체 회귀 시험
./scripts/deploy-base-sepolia.sh <keystore-account>            # 시뮬레이션만
./scripts/build-release-aab.sh --restore-dev                   # 운영 AAB 빌드 뒤 개발 프로젝트 복원
```

PostgreSQL 통합·Anvil 시험은 이름이 `_test`로 끝나는 전용 `TEST_DATABASE_URL`만 사용한다. 로컬 시험 DB는 Docker 컨테이너 `masscom-postgres-test`(포트 55432)다. Anvil 시험 전에 `./scripts/anvil.sh --chain-id 31337 --silent`를 실행한다.

## 주의사항

- Worker `start:once`는 Local Anvil unlocked account와 Base Sepolia encrypted keystore signer를 모두 지원한다. 공개 체인에서는 raw key나 unlocked account를 허용하지 않는다.
- 사용자 개인키·복구 문구·지갑 비밀번호를 요청하거나 저장하지 않는다. 배포자 private key를 환경 변수·명령·저장소·증거에 남기지 않는다.
- debug key로 서명한 AAB는 업로드하지 않는다.
- 앱 수집품과 실제 NFT를 분리하고, NFT 수를 매출 증가로 표현하지 않는다. 실행하지 않은 검증을 PASS로 쓰지 않는다.
- PR 제목·본문은 한국어로 쓰고 `bash scripts/check-pr-korean.sh`를 통과시킨다. 커밋과 PR에 AI 공동 작성자 trailer나 생성 도구 문구를 넣지 않는다.
- 공유 이력 force push, 날짜·작성자 조작, 빈 커밋을 하지 않는다. 브랜치를 바꿔야 하면 새 브랜치와 새 PR로 대체한다.
- ethers v6는 `eth_call`에 대한 모든 JSON-RPC 오류(rate limit·timeout 포함)를 `CALL_EXCEPTION`으로 표시한다. 실제 revert는 반환 `data`가 있을 때만이다. 오류 코드만으로 영구 결함을 판정하지 않는다.
- 위임한 구현이 경합 시험에 `t.skip` 대체 경로를 넣은 적이 있다. 재현되지 않으면 실패해야 하므로 skip을 실패로 바꾸고 반복 실행으로 결정성을 확인한다. 병합 전 `git grep -n "\.skip("`로 확인한다.
- 이 저장소의 shell은 zsh다. `grep --include=*.ts`처럼 따옴표 없는 glob은 오류로 끝나 검색이 실행되지 않는다. 코드 검색은 `git grep`을 쓴다.
- macOS 기본 `awk`에는 `strtonum`이 없고 `keytool` 출력은 한국어로 번역된다. 검사 스크립트는 오류 없이 끝났는지까지 확인한다.
- 지갑 세션의 계정별 분리는 “한 프로세스 안에서 계정이 바뀌지 않는다”는 전제에 선다. WalletConnect Core는 저장소를 프로세스 전역 core에 cache하므로, 운영 로그인으로 실행 중 계정을 바꾸게 되면 AppKit을 계정별 `customStoragePrefix`로 다시 만들거나 앱을 재시작해야 한다(PR #81 리뷰 지적).
- 운영 로그인을 도입해 account ID를 외부에서 정할 수 있게 되면, 계정 삭제의 `campaign_enrollments` 비식별화가 `(campaign_id, 삭제 별칭)` 중복으로 막히지 않는지 먼저 확인한다(PR #74 리뷰 지적).
- npm audit endpoint가 점검 중이면 CI의 audit 단계가 503으로 실패한다. 단계를 우회하지 말고 복구 뒤 다시 실행한다.
