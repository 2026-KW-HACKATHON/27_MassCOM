# 제출 전 체크리스트

이 문서는 준비용입니다. 제출 버전 고정·최종 제출은 사용자 승인 전 실행하지 않습니다.

2026-10-08 KST 현재 운영 API·웹은 main `08f125b4`(PR #405 병합)로 배포됐고 시연 API는 `2d483ed`입니다. Issue #407의 앱 수정 코드 `5ca98955`(main `6ce8ad03` 위)로 운영 test.13·시연 Preview 22를 게시했고 시연 `/play/`도 소스 `5ca98955`로 전환했습니다([운영 test.13](evidence/operating-android-test13-2026-10-08.json), [시연 Preview 22](evidence/showcase-preview22-release-2026-10-08.json), [시연 배포](evidence/showcase-deployment-2d483ed-2026-10-08.json), [`09dfceb0` 운영 배포](evidence/production-deployment-09dfceb-2026-10-08.json)). 라이브 `/open`의 test.13·Preview 22 링크는 이 PR 병합 커밋의 운영 웹 재배포로 나가며 그 전에는 test.12·Preview 21을 가리킵니다. 두 APK의 익명 다운로드 해시는 일치(PASS, 2026-10-08 공개 Release에서 로그인 없이 다시 내려받아 SHA-256 재계산)입니다. 직전 수정본 `/play/`(`9f5ebfa6`)의 [재측정](evidence/submission-2026-10-08-recheck/README.md)에서는 이전 [17단계 실측](evidence/submission-2026-10-08/README.md)의 결함 4건이 모두 FIXED였고 5분 시연 15단계가 PASS였습니다. 그때 새로 본 낮은 결함 4건과 PR #402(상점 동의 오류 단추·문구)는 `5ca98955`에 담겼고, 새 `/play/` 번들의 공개 측정은 [측정 기록](evidence/next-build-2026-10-08/README.md)을 따릅니다. **최종 제출은 소유자 승인이 필요합니다.**

## 제출 후보 묶음 (2026-10-08 기록, 최종 아님)

아래는 현재 공개 상태를 모은 후보입니다. 제출 버전 고정과 최종 제출은 승인 뒤에 합니다.

| 항목 | 값 | 비고 |
| --- | --- | --- |
| 소스 main SHA | `6ce8ad037722e8d12ce914164450a6a7ff93382e`(PR #406 병합) + 이 PR(Issue #407, 앱 코드 커밋 `5ca98955e7ae26aea1a54d8a19b47eeae6bce2ea`) | 후보 SHA이며 제출 SHA는 승인 뒤 고정. PR #402는 `a742e32d`로 이미 main에 병합 |
| main CI | 이전 기록: 공개 빌드 기준 `08f125b4` run [37665168550](https://github.com/2026-KW-HACKATHON/27_MassCOM/actions/runs/37665168550) SUCCESS, `a742e32d` run [37669929449](https://github.com/2026-KW-HACKATHON/27_MassCOM/actions/runs/37669929449) | `6ce8ad03`과 이 PR 병합 커밋의 run은 이 문서 작성 시 확인하지 않았음. 제출 직전에 후보 SHA의 run 결과를 다시 확인 |
| 공개 URL | [설치 링크 선택](https://www.masscom.kr/open) · [로그인 없는 시연 체험](https://demo-api.masscom.kr/play/) · [체험 도감 미리보기](https://www.masscom.kr/preview/) · [운영 웹](https://www.masscom.kr/app/) | 운영 API·웹 main `08f125b4`, 시연 API `2d483ed`, `/play/` 소스 `5ca98955`(entry `entry-858be2c61591f08ea88654ceed5f67ec.js`). `/open`은 이 PR 병합 커밋의 재배포 뒤 test.13·Preview 22 |
| 운영 설치본 | 태그 `android-v0.1.0-test.13`, `MassCOM-operating-android-5ca9895.apk`, SHA-256 `45dc8a37d56b545bf4ef2da133bde48795dfadb2d965d122151d4310aeb5c53b` | 소스 `5ca98955`. 익명 다운로드 해시는 일치(PASS, 2026-10-08 공개 Release에서 로그인 없이 다시 내려받아 SHA-256 재계산). 실기 `NOT_RUN` |
| 시연 설치본 | 태그 `showcase-android-v0.1.0-preview.22`, `MassCOM-showcase-android-5ca9895.apk`, SHA-256 `a384cfee5b1fdacd0c7128d2232c2673f6bb422a1047e223acc1397cceff932f` | 소스 `5ca98955`. 익명 다운로드 해시는 일치(PASS, 2026-10-08 공개 Release에서 로그인 없이 다시 내려받아 SHA-256 재계산). 실기 `NOT_RUN` |
| 대체 시연 영상 | [demo-flow-390.webm](evidence/submission-2026-10-08-recheck/demo-flow-390.webm), 10,053,739바이트, 4분 8초, 390×844, SHA-256 `d05301abb9857a9f330d4fa440f323228851109f14417781df95719d29a095ae` | **이전 `/play/`(소스 `9f5ebfa6`)의 15단계 녹화이며 새 번들 `5ca98955` 기준이 아님.** 설치본 실기 영상 아님 |

설치본·`/play/`는 소스 `5ca98955` 기준이고 대체 시연 영상만 이전 `9f5ebfa6` 기준입니다. #402는 `5ca98955`에 포함돼 코드 기준 차이는 영상 하나입니다. 영상을 새 번들로 다시 만들지, 이전 기준의 대체안으로 쓸지 제출 전에 정하고 같은 commit 기준인지 다시 확인합니다.

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

대회 제출용 `release/*` 또는 최종 태그는 별도 승인 후에만 만들고, 대상 SHA의 전체 CI와 Android/외부 환경 증거를 다시 확인합니다. 태그 이름·제출 파일 hash·발표 자료 버전·영상 버전을 같은 manifest에 기록합니다. 기존 private Android 테스트 태그와 [정적 시연 웹 전용 미리보기 태그](https://github.com/2026-KW-HACKATHON/27_MassCOM/releases/tag/showcase-web-v0.1.0-preview.1)는 **최종 제출 태그가 아니며**, 시연 Android APK도 포함하지 않습니다.
