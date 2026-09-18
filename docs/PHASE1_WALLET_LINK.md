# Phase 1 외부 지갑 주소 확인

GitHub: Issue [#9](https://github.com/2026-KW-HACKATHON/27_MassCOM/issues/9) CLOSED · PR [#10](https://github.com/2026-KW-HACKATHON/27_MassCOM/pull/10) MERGED · merge `80bf53b`

## 구현 범위

- Expo SDK 57 + React Native 0.86.3 + Expo Router development build
- Reown AppKit RN/Ethers adapter 2.0.6, WalletConnect compat 2.25.0
- Base Sepolia 단일 네트워크
- 외부 지갑 연결과 `personal_sign` SIWE 주소 확인
- Node.js TypeScript 최소 API와 실제 ethers 서명 검증
- 이메일·소셜·내장 지갑·구매·스왑·거래 요청 비활성화
- WalletConnect session proposal도 Base Sepolia와 5개 허용 메서드·3개 이벤트로 제한

## 서버 계약

`POST /wallet/challenges`는 검증 대상 계정 헤더, 주소, chain ID를 받아 5분짜리 ERC-4361 메시지를 만듭니다. `POST /wallet/verify`는 challenge 원문, 서명, 현재 선택 주소를 받고 다음을 모두 확인합니다.

- account, domain, URI, version, Base Sepolia 84532
- nonce, issuedAt, expirationTime, requestId
- 메시지 원문 불변성과 현재 선택 주소
- ethers로 복구한 실제 서명 주소
- nonce의 claim → 성공 소비 또는 실패 해제

현재 메모리 저장소는 개발 전용입니다. API의 계정은 `AccountResolver`가 결정하며 기본 실행은 resolver 미구성 시 거절합니다. `x-account-id`는 loopback insecure demo 모드를 명시적으로 켰을 때만 사용합니다.

## 앱 상태

- 설정 없음: `BLOCKED`, Reown modal을 열지 않음
- 연결 안 됨: 외부 지갑 선택 가능
- 연결됨·미확인: `UNVERIFIED`, 발행 불가
- 잘못된 체인: Base Sepolia 전환 안내
- 서명 요청·서버 확인 중: 중복 제출 차단
- 주소 변경·앱 복귀 불일치: 기존 확인 상태 제거
- 서명 완료: `VERIFIED`; 아직 NFT 발행은 수행하지 않음

## 자동화 결과

- API: 15개 PASS — challenge, 실제 서명 복구, replay, 만료 경계, 안전한 SIWE 설정, domain/message 변조, 주소 변경, spoof 불가 account resolver·계정 경계
- 앱 순수 로직: 11개 PASS — 허용 메서드 allowlist, 거래/typed-data 거절, 환경 경계, API 오류 보존
- `expo-doctor`: 21/21 PASS
- TypeScript·ESLint·Android Metro export: PASS
- Android debug APK: 빌드·설치·실행 PASS

## 실기 BLOCKER

- Reown Dashboard project ID가 없어 실제 AppKit wallet modal은 열지 않음
- MetaMask가 설치된 실제 Android 기기 시험 미실행
- 지갑 미설치·사용자 거절·외부 앱 복귀·주소 변경 실기 미실행
- release package ID·AAB·App Link·Play 트랙 미확정

## 공식 근거

- [Reown React Native 설치](https://docs.reown.com/appkit/react-native/core/installation)
- [Reown AppKit 옵션](https://docs.reown.com/appkit/react-native/core/options)
- [Reown AppKit hooks](https://docs.reown.com/appkit/react-native/core/hooks)
- [Expo SDK 57](https://docs.expo.dev/versions/v57.0.0/)
- [Expo development build](https://docs.expo.dev/develop/development-builds/introduction/)
- [ERC-4361 SIWE](https://eips.ethereum.org/EIPS/eip-4361)
- [EIP-1193 Provider API](https://eips.ethereum.org/EIPS/eip-1193)
- [Base 네트워크 연결 정보](https://docs.base.org/get-started/connect-to-base)
