# 제출 전 체크리스트

이 문서는 준비용입니다. 공개 전환·버전 고정·최종 제출은 사용자 승인 전 실행하지 않습니다.

## 코드·저장소

- [ ] 제출 commit SHA를 main CI 성공 run과 함께 기록
- [ ] 저장소 공개 전환 승인과 대회 public 요구 확인
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

- [ ] 3분·5분 리허설 시간 기록
- [ ] 실제 시연과 사전 저장 증거를 구분
- [ ] 현장 참여 동의와 빈 결과지 사용
- [ ] 존재하지 않는 협약·매출·테스터·승인 삭제
- [ ] 장애 대체안이 같은 commit 기준인지 확인

## 버전 고정 절차

대회 제출용 `release/*` 또는 최종 태그는 별도 승인 후에만 만들고, 대상 SHA의 전체 CI와 Android/외부 환경 증거를 다시 확인합니다. 태그 이름·제출 파일 hash·발표 자료 버전·영상 버전을 같은 manifest에 기록합니다. 기존 private Android 테스트 태그와 [정적 시연 웹 전용 미리보기 태그](https://github.com/2026-KW-HACKATHON/27_MassCOM/releases/tag/showcase-web-v0.1.0-preview.1)는 **최종 제출 태그가 아니며**, 시연 Android APK도 포함하지 않습니다.
