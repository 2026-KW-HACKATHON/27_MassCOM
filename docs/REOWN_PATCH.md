# Reown 2.0.6 pending proposal 패치

관련 Issue: [#35](https://github.com/2026-KW-HACKATHON/27_MassCOM/issues/35) · PR: [#38](https://github.com/2026-KW-HACKATHON/27_MassCOM/pull/38)

## 적용 이유

Reown AppKit React Native 2.0.6은 미설치 모바일 지갑에서 스토어로 이동해도 WalletConnect proposal을 취소하는 공개 AppKit API를 제공하지 않습니다. 모달만 닫으면 proposal이 기본 만료 시점까지 남아 development client에 `Uncaught Proposal expired`가 발생했습니다.

## 패치 범위

`apps/mobile/patches/@reown+appkit-react-native+2.0.6.patch`는 다음만 변경합니다.

- `AppKit.cancelPendingConnection()` 추가
- 현재 SignClient proposal ID를 expirer로 즉시 종료
- pending connection Promise rejection을 모달 종료 전에 소비
- 남은 pairing과 `WcController` 상태 정리
- 미설치 `LINKING_ERROR`와 의도적 proposal 종료를 예상 흐름으로 처리해 개발 LogBox 오류를 만들지 않음
- 잠긴 지갑을 기다리는 동안 proposal이 만료된 경우에도 모바일 연결 화면이 이를 예상 오류로 분류해 개발 LogBox를 만들지 않음
- `useAppKit()`에 위 메서드 노출

송금·서명·체인 전환·세션 승인 로직은 변경하지 않습니다.

## 적용·검증

`apps/mobile`의 `postinstall`이 `patch-package`를 실행합니다.

```bash
npm ci --prefix apps/mobile
npm test --prefix apps/mobile
npm run typecheck --prefix apps/mobile
npm run lint --prefix apps/mobile
npm run export:android --prefix apps/mobile
```

clean `npm ci` 패치 적용, 모바일 24/24, typecheck, lint, Android export를 확인했습니다. Samsung SM-S928N·Android 16에서 미설치 SafePal → Google Play → 수동 앱 복귀 후 6분 동안 추가 `Proposal expired`·미처리 Promise가 없었습니다.

2026-09-21 Issue #116에서는 MetaMask 잠금 해제를 기다리는 동안 실제 proposal 만료를 재현해 누락된 `ConnectingMobile` 로그 경로를 보완했습니다. 다시 `npm ci`로 패치 적용, 모바일 59/59·typecheck·lint·Android export를 통과했고, 미설치 SafePal → Google Play → 앱 복귀에서 한국어 복구 안내와 추가 `Proposal expired`·`Uncaught`·FATAL 0을 확인했습니다.

## 제거 조건

Reown stable이 pending proposal 취소를 공개 API로 제공하고 동일 실기 회귀가 PASS하면 이 패치와 `patch-package` 의존성을 제거합니다. canary·prerelease로 자동 교체하지 않습니다.
