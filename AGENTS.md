# MassCOM 저장소 작업 지침

## 근거 우선순위

1. 최신 사용자 결정과 승인 기록
2. 대회 운영진의 적용 가능한 공지
3. `docs/PRD.md`, `docs/DECISIONS.md`, 실제 Issue·PR
4. 최신 v3 실행계획의 제안
5. 실제 코드와 실행 결과는 구현·검증 상태의 유일한 근거

문서 제안을 승인으로 바꾸지 않는다. 충돌은 관련 범위만 `docs/DECISIONS.md`와 `docs/BLOCKERS.md`에 기록한다.

## 자율 작업과 승인 경계

승인된 범위의 브랜치, 코드, 테스트, 문서, 커밋, push, PR, 필수 검사 후 merge는 자율 실행한다. 다음은 실행 전 승인이 필요하다.

- 핵심 기능 삭제·축소, 보상·양도 규칙 변경
- 큰 스택·체인·인증·보안 모델 변경
- 유료 서비스·과금 자원·예산 초과
- 공개 전환·소유권·권한·보호 규칙 변경
- 운영 키 생성·메인넷 배포·사용자 자산 이동
- Google Play 배포·일반 공개·대회 최종 제출

## 보안 불변조건

- 사용자 개인키·복구 문구를 요구하거나 저장하지 않는다.
- 주소 확인용 읽을 수 있는 메시지 서명만 요청한다.
- 송금·`approve`·`permit`·스왑·구매·내장 지갑 기능을 추가하지 않는다.
- 지갑 연결과 주소 통제 확인을 별도로 검증한다.
- 발행 요청의 수령인과 연결 버전을 고정하고 재시도로 중복 발행하지 않는다.
- 개인정보·주문번호·정확한 식사 시각을 온체인/IPFS에 기록하지 않는다.

## Git·검증

- 기능은 Issue와 수용 기준을 만들고 목적별 브랜치와 PR로 통합한다.
- PR 제목·본문·검증 요약은 한국어를 기본으로 작성한다. 코드 식별자·파일명·표준명·고유 기술명만 필요한 범위에서 영어를 사용한다.
- PR을 열기 전에 `bash tests/bootstrap/check_pr_korean_test.sh`로 한국어 작성 규칙을 검증한다.
- 공유 이력의 force push, 날짜·작성자 조작, 빈 커밋, 가짜 리뷰·테스트를 금지한다.
- 커밋은 의도 중심 제목과 필요한 Lore trailer를 사용한다.
- Issue·PR·리뷰 대응·커밋 설명·진행 문서는 한국어로 쓴다. README에 영향이 있으면 같은 PR에서 고치고, 없으면 PR에 이유를 적는다.
- 세션을 시작하면 이전 대화 기억이 아니라 `docs/HANDOFF.md`·`docs/PROJECT_STATE.md`·`docs/DECISIONS.md`·`docs/TEST_STATUS.md`와 `git`/`gh` 실제 상태에서 복원한다. 완료된 bootstrap·기능·계약을 다시 만들지 않고 `reset --hard`·`git clean`으로 남의 작업을 지우지 않는다.
- 서명·배포 키(Foundry keystore, Android upload keystore)는 에이전트가 만들거나 다시 만들거나 덮어쓰지 않는다. 존재 여부만 확인하고 비밀번호·개인키·복구 구문을 대화·로그·Git·인수인계 문서에 남기지 않는다.
- 빌드 성공, 서명 확인, 설치 확인, Play 업로드, 심사 승인은 서로 다른 상태로 기록한다.
- 현재 부트스트랩 검증: `bash tests/bootstrap/verify_bootstrap_test.sh`
- 현재 비밀 검사: `bash tests/bootstrap/check_secrets_test.sh`
- 현재 프로젝트 포털 검사: `bash tests/site/verify_project_site_test.sh`
- 현재 포털 접근성 검사: `bash tests/site/check_site_accessibility_test.sh`
- Phase 1 API 검사: `npm test --prefix apps/api`, `npm run typecheck --prefix apps/api`, `npm run build --prefix apps/api`
- Phase 1 Android 검사: `npm test --prefix apps/mobile`, `npm run typecheck --prefix apps/mobile`, `npm run lint --prefix apps/mobile`, `npm run export:android --prefix apps/mobile`
- v3 19절 ID를 바꾸거나 재번호화하지 않는다.
- 결과는 `PASS / FAIL / BLOCKED / NOT_RUN`과 명령·커밋·환경·재현법으로 남긴다.
- 같은 환경 원인이 두 번 반복되면 로그와 최소 재현을 남기고 BLOCKER로 분리한다.

세션 중단 전 `docs/HANDOFF.md`를 실제 브랜치·커밋·PR·다음 명령에 맞게 갱신한다.
