# Google Play Console 제출 초안

상태: `DRAFT` — Console에 입력하거나 제출한 항목은 없습니다. 아래 답은 2026-09-21 기준 실제 코드의 데이터 흐름에서 도출한 초안이며, 제출 전 계정 소유자가 Console 문항 원문과 대조해 확정합니다. 승인·심사 결과를 뜻하지 않습니다.

## 근거로 삼은 실제 구현

- 설치된 SDK: Expo 기본 모듈·Expo Camera, Reown AppKit(WalletConnect), AsyncStorage. 분석·광고·crash 수집 SDK 없음(privacy gate가 CI에서 차단).
- 현재 코드가 요구하는 권한: `CAMERA`, `INTERNET`, 네트워크 상태, `VIBRATE`. 카메라는 점주 화면의 방문 수령 QR을 전경에서 읽을 때만 runtime 요청하며 `RECORD_AUDIO`는 비활성화했습니다. QR 이미지·사진·영상은 저장하거나 서버로 보내지 않습니다. upload-key AAB에서 Android 12 이하용 legacy 저장소 권한(`maxSdkVersion=32`)이 Expo 의존성으로 합쳐지는 것과 개발용 `SYSTEM_ALERT_WINDOW`가 제거된 것을 bundletool로 확인했습니다. Console 답은 실제 문항 원문과 다시 대조합니다.
- 서버로 보내는 값: 앱 account ID, Google ID token(검증 후 미보관), Google `sub` 식별자(서버 identity 연결에 저장), 지갑 공개 주소, 주소 확인용 SIWE 서명, 카메라가 해독한 QR 수령 token, 계정 삭제 요청. 카메라 frame은 보내지 않습니다.
- 기기에 저장하는 값: WalletConnect 세션뿐이며 개인키·복구 문구·인증 token은 저장하지 않습니다(D-021).
- 제3자 전송: Reown relay(WalletConnect 세션 중계), Base Sepolia RPC(allowlist), 서비스 API.

## Data safety 초안

| 문항 | 초안 답 | 근거·확인 필요 |
| --- | --- | --- |
| 사용자 데이터를 수집하거나 공유하는가 | 수집함 | account ID, 지갑 주소, 방문 기록이 서버에 저장됨 |
| 전송 중 암호화 | 예 | `api.masscom.kr` TLS와 외부 health를 확인. 제출 직전 다시 확인 |
| 삭제 요청 방법 제공 | 예 | 앱 안 경로 구현, 외부 안내 `https://masscom.kr/account-deletion` HTTPS 확인. 실제 Console 입력·운영 fresh 재인증은 별도 |
| 개인 식별자(사용자 ID) | 수집, 앱 기능·계정 관리·보안 목적 | 서버는 Google `sub`와 무작위 내부 account ID를 저장하고 이메일은 저장하지 않음. 첫 모바일 Google 로그인·session 복원·logout PASS |
| 금융 정보 | 결제·카드 정보는 수집하지 않음 | 지갑 공개 주소를 어느 범주로 선언할지 소유자가 Console 정의와 대조 |
| 위치 | 수집하지 않음 | 위치 권한·SDK 없음. 점포 주소는 점포 데이터이며 사용자 위치가 아님 |
| 앱 활동 | 수집(방문·수령 기록) | 보상 지급과 중복 방지 목적 |
| 사진·동영상 | 수집하지 않음 | 카메라 frame은 기기에서 QR token 해독에만 쓰고 저장·업로드하지 않음 |
| 기기 ID·광고 ID | 수집하지 않음 | 광고·분석 SDK 없음 |
| 제3자 공유 | Reown relay와 RPC 제공자로 지갑 세션·주소가 전달됨 | "공유" 해당 여부를 Console 정의와 대조 |

## 금융 기능 선언 초안

- 앱은 송금·결제·스왑·구매·`approve`/`permit`·내장 지갑 기능을 제공하지 않습니다.
- NFT는 방문 보상으로 서비스가 gas를 부담해 발행하며 양도가 제한됩니다. 판매·거래 기능은 없습니다.
- Google Play의 금융 기능 선언에서 **Tokenized digital asset (NFT) sales, trading, and awards** 중 NFT award에 해당함을 공개합니다. "금융 기능 없음"을 선택하지 않습니다.
- 금전이나 가치 있는 자산을 무작위 NFT 획득 기회와 교환하지 않으며, 수익 가능성을 홍보하지 않습니다.

## 콘텐츠 등급·대상 연령 초안

- 폭력·성적 콘텐츠·도박·사용자 간 채팅 없음. 실제 상점 방문과 디지털 수집품 보상.
- 대상 연령은 지갑 앱 사용을 전제로 하므로 소유자가 결정합니다. 아동 대상 아님으로 제안합니다.

## 심사 접근 안내 초안

- 실제 구매 없이 재현 가능한 DEMO 점포와 시연 계정, 안전한 DEMO QR을 제공합니다.
- 네트워크는 Base Sepolia 시험망이며 자산 가치가 없음을 명시합니다.
- 심사 메모에 개인키·복구 문구·지갑 비밀번호·실제 고객 QR·운영 DB 정보를 넣지 않습니다.

## 제출 전 소유자가 확정할 것

1. 생성된 upload key의 안전한 백업·로컬 서명 설정과 Play App Signing 등록(package ID는 `kr.masscom.wolgye`로 결정, D-022). 공개 SHA-256 핀은 저장소에 있으며 key/password는 저장소 밖에 유지
2. 소유 HTTPS domain `https://masscom.kr`, 개인정보처리방침 `https://masscom.kr/privacy`, 외부 계정 삭제 안내 `https://masscom.kr/account-deletion`을 실제 Console 문항에 맞춰 확인. URL의 HTTPS 동작은 검증했으나 Console 제출은 하지 않음
3. 개발자 계정 생성일에 따른 폐쇄 테스트(12명·14일) 적용 여부
4. 위 표의 "확인 필요" 항목과 Console 문항 원문 대조

## 공식 확인 근거

- [Google Play 금융 기능 선언](https://support.google.com/googleplay/android-developer/answer/13849271?hl=en)
- [Google Play 블록체인 기반 콘텐츠 정책](https://support.google.com/googleplay/android-developer/answer/13607354?hl=en)
- [Google Play 계정 삭제 요구사항](https://support.google.com/googleplay/android-developer/answer/13327111?hl=en)
- [Android 권한 개요](https://developer.android.com/guide/topics/permissions/overview)
