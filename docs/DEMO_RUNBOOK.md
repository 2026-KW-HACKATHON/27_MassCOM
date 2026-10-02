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

시연 서버(시연 앱)에서만 며칠을 기다리지 않고 브론즈·실버·골드 수집품·배지 상자·쿠폰·뽑기를 모두 시험할 수 있습니다.

- **수집품 등급:** `테스트 방문 만들기`를 같은 점포에서 5번 누르면 방문이 오늘부터 하루씩 앞선 서로 다른 날로 세어져(오늘 포함 최대 30일, 캠페인 시작 전으로는 가지 않음) 1회 브론즈·3회 실버·5회 골드 수집품이 차례로 나옵니다. 그림은 세 등급이 같고 등급 이름·동작(실버 반짝임, 골드 반짝임과 한 번 터짐)·인사말이 다릅니다. 계정당 테스트 방문은 시간당 60회입니다.
- **마일리지:** 상점에는 시연 체험 마일리지 100,000P가 더해져 골드까지 여러 번 뽑을 수 있습니다(상점에 "시연 체험 마일리지 포함" 표시). 보너스를 나중에 빼면 쓴 만큼 잔액이 음수가 되어 더 사지 못합니다.
- **알아 둘 점:** 이미 3회·5회 보상권을 받은 계정은 다시 받지 못하므로 새 시연 계정으로 시험합니다. 방문 날짜가 계정 생성·동의보다 앞설 수 있고, 친구에게는 어제 이전 날짜의 방문이 하루 지연 없이 바로 보입니다. 점원 화면의 "오늘" 방문 목록에는 오늘 날짜의 방문 하나만 보입니다(옮겨진 방문은 취소할 수 없는 지난 날짜).
- **취소 주의:** 점원 화면에서는 오늘 날짜의 방문만 취소할 수 있고, 테스트 방문 중 오늘 날짜는 가장 먼저 만든 방문(1회 보상을 낳은 방문)입니다. 이를 취소하면 그 방문이 낳은 1회 보상과 남은 방문 수보다 목표가 큰 보상이 함께 회수됩니다(5번 눌렀다면 1회와 5회). 다음 테스트 방문이 오늘 날짜를 다시 채우면 회수된 보상이 새로 지급되어 저절로 복구됩니다. 회수될 보상이 이미 NFT 발행 요청으로 넘어갔다면 취소는 409로 거절됩니다.
- **운영:** 운영 서버·운영 앱은 이 규칙을 쓰지 않으며 하루 한 번 진행과 실제 적립 규칙이 그대로입니다.
- **배포 뒤 해야 할 일(시연 서버):** 이미 시드된 시연 DB는 시연 호스트 시드(`node dist/showcase/host-seed-command.js`, 로컬은 `npm run seed:showcase:local`)를 **캠페인이 끝나기 전에** 한 번 다시 돌려야 합니다. 재시드는 ① 캠페인 시작을 시드 시각의 30일 전까지 앞당기고 ② 캠페인 끝을 시드 시각의 30일 뒤까지 늘리며(줄이지 않음, 돌릴 때마다 끝이 "지금 + 30일"까지 밀림) ③ 옛 단일 등급 수집품 게시물을 3등급 게시물로 한 번 갈아 끼웁니다. 시연 캠페인은 처음 시드한 지 30일 뒤에 끝나고, 끝난 캠페인은 재시드가 거절하며 방문 수령이 `CLAIM_CAMPAIGN_UNAVAILABLE`로 막히므로 끝나기 전에 돌립니다. 코드를 먼저 배포한 뒤 돌립니다.
- **재시드 뒤 확인(시연 DB, 읽기 전용):** 세 가상 점포 캠페인의 수집품 연결이 3등급 게시물을 가리키는지 확인합니다. 아래 질의가 캠페인마다 한 줄씩 `{bronze,gold,silver}`를 돌려주면 정상입니다. 옛 단일 등급 게시물을 알아보는 조건(작성자 열이 비어 있음·이름·테마·등급 배열이 정확히 일치)은 하나라도 다르면 건드리지 않고 넘어가는 안전한 쪽이므로, 일치하는 것이 없으면 아무것도 바뀌지 않고 `{bronze}`가 그대로 남습니다. 그 경우 재시드가 실패한 것이 아니니 연결이 어떤 게시물인지 확인한 뒤 판단합니다(점주가 만든 게시물이면 그대로 둡니다).

```sql
SELECT link.campaign_id, array_agg(grade.grade_id ORDER BY grade.grade_id) AS grades
FROM campaign_collectible_publications link
JOIN collectible_publication_grades grade ON grade.publication_id = link.publication_id
WHERE link.campaign_id IN ('showcase-local-campaign', 'showcase-local-campaign-b', 'showcase-local-campaign-c')
GROUP BY link.campaign_id ORDER BY link.campaign_id;
```
