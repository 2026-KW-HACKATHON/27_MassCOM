## Issue #412 T4 A 사이트 브라우저 검사 환경 (2026-10-08)

`BLOCKED`: Codex App의 이 worktree sandbox에서 `node --test tests/site/verify_showcase_theme_test.mjs`가 Chrome 시작 직후 `exit=null signal=SIGABRT`로 두 번 실패했다. 제품 assertion에 이르기 전 `DevToolsActivePort` 생성 실패다. 최소 재현은 위 한 파일 실행이다. 전체 사이트 566건 중 565 PASS/1 FAIL이며 관련 관리자 168/168은 PASS다. 로그는 `/private/tmp/t4-courses-site.log`, `/private/tmp/t4-courses-theme-retry.log`다(비밀값 없음). Chrome이 시작되는 CI/호스트에서 해당 시험을 실행하면 해소 여부를 판정할 수 있다. 제품 기대값과 브라우저 검사 자체는 바꾸지 않았다.
## 2026-10-09 PR #418 리뷰 수정 검증 제한

- `BLOCKED`(현재 restricted macOS 환경): `node --test tests/site/verify_showcase_theme_test.mjs`는 Chrome이 DevTools 파일을 만들기 전에 `exit=null signal=SIGABRT`로 종료한다. 전체 사이트 시험과 단독 재실행에서 같은 환경 현상을 두 번 확인했다. 최소 재현은 위 단독 명령이며 로그는 `/private/tmp/pr418-site.log`·`/private/tmp/pr418-chrome-retry.log`다. 라이트·다크 계산 색/대비 assertion은 삭제하거나 건너뛰지 않았다. Chrome 기동이 가능한 환경에서 원래 명령을 다시 실행한다.
- `BLOCKED`(미커밋 HEAD 검사의 한계): `bash scripts/check-large-files.sh origin/main`과 `bash tools/gate.sh`는 작업 트리에서 삭제한 v1 PNG 24장을 아직 남아 있는 HEAD blob으로 검사해 실패한다. 현재 작업 트리에는 두 v1 디렉터리가 없으며 24개 예외도 삭제했다. staging·commit 금지 지시를 지키기 위해 임의 커밋이나 가드 우회를 하지 않았다. 오케스트레이터가 삭제를 커밋한 뒤 두 명령을 다시 실행한다. 로그는 `/private/tmp/pr418-large-files.log`·`/private/tmp/pr418-gate.log`다.


## 2026-10-09 T9 로컬 Chrome 테마 검사

`BLOCKED`: `node --test tests/site/*.test.mjs tests/site/*_test.mjs`의 Chrome 테마 시험만 두 번 `exit=null signal=SIGABRT`로 끝났다. 나머지 요청 시험은 최종 644/644 PASS이며 Chrome은 DevTools 파일을 만들기 전 종료해 색·대비 제품 assertion에 도달하지 못했다. socket/HTTP listen 실패가 아니다. 최소 재현: `node --test tests/site/verify_showcase_theme_test.mjs`. 로그 `/private/tmp/t9-site.log`, `/private/tmp/t9-site-final.log`. 기존 assertion·threshold·실행 조건을 바꾸거나 skip하지 않았다. Chrome을 실행할 수 있는 환경에서 같은 명령으로 검증한다.
