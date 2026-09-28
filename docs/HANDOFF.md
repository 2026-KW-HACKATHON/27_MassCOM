# HANDOFF

마지막 갱신 시각: 2026-09-28 KST

## 2026-09-28 개인 비공개 저장소의 최신 작업

- **최신 개인 통합·시연 배포:** [Issue #1](https://github.com/choijunhuk/MassCOM/issues/1)의 [PR #2](https://github.com/choijunhuk/MassCOM/pull/2)를 `main` merge `6585614`로 병합했고 PR CI `36370159651`·병합 후 main CI `36370675407`이 PASS했다. 첫 CI `36369704684`는 README 문구 시험이 낡아 FAIL했으며 21/21 RED→GREEN 수정 뒤 재검사했다. [Preview 4 APK](https://github.com/choijunhuk/MassCOM/releases/tag/showcase-android-v0.1.0-preview.4)는 같은 커밋의 전용 서명·원격 SHA-256 확인까지 완료했고, 별도 Lightsail 시연 API만 이미지 `6585614`로 교체·migration 0019 적용했다([증거](evidence/showcase-customer-qr-deployment-2026-09-28.json)). 백업 custom archive 목록 PASS, 시연 DB 가상 점포/방문/보상권 3/3/2 불변, 운영 가상 점포 0·운영 컨테이너 불변, 두 API와 www HTTPS 200. **휴대전화가 adb에 없어 새 APK 설치·2분 고객 식별 QR 실기는 `NOT_RUN`**. 구 Preview 3 STAFF 발급은 새 API와 호환되지 않으므로 직원 실기는 Preview 4로 수행한다. Issue #1은 실기까지 열어 둔다.
- **운영 관리자 첫 구간 구현:** 개인 [Issue #3](https://github.com/choijunhuk/MassCOM/issues/3)의 `feat/admin-foundation`에서 별도 서버 권한·부여/회수 및 점포 변경 감사 거래·비공개 점포 생성/수정/숨김 및 `/admin/`·Caddy 경로를 구현했다. 유효한 미수령 QR이 있으면 숨김 409, 숨김 뒤 신규/재발급 거부, 응답 유실 재조회 유지의 실제 DB 경합 시험을 통과했다. 권한 없는 웹 계정은 Google 계정 선택·전환할 수 있다. 사용자는 기존 시연 STAFF 주 Google 계정 1명을 운영 관리자 대상으로 지정했고, 운영 DB의 기존 Google 신원 4개 중 그 STAFF 신원과 일치하는 것은 **정확히 1개**임을 원문 출력 없이 확인했다. 실제 권한 부여·운영 HTTPS 배포는 **미실행**이며 PR/main CI·운영 DB 백업 뒤 진행한다. 직원·캠페인·그림·상태 관리는 Issue #3 후속이다. 운영 Android는 고객 전용, 시연 가상 자료는 운영 DB로 옮기지 않는다.

## 2026-09-28 보관된 조직 저장소와 개인 비공개 저장소 — 당시 기록

- **진행 중 통합 PR:** 개인 [Issue #1](https://github.com/choijunhuk/MassCOM/issues/1)의 `feat/customer-first-loop`를 [PR #2](https://github.com/choijunhuk/MassCOM/pull/2)로 열었다. QR 소스·도감 다음 목표·이전 시연 카메라 증거를 merge commit `698af5b`·`8c6feb3`으로 결합했고 로컬 API 109/109·모바일 239/239·PostgreSQL 16 전용 `_test` 52 PASS/2 SKIP·타입·린트·API build·Android export·문서 검사 PASS. 첫 PR CI `36369704684`는 README의 오래된 문구 assertion으로 FAIL했고 로컬 RED→GREEN 21/21 수정은 원격 재검증 전이다. 병합·새 APK/API 배포와 새 고객 식별 QR 실기는 `NOT_RUN`. Play 목표는 [D-040](DECISIONS.md)대로 유지하되 제출하지 않는다.

- **실제 시연 카메라 QR 결과:** [Preview 3 Samsung 실측](evidence/showcase-preview3-camera-claim-2026-09-28.json)은 같은 Google 계정의 시연 STAFF·고객 역할 전환으로 점주 발급 QR을 Mac에 표시하고 휴대전화 카메라로 촬영→미리보기→수령 확정→도감 가상 점포 A 방문 1회를 확인했다. 시연 DB 슬롯 1(`CLAIMED`)·유효 방문 1·보상권 1·mint 0, 운영 가상 점포 0. 앞선 다른 계정용 QR 거절은 슬롯이 미사용·미만료였고 계정 불일치가 원인이다. 코드·계정 ID·이메일·세션은 증거에 없다. 두 계정·두 휴대전화, 새 2분 고객 식별 QR 브랜치, 오프라인/권한 거부는 `NOT_RUN`; A01 전체 상태는 유지한다.

- **원격 상태:** `2026-KW-HACKATHON/27_MassCOM`은 `PUBLIC`·`Archived`다. 사용자는 보관 해제 대신 개인 GitHub를 선택했다. [개인 `choijunhuk/MassCOM`](https://github.com/choijunhuk/MassCOM)을 `PRIVATE`로 생성하고 기존 Git 커밋 이력을 보존한 `main`(`9706e61`)을 push했다. 원격 이름 `personal`이며 기존 조직 `origin`은 보존하되 더 이상 push·merge하지 않는다. 개인 저장소의 default branch는 `main`, 보관 상태는 false로 확인했다.
- **마지막 조직 통합 기준선:** [PR #204](https://github.com/2026-KW-HACKATHON/27_MassCOM/pull/204) merge `9706e61`, PR/main CI PASS. 비로그인 공개 점포 탐색과 개인 화면 로그인 안내의 **소스**만 통합됐고 공개 운영 test.3·시연 Preview 3 APK는 이전 코드다. Issue #202의 새 APK 로그인 복귀·두 계정 격리는 `NOT_RUN`으로 유지한다.
- **보관으로 중단된 PR:** [PR #207](https://github.com/2026-KW-HACKATHON/27_MassCOM/pull/207)은 도감 다음 목표 소스 브랜치 `feat/205-collection-next-goal`의 HEAD `dd769ae`다. 로컬 모바일 230/230·타입·린트·Android export PASS, 독립 리뷰 CLEAR. GitHub CI run `36353558484`는 Android 단계 도중 **`repository archived`로 CANCELLED**됐으므로 PR은 OPEN·미병합이고 CI PASS로 표시하지 않는다. 조직 설정을 우회하지 않는다.
- **개인 작업 브랜치:** `feat/205-collection-next-goal` `dd769ae`, `feat/203-customer-identity-qr` `90fa019`, `feat/194-verified-deletion-intake` `d051ef3`, `docs/personal-handoff-archive` `6932649`를 모두 `personal`에 push하고 원격 SHA를 일치 확인했다. QR은 API 109/109·PostgreSQL 16 전용 `_test` migration 후 52 PASS/2 SKIP·모바일 231/231·타입·린트·build/export PASS, 리뷰 HIGH 2·MEDIUM 2 수정 후 재검토. 처음 PostgreSQL 테스트는 migration 선행 누락으로 FAIL했고 같은 코드로 PASS했다. 도감은 모바일 230/230·타입·린트·export 및 독립 리뷰 CLEAR. 새 APK·외부 API 배포·실제 QR 촬영은 `NOT_RUN`; **구 Preview 3 STAFF 발급과 새 API는 호환되지 않으므로 서버만 먼저 배포하지 않는다.**
- **삭제 접수 소스 구간:** `feat/account-deletion-request-web`는 이전 `feat/194-verified-deletion-intake`의 내부 접수 코드·migration 0018을 관리자 기반 위에 통합하고 운영 웹 `/account-deletion`의 고정 Google 복귀, 접수 UI, 정확한 Caddy `/api/web/account-deletion-intake` 경로를 연결했다. 로컬 API 114/114·PostgreSQL 62 PASS/호스트 전용 2 SKIP(0019–0022 선적용 뒤 0018/0023 upgrade 회귀 포함)·웹 접수 3/3·Caddy 2/2·타입/build·Caddy 구성·포털·빠른 gate PASS. 개인 main 병합·운영 배포·실계정 접수·운영자 본인 확인/처리/결과 통지는 **미실행**이다. 웹 접수는 실제 삭제를 수행하지 않으며 [Issue #194](https://github.com/2026-KW-HACKATHON/27_MassCOM/issues/194)는 OPEN/BLOCKED; 기존 `auth_time` 5분 기준을 완화하지 않는다.
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
bash tests/site/verify_presentation_test.sh
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
