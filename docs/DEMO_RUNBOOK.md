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

## 시연 전부 체험(#333)

시연 서버(시연 앱)에서만 며칠을 기다리지 않고 은·금 수집품·배지 상자·쿠폰·뽑기를 모두 시험할 수 있습니다. `테스트 방문 만들기`를 같은 점포에서 5번 누르면 방문이 오늘부터 하루씩 앞선 서로 다른 날로 세어져 1·3·5회 수집품(동·은·금)이 차례로 나오고(오늘 포함 최대 30일, 캠페인 시작 전으로는 가지 않음), 상점에는 시연 체험 마일리지 100,000P가 더해져 골드까지 여러 번 뽑을 수 있습니다(상점에 "시연 체험 마일리지 포함" 표시). 계정당 테스트 방문은 시간당 60회입니다. 운영 서버·운영 앱은 이 규칙을 쓰지 않으며 하루 한 번 진행과 실제 적립 규칙이 그대로입니다. 이미 시드된 시연 DB는 시연 호스트 시드(`node dist/showcase/host-seed-command.js`, 로컬은 `npm run seed:showcase:local`)를 한 번 다시 돌려야 캠페인 시작이 30일 전으로 당겨집니다(재실행은 안전하며 시작 시각만 앞으로 당기고 다른 데이터는 건드리지 않음). 배포 전에는 이 동작이 서버에 없으므로 코드를 먼저 배포합니다.
