# 실제 시연 Runbook

## 정상 순서

1. `main` commit과 CI 성공 run을 화면에 준비합니다.
2. Android 홈에서 지갑 없이 DEMO 음식점 목록·상세를 엽니다.
3. 점주 DEMO에서 고객 1인용 코드를 발급합니다.
4. 고객 화면에서 preview 후 redeem하고 방문·앱 수집품 1개, 실제 NFT 0개를 보여 줍니다.
5. 다음 가게 추천 이유와 상세 복귀를 보여 줍니다.
6. 외부 지갑 주소 확인 상태를 보여 주되 송금·approve 요청이 없음을 설명합니다.
7. 도감에서 전체 주소·체인·양도 제한 안내 후 NFT를 접수합니다.
8. Worker 실행 뒤 `NFT 접수 → 등록 완료`와 contract/token ID를 보여 줍니다.
9. 계정 설정에서 삭제되는 것과 남는 것을 보여 줍니다.

## 시연 전 검사

```bash
git status --short --branch
gh run list --branch main --workflow CI --limit 1
bash scripts/check-secrets.sh
bash scripts/check-privacy.sh
```

기기·지갑·API·DB·chain 버전과 DEMO 여부를 발표 시작 전에 기록합니다. 실제 지갑 주소·QR 원문·비밀은 화면 녹화나 발표 자료에 남기지 않습니다.

## 실패 대체안

| 실패 | 즉시 보여 줄 증거 | 말할 경계 |
| --- | --- | --- |
| Android/API 연결 실패 | 저장소 Android 스크린샷과 JSON | 사전 촬영/저장 증거이며 현재 실시간 성공으로 말하지 않음 |
| 지갑 앱 복귀 실패 | `android-wallet-connection.json`, `android-wallet-missing.json` | 수동 복귀 PASS와 자동 복귀 미관측 구분 |
| RPC/Anvil 실패 | `phase3-worker-anvil-android.json`, CI Worker 단계 | 운영/Base Sepolia 성공으로 확대하지 않음 |
| 계정 삭제 API 실패 | `account-deletion-privacy.json` | Local DEMO와 운영 재인증 BLOCKED 구분 |

## 금지

- 개인키·복구 문구·지갑 비밀번호 입력 또는 공유
- 실제 고객 주문·QR·정확한 식사 시각 노출
- 현장에서 mainnet·사용자 자산 이동
- 실패 화면을 편집해 실시간 성공처럼 제시
