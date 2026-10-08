# 제출 전 체크리스트

이 문서는 준비용입니다. 제출 버전 고정·최종 제출은 사용자 승인 전 실행하지 않습니다.

2026-10-09 KST 현재 운영 API·웹, 시연 API, `/play/` 번들의 소스는 `dbcc4403`입니다. 두 DB는 migration 76건(마지막 `0077_ai_art_account_limits.sql`)이며 운영 test.14와 시연 Preview 24 APK가 공개 사전 릴리스로 게시됐습니다([운영 증거](evidence/operating-android-test14-2026-10-09.json), [시연 증거](evidence/showcase-preview24-release-2026-10-09.json)). 공개 `/open` 링크는 이 문서 커밋의 웹 전용 재배포 뒤 확인해야 합니다. 새 APK의 실제 설치·로그인·QR·지갑·지도 수용과 최종 제출은 아직 수행하지 않았습니다.

## 제출 후보 묶음 (2026-10-09 기록, 최종 아님)

아래는 현재 공개 상태를 모은 후보입니다. 제출 버전 고정과 최종 제출은 승인 뒤에 합니다.

| 항목 | 값 | 비고 |
| --- | --- | --- |
| 제출 기준선 | 마감 시점의 최신 `main` | 현재 소스 기준 `dbcc44037264344dc79c92766bc2681fb5386837`은 main `ff6d7d71`과 트리가 같습니다. 제출 SHA는 최종 승인 뒤 `docs/SUBMISSION_EVIDENCE.json`에 기록합니다 |
| main CI | 최종 제출 전 재확인 | `gh run list --branch main --workflow CI --limit 1`로 제출 SHA의 결과를 확인합니다 |
| 공개 URL | [설치 링크 선택](https://www.masscom.kr/open) · [로그인 없는 시연 체험](https://demo-api.masscom.kr/play/) · [운영 웹](https://www.masscom.kr/app/) | API·웹·`/play/` 소스 `dbcc4403`. 공개 `/open`의 test.14·Preview 24 링크는 문서 웹 재배포 후 확인 필요 |
| 운영 설치본 | 태그 `android-v0.1.0-test.14`, `MassCOM-operating-android-dbcc440.apk`, SHA-256 `2a2e852b925985f6ad3aa9f69fe6724be4e1085b2a421de011e2193ef3305a87` | 소스 `dbcc4403`. GitHub asset digest 일치·서명·내장 설정 PASS, 익명 재다운로드·실기 `NOT_RUN` |
| 시연 설치본 | 태그 `showcase-android-v0.1.0-preview.24`, `MassCOM-showcase-android-dbcc440.apk`, SHA-256 `3e104f883203fa25ec66f1acb3246996759b1a279af8952bd83457844704b93b` | 소스 `dbcc4403`. GitHub asset digest 일치·서명·내장 설정 PASS, 익명 재다운로드·실기 `NOT_RUN` |
| 대체 시연 영상 | [demo-flow-390.webm](evidence/submission-2026-10-08-recheck/demo-flow-390.webm), 10,053,739바이트, 4분 8초, 390×844, SHA-256 `d05301abb9857a9f330d4fa440f323228851109f14417781df95719d29a095ae` | **이전 `/play/`(소스 `9f5ebfa6`)의 15단계 녹화이며 새 번들 `dbcc4403` 기준이 아님.** 설치본 실기 영상 아님 |

설치본·`/play/`는 소스 `dbcc4403` 기준입니다. 대체 시연 영상은 이전 `9f5ebfa6` 기준이므로 새 화면의 증거로 사용하지 않습니다. 최종 제출 전 새 번들로 시연을 다시 확인합니다.

## 코드·저장소

- [ ] 제출 commit SHA를 main CI 성공 run과 함께 기록
- [x] 2026-09-27 조직 저장소 PUBLIC 전환 완료([D-010](DECISIONS.md)); 심사 시 접근 가능 여부는 제출 직전 재확인
- [ ] 비밀·개인정보·대용량 불필요 파일 검사
- [ ] 모든 팀원이 핵심 흐름·AI 사용·한계를 설명할 수 있는지 확인
- [ ] 오픈소스 라이선스·출처 최종 확인

## Android·서버

- [x] 운영 package ID·versionCode 결정
- [x] upload-key 서명 AAB 자동 gate·공개 인증서 핀·16KB 정적/runtime 검사
- [x] A02 4KB/16KB 설치·HTTPS App Links 실기
- [ ] upload key 안전 백업과 Play App Signing 등록
- [x] 외부 HTTPS·첫 운영 로그인·외부 삭제 URL
- [ ] 심사 계정·DEMO 점포·안전한 QR·테스트넷 표기
- [ ] Data safety·금융 기능·등급·타깃 연령 Console 응답

## 발표·현장

- [ ] 3분·5분 리허설 시간 기록(수정본 공개 체험 15단계 기능 PASS와 자동 녹화 4분 8초 기록은 있으나 사람의 발표 리허설 시간 기록은 별도)
- [ ] 실제 시연과 사전 저장 증거를 구분
- [ ] 현장 참여 동의와 빈 결과지 사용
- [ ] 존재하지 않는 협약·매출·테스터·승인 삭제
- [ ] 장애 대체안이 같은 commit 기준인지 확인

## 버전 고정 절차

대회 제출용 `release/*` 또는 최종 태그는 별도 승인 후에만 만들고, 대상 SHA의 전체 CI와 Android/외부 환경 증거를 다시 확인합니다. 제출 SHA는 마감 시점의 최신 `main`이며, 확정한 SHA와 CI run은 위 표와 `docs/SUBMISSION_EVIDENCE.json`의 `baselineCommit`에 기록합니다. 태그 이름·제출 파일 hash·발표 자료 버전·영상 버전을 같은 manifest에 기록합니다. 기존 private Android 테스트 태그와 [정적 시연 웹 전용 미리보기 태그](https://github.com/2026-KW-HACKATHON/27_MassCOM/releases/tag/showcase-web-v0.1.0-preview.1)는 **최종 제출 태그가 아니며**, 시연 Android APK도 포함하지 않습니다.
