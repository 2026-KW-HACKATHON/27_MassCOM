# UI 시안 23보드·67화면 구현 추적 (2026-10-07)

기준 자료: `manifest(1).json`의 23 boards / 67 screens, `화면목록(1).txt`, 원본·수정 프롬프트. PNG는 시각 참조이며 동작 증거로 세지 않는다. 예시 이름·가게·수량·가격·재고·보상은 정책 근거가 아니다.

구현 상태는 `신규 구현`, `기존 재사용`, `부분 구현` 또는 조합으로 표시한다. 검증은 소스/자동 테스트/API 통합과 실제 화면 확인을 구분한다. 브라우저에서 실제 화면 확인한 상태는 홈과 프로필뿐이며 native 화면 확인은 수행하지 않았다. API 검증은 로컬 검증 로그의 42단계 범위이며 전체 67상태의 시각 검증을 의미하지 않는다. 최종 QA는 아직 진행 중이다.

| 보드 | manifest 화면 상태 | 구현 상태 | 코드 근거 | 검증 근거/범위 | 제한·정책 메모 |
| --- | --- | --- | --- | --- | --- |
| 00-home | 마이룸·보유 뽑기권·방문 보상·친구·방문 인증 | 기존 재사용 + 개편 | `apps/mobile/src/screens/home/index.tsx; apps/mobile/src/screens/home/home-tickets.tsx` | 소스·단위 테스트; 실제 화면 확인 | 화면 상태는 기존 경로로 연결; 정책 미확정 수치는 적용하지 않음. |
| 01-friends | 친구 목록 | 기존 재사용 + 개편 | `apps/mobile/src/screens/friends/index.tsx; apps/mobile/src/friends/friends-api.ts` | 소스·단위 테스트; 실제 화면 미확인 | 화면 상태는 기존 경로로 연결; 정책 미확정 수치는 적용하지 않음. |
| 01-friends | 친구 추가 | 기존 재사용 + 개편 | `apps/mobile/src/screens/friends/index.tsx; apps/mobile/src/friends/friends-api.ts` | 소스·단위 테스트; 실제 화면 미확인 | 화면 상태는 기존 경로로 연결; 정책 미확정 수치는 적용하지 않음. |
| 01-friends | 친구 프로필 | 기존 재사용 + 개편 | `apps/mobile/src/screens/friends/index.tsx; apps/mobile/src/friends/friends-api.ts` | 소스·단위 테스트; 실제 화면 미확인 | 화면 상태는 기존 경로로 연결; 정책 미확정 수치는 적용하지 않음. |
| 02-social-actions | 우정 교환 | 기존 재사용 + 개편 | `apps/mobile/src/screens/mail/compose.tsx; apps/mobile/src/screens/mail/detail.tsx; apps/mobile/src/screens/room-explore/index.tsx` | 소스·API 테스트; 초대 응답 UI는 구현됨 | 화면 상태는 기존 경로로 연결; 정책 미확정 수치는 적용하지 않음. |
| 02-social-actions | 쪽지 작성 | 기존 재사용 + 개편 | `apps/mobile/src/screens/mail/compose.tsx; apps/mobile/src/screens/mail/detail.tsx; apps/mobile/src/screens/room-explore/index.tsx` | 소스·API 테스트; 초대 응답 UI는 구현됨 | 화면 상태는 기존 경로로 연결; 정책 미확정 수치는 적용하지 않음. |
| 02-social-actions | 식사 초대 | 기존 재사용 + 개편 | `apps/mobile/src/screens/mail/compose.tsx; apps/mobile/src/screens/mail/detail.tsx; apps/mobile/src/screens/room-explore/index.tsx` | 소스·API 테스트; 초대 응답 UI는 구현됨 | 화면 상태는 기존 경로로 연결; 정책 미확정 수치는 적용하지 않음. |
| 03-room-edit | 마이룸 감상 | 신규 구현 + 기존 테마 재사용 | `apps/mobile/src/screens/studio/index.tsx; apps/mobile/src/studio/studio-furniture.ts; apps/api/src/furniture.ts` | 소스·API 테스트; 실제 화면 미확인 | 화면 상태는 기존 경로로 연결; 정책 미확정 수치는 적용하지 않음. |
| 03-room-edit | 가구 배치 편집 | 신규 구현 + 기존 테마 재사용 | `apps/mobile/src/screens/studio/index.tsx; apps/mobile/src/studio/studio-furniture.ts; apps/api/src/furniture.ts` | 소스·API 테스트; 실제 화면 미확인 | 화면 상태는 기존 경로로 연결; 정책 미확정 수치는 적용하지 않음. |
| 03-room-edit | 벽·바닥 편집 | 신규 구현 + 기존 테마 재사용 | `apps/mobile/src/screens/studio/index.tsx; apps/mobile/src/studio/studio-furniture.ts; apps/api/src/furniture.ts` | 소스·API 테스트; 실제 화면 미확인 | 화면 상태는 기존 경로로 연결; 정책 미확정 수치는 적용하지 않음. |
| 04-customization | 코인 전시 편집 | 부분 구현 | `apps/mobile/src/screens/studio/index.tsx; apps/mobile/src/navigation/tab-appearance.ts; apps/mobile/src/app/appearance.tsx` | 소스·단위 테스트; 동행/의상은 기존 선택 기능 | 대표 코인/전시는 기존 방 슬롯에 연결; 별도 고정 슬롯 추가는 없음. |
| 04-customization | 동행·의상 편집 | 부분 구현 | `apps/mobile/src/screens/studio/index.tsx; apps/mobile/src/navigation/tab-appearance.ts; apps/mobile/src/app/appearance.tsx` | 소스·단위 테스트; 동행/의상은 기존 선택 기능 | 화면 상태는 기존 경로로 연결; 정책 미확정 수치는 적용하지 않음. |
| 04-customization | 하단 바 꾸미기 | 부분 구현 | `apps/mobile/src/screens/studio/index.tsx; apps/mobile/src/navigation/tab-appearance.ts; apps/mobile/src/app/appearance.tsx` | 소스·단위 테스트; 동행/의상은 기존 선택 기능 | 화면 상태는 기존 경로로 연결; 정책 미확정 수치는 적용하지 않음. |
| 05-room-visitors | 방문 환영·공개 설정 | 신규 구현 + 부분 구현 | `apps/mobile/src/screens/room-explore/index.tsx; apps/api/src/room-community.ts` | 소스·API 테스트; 선택형 120자 메시지 연결 | 나만/친구/같은 가게 이웃 공개 범위 및 조회 권한 검사 연결. |
| 05-room-visitors | 마이룸 방문자 | 신규 구현 + 부분 구현 | `apps/mobile/src/screens/room-explore/index.tsx; apps/api/src/room-community.ts` | 소스·API 테스트; 선택형 120자 메시지 연결 | 방문자 목록·답방 동선과 선택형 친구 추가 포함. 칭찬 도장에 선택 텍스트(최대 120자)를 함께 남길 수 있음. |
| 05-room-visitors | 친구 마이룸 방문 | 신규 구현 + 부분 구현 | `apps/mobile/src/screens/room-explore/index.tsx; apps/api/src/room-community.ts` | 소스·API 테스트; 선택형 120자 메시지 연결 | 화면 상태는 기존 경로로 연결; 정책 미확정 수치는 적용하지 않음. |
| 06-store-neighbors | 가게 이웃 입구 | 신규 구현 | `apps/mobile/src/app/room-explore.tsx; apps/mobile/src/screens/room-explore/index.tsx; apps/api/src/postgres/room-community.ts` | 소스·API 테스트; 실제 화면 미확인 | 공통 방문 가게 기반 이웃 조회. 06 보드 하단 활성 탭은 최종 수정대로 탐색. |
| 06-store-neighbors | 가게 노드와 이웃 | 신규 구현 | `apps/mobile/src/app/room-explore.tsx; apps/mobile/src/screens/room-explore/index.tsx; apps/api/src/postgres/room-community.ts` | 소스·API 테스트; 실제 화면 미확인 | 공통 방문 가게 기반 이웃 조회. 06 보드 하단 활성 탭은 최종 수정대로 탐색. |
| 06-store-neighbors | 비친구 랜덤 마이룸 방문 | 신규 구현 | `apps/mobile/src/app/room-explore.tsx; apps/mobile/src/screens/room-explore/index.tsx; apps/api/src/postgres/room-community.ts` | 소스·API 테스트; 실제 화면 미확인 | 공통 방문 가게 기반 이웃 조회. 06 보드 하단 활성 탭은 최종 수정대로 탐색. |
| 07-explore | 지도 탐색 | 기존 재사용 + 개편 | `apps/mobile/src/screens/town-map; apps/mobile/src/merchant/discovery-api.ts; apps/mobile/src/app/merchants/[merchantId].tsx` | 기존 지도·가게 API 경로; 실제 화면 미확인 | 화면 상태는 기존 경로로 연결; 정책 미확정 수치는 적용하지 않음. |
| 07-explore | 검색 결과 | 기존 재사용 + 개편 | `apps/mobile/src/screens/town-map; apps/mobile/src/merchant/discovery-api.ts; apps/mobile/src/app/merchants/[merchantId].tsx` | 기존 지도·가게 API 경로; 실제 화면 미확인 | 서버 검색 결과 사용; 실제 위치·영업 정보가 비어 있으면 추정해 채우지 않음. |
| 07-explore | 가게 상세 | 기존 재사용 + 개편 | `apps/mobile/src/screens/town-map; apps/mobile/src/merchant/discovery-api.ts; apps/mobile/src/app/merchants/[merchantId].tsx` | 기존 지도·가게 API 경로; 실제 화면 미확인 | 화면 상태는 기존 경로로 연결; 정책 미확정 수치는 적용하지 않음. |
| 08-visit | 길찾기 | 기존 재사용 + 개편 | `apps/mobile/src/screens/claim-redeem; apps/api/src/claim-slot-service.ts` | 인증 API·테스트; 실제 화면 미확인 | 화면 상태는 기존 경로로 연결; 정책 미확정 수치는 적용하지 않음. |
| 08-visit | QR·코드 방문 인증 | 기존 재사용 + 개편 | `apps/mobile/src/screens/claim-redeem; apps/api/src/claim-slot-service.ts` | 인증 API·테스트; 실제 화면 미확인 | 화면 상태는 기존 경로로 연결; 정책 미확정 수치는 적용하지 않음. |
| 08-visit | 방문 완료 | 기존 재사용 + 개편 | `apps/mobile/src/screens/claim-redeem; apps/api/src/claim-slot-service.ts` | 인증 API·테스트; 실제 화면 미확인 | 기존 방문 보상 권리와 획득 결과를 유지; 시안 숫자를 보상 정책으로 적용하지 않음. |
| 09-draw | 보유 뽑기권 상세 | 기존 재사용 + 신규 리롤 | `apps/mobile/src/screens/coin-shop/index.tsx; apps/mobile/src/screens/coin-collection/index.tsx; apps/api/src/postgres/coin-economy.ts` | API·단위 테스트; 실제 화면 미확인 | 일반 추첨권은 보유 코인을 유지하며 신규 획득; 리롤은 기존 코인을 회수하는 별도 흐름. |
| 09-draw | 뽑기권 사용 확인 | 기존 재사용 + 신규 리롤 | `apps/mobile/src/screens/coin-shop/index.tsx; apps/mobile/src/screens/coin-collection/index.tsx; apps/api/src/postgres/coin-economy.ts` | API·단위 테스트; 실제 화면 미확인 | 화면 상태는 기존 경로로 연결; 정책 미확정 수치는 적용하지 않음. |
| 09-draw | 뽑기 획득 결과 | 기존 재사용 + 신규 리롤 | `apps/mobile/src/screens/coin-shop/index.tsx; apps/mobile/src/screens/coin-collection/index.tsx; apps/api/src/postgres/coin-economy.ts` | API·단위 테스트; 실제 화면 미확인 | 화면 상태는 기존 경로로 연결; 정책 미확정 수치는 적용하지 않음. |
| 10-collection | 가게별 도감 | 기존 도감 재사용 + 등급 앨범 | `apps/mobile/src/screens/collection/index.tsx; apps/mobile/src/screens/collection/collectible-browser.tsx` | 소스·단위 테스트; 실제 화면 미확인 | 화면 상태는 기존 경로로 연결; 정책 미확정 수치는 적용하지 않음. |
| 10-collection | 가게·코인별 4등급 앨범 | 기존 도감 재사용 + 등급 앨범 | `apps/mobile/src/screens/collection/index.tsx; apps/mobile/src/screens/collection/collectible-browser.tsx` | 소스·단위 테스트; 실제 화면 미확인 | 화면 상태는 기존 경로로 연결; 정책 미확정 수치는 적용하지 않음. |
| 10-collection | 일반 코인 상세 | 기존 도감 재사용 + 등급 앨범 | `apps/mobile/src/screens/collection/index.tsx; apps/mobile/src/screens/collection/collectible-browser.tsx` | 소스·단위 테스트; 실제 화면 미확인 | 화면 상태는 기존 경로로 연결; 정책 미확정 수치는 적용하지 않음. |
| 11-reroll | 도감 정렬·필터 | 신규 구현 | `apps/mobile/src/screens/coin-shop/index.tsx; apps/mobile/src/shop/coin-reroll-pending.ts; apps/api/src/postgres/coin-economy.ts` | API·단위 테스트; 확률은 판매 풀 가중치 | 화면 상태는 기존 경로로 연결; 정책 미확정 수치는 적용하지 않음. |
| 11-reroll | 리롤권 선택·소모 확인 | 신규 구현 | `apps/mobile/src/screens/coin-shop/index.tsx; apps/mobile/src/shop/coin-reroll-pending.ts; apps/api/src/postgres/coin-economy.ts` | API·단위 테스트; 확률은 판매 풀 가중치 | 확정 운영 선택: 일반(전체 등급)·실버(실버 이상) 2종. 브론즈권은 별도 제공하지 않음. |
| 11-reroll | 리롤 결과 | 신규 구현 | `apps/mobile/src/screens/coin-shop/index.tsx; apps/mobile/src/shop/coin-reroll-pending.ts; apps/api/src/postgres/coin-economy.ts` | API·단위 테스트; 확률은 판매 풀 가중치 | 동일 코인 재획득·등급 하락 허용, 회수 코인 소멸. 활성 판매 풀과 가중 확률 사용. |
| 12-nft | NFT 받기 확인 | 기존 발급 흐름 재사용 | `apps/mobile/src/screens/collection/index.tsx; apps/mobile/src/screens/collection/nft-status.ts; apps/api/src/postgres/coin-economy.ts` | NFT 상태·API 테스트; 실제 화면 미확인 | 화면 상태는 기존 경로로 연결; 정책 미확정 수치는 적용하지 않음. |
| 12-nft | NFT 발급 중 | 기존 발급 흐름 재사용 | `apps/mobile/src/screens/collection/index.tsx; apps/mobile/src/screens/collection/nft-status.ts; apps/api/src/postgres/coin-economy.ts` | NFT 상태·API 테스트; 실제 화면 미확인 | 접수/진행/완료/확인 필요를 코인 발급 단위로 표시; 접수 실패·장기 대기에서 리롤 잠금 해제 판정은 기존 서버 상태 기준. |
| 12-nft | NFT 보유 코인 상세 | 기존 발급 흐름 재사용 | `apps/mobile/src/screens/collection/index.tsx; apps/mobile/src/screens/collection/nft-status.ts; apps/api/src/postgres/coin-economy.ts` | NFT 상태·API 테스트; 실제 화면 미확인 | 화면 상태는 기존 경로로 연결; 정책 미확정 수치는 적용하지 않음. |
| 13-shop | 마일리지 상점 | 부분 구현 | `apps/mobile/src/screens/shop/index.tsx; apps/mobile/src/screens/studio/inventory.tsx; apps/api/src/furniture.ts` | 상품/보관함 연결, 운영 가격 미확정 상품 구매 제한 | 화면 상태는 기존 경로로 연결; 정책 미확정 수치는 적용하지 않음. |
| 13-shop | 가구 상품 상세 | 부분 구현 | `apps/mobile/src/screens/shop/index.tsx; apps/mobile/src/screens/studio/inventory.tsx; apps/api/src/furniture.ts` | 상품/보관함 연결, 운영 가격 미확정 상품 구매 제한 | 화면 상태는 기존 경로로 연결; 정책 미확정 수치는 적용하지 않음. |
| 13-shop | 마일리지 구매 확인 | 부분 구현 | `apps/mobile/src/screens/shop/index.tsx; apps/mobile/src/screens/studio/inventory.tsx; apps/api/src/furniture.ts` | 상품/보관함 연결, 운영 가격 미확정 상품 구매 제한 | 가격·지급 정책이 확정되지 않은 가구 상품은 구매할 수 없는 상태로 둠. |
| 14-inventory | 구매 완료 | 신규 구현 + 기존 내역 재사용 | `apps/mobile/src/screens/studio/inventory.tsx; apps/mobile/src/screens/shop/index.tsx; apps/api/src/postgres/furniture.ts` | 소스·API 테스트; 실제 화면 미확인 | 화면 상태는 기존 경로로 연결; 정책 미확정 수치는 적용하지 않음. |
| 14-inventory | 마일리지 내역 | 신규 구현 + 기존 내역 재사용 | `apps/mobile/src/screens/studio/inventory.tsx; apps/mobile/src/screens/shop/index.tsx; apps/api/src/postgres/furniture.ts` | 소스·API 테스트; 실제 화면 미확인 | 화면 상태는 기존 경로로 연결; 정책 미확정 수치는 적용하지 않음. |
| 14-inventory | 보관함 | 신규 구현 + 기존 내역 재사용 | `apps/mobile/src/screens/studio/inventory.tsx; apps/mobile/src/screens/shop/index.tsx; apps/api/src/postgres/furniture.ts` | 소스·API 테스트; 실제 화면 미확인 | 화면 상태는 기존 경로로 연결; 정책 미확정 수치는 적용하지 않음. |
| 15-play-start | 놀이 허브 | 기존 재사용 + 개편 | `apps/mobile/src/screens/play/index.tsx; apps/mobile/src/play/play-api.ts` | 소스·단위 테스트; 실제 화면 미확인 | 화면 상태는 기존 경로로 연결; 정책 미확정 수치는 적용하지 않음. |
| 15-play-start | 놀이 준비·규칙 | 기존 재사용 + 개편 | `apps/mobile/src/screens/play/index.tsx; apps/mobile/src/play/play-api.ts` | 소스·단위 테스트; 실제 화면 미확인 | 화면 상태는 기존 경로로 연결; 정책 미확정 수치는 적용하지 않음. |
| 15-play-start | 타이밍 쌓기 진행 | 기존 재사용 + 개편 | `apps/mobile/src/screens/play/index.tsx; apps/mobile/src/play/play-api.ts` | 소스·단위 테스트; 실제 화면 미확인 | 화면 상태는 기존 경로로 연결; 정책 미확정 수치는 적용하지 않음. |
| 16-play-games | 짝 찾기 진행 | 기존 게임 재사용 + 개편 | `apps/mobile/src/screens/play/game-session.tsx; apps/mobile/src/screens/play/play-content.ts; apps/mobile/src/screens/play/play-art.tsx` | 소스·단위 테스트; 네 가지 놀이 구현 | 기존 4종 게임의 결과/입력 처리 연결; 운영 가게 자산이 없을 때는 기본 콘텐츠를 표시. |
| 16-play-games | 세 갈래 배달 진행 | 기존 게임 재사용 + 개편 | `apps/mobile/src/screens/play/game-session.tsx; apps/mobile/src/screens/play/play-content.ts; apps/mobile/src/screens/play/play-art.tsx` | 소스·단위 테스트; 네 가지 놀이 구현 | 기존 4종 게임의 결과/입력 처리 연결; 운영 가게 자산이 없을 때는 기본 콘텐츠를 표시. |
| 16-play-games | 주문 맞추기 진행 | 기존 게임 재사용 + 개편 | `apps/mobile/src/screens/play/game-session.tsx; apps/mobile/src/screens/play/play-content.ts; apps/mobile/src/screens/play/play-art.tsx` | 소스·단위 테스트; 네 가지 놀이 구현 | 기존 4종 게임의 결과/입력 처리 연결; 운영 가게 자산이 없을 때는 기본 콘텐츠를 표시. |
| 17-play-end | 놀이 일시정지 | 기존 재사용 + 개편 | `apps/mobile/src/screens/play/game-session.tsx; apps/api/src/play.ts` | 소스·API 테스트; 실제 화면 미확인 | 화면 상태는 기존 경로로 연결; 정책 미확정 수치는 적용하지 않음. |
| 17-play-end | 놀이 결과·보상 | 기존 재사용 + 개편 | `apps/mobile/src/screens/play/game-session.tsx; apps/api/src/play.ts` | 소스·API 테스트; 실제 화면 미확인 | 화면 상태는 기존 경로로 연결; 정책 미확정 수치는 적용하지 않음. |
| 17-play-end | 놀이 기록 | 기존 재사용 + 개편 | `apps/mobile/src/screens/play/game-session.tsx; apps/api/src/play.ts` | 소스·API 테스트; 실제 화면 미확인 | 화면 상태는 기존 경로로 연결; 정책 미확정 수치는 적용하지 않음. |
| 18-profile | 내 프로필 | 기존 프로필 + 신규 소개 | `apps/mobile/src/app/profile.tsx; apps/mobile/src/friends/profile-updates.ts; apps/api/src/profile-intro.test.ts` | 단위/API 테스트; 프로필 화면 확인 | 화면 상태는 기존 경로로 연결; 정책 미확정 수치는 적용하지 않음. |
| 18-profile | 한 줄 소개 편집 | 기존 프로필 + 신규 소개 | `apps/mobile/src/app/profile.tsx; apps/mobile/src/friends/profile-updates.ts; apps/api/src/profile-intro.test.ts` | 단위/API 테스트; 프로필 화면 확인 | 사용자가 수정하는 한 줄 소개. 제한/저장 검증은 서버 경로. |
| 18-profile | 탐험 여권 | 기존 프로필 + 신규 소개 | `apps/mobile/src/app/profile.tsx; apps/mobile/src/friends/profile-updates.ts; apps/api/src/profile-intro.test.ts` | 단위/API 테스트; 프로필 화면 확인 | 화면 상태는 기존 경로로 연결; 정책 미확정 수치는 적용하지 않음. |
| 19-mail-missions | 우편함 | 기존 재사용 + 개편 | `apps/mobile/src/screens/mail/index.tsx; apps/mobile/src/screens/mail/detail.tsx; apps/mobile/src/app/home/missions.tsx` | 소스·API 테스트; 실제 화면 미확인 | 화면 상태는 기존 경로로 연결; 정책 미확정 수치는 적용하지 않음. |
| 19-mail-missions | 우편 상세·첨부 보상 | 기존 재사용 + 개편 | `apps/mobile/src/screens/mail/index.tsx; apps/mobile/src/screens/mail/detail.tsx; apps/mobile/src/app/home/missions.tsx` | 소스·API 테스트; 실제 화면 미확인 | 화면 상태는 기존 경로로 연결; 정책 미확정 수치는 적용하지 않음. |
| 19-mail-missions | 미션 목록 | 기존 재사용 + 개편 | `apps/mobile/src/screens/mail/index.tsx; apps/mobile/src/screens/mail/detail.tsx; apps/mobile/src/app/home/missions.tsx` | 소스·API 테스트; 실제 화면 미확인 | 화면 상태는 기존 경로로 연결; 정책 미확정 수치는 적용하지 않음. |
| 20-settings | 설정 메인 | 기존 재사용 + 개편 | `apps/mobile/src/notifications/center.tsx; apps/mobile/src/notifications/api.ts; apps/api/src/postgres/notifications.ts; apps/mobile/src/screens/account-settings/index.tsx` | 소스·단위 테스트; 실제 화면 미확인 | 화면 상태는 기존 경로로 연결; 정책 미확정 수치는 적용하지 않음. |
| 20-settings | 소리·진동·움직임 설정 | 기존 재사용 + 개편 | `apps/mobile/src/notifications/center.tsx; apps/mobile/src/notifications/api.ts; apps/api/src/postgres/notifications.ts; apps/mobile/src/screens/account-settings/index.tsx` | 소스·단위 테스트; 실제 화면 미확인 | 화면 상태는 기존 경로로 연결; 정책 미확정 수치는 적용하지 않음. |
| 20-settings | 알림 설정 | 기존 재사용 + 개편 | `apps/mobile/src/notifications/center.tsx; apps/mobile/src/notifications/api.ts; apps/api/src/postgres/notifications.ts; apps/mobile/src/screens/account-settings/index.tsx` | 소스·단위 테스트; 실제 화면 미확인 | 푸시 전체 설정 및 방문 보상·쿠폰 만료·캠페인 만료 종류별 서버 설정을 저장; 기기 권한/토큰 등록은 별도 처리. |
| 21-onboarding | 시작·로그인 | 기존 재사용 | `apps/mobile/src/screens/auth-required/index.tsx; apps/mobile/src/privacy/consent-flow.ts; apps/mobile/src/screens/real-map/index.tsx; apps/mobile/src/screens/claim-redeem/index.tsx` | 소스·단위 테스트; browser/native 시각 확인 미실시 | 화면 상태는 기존 경로로 연결; 정책 미확정 수치는 적용하지 않음. |
| 21-onboarding | 약관 동의 | 기존 재사용 | `apps/mobile/src/screens/auth-required/index.tsx; apps/mobile/src/privacy/consent-flow.ts; apps/mobile/src/screens/real-map/index.tsx; apps/mobile/src/screens/claim-redeem/index.tsx` | 소스·단위 테스트; browser/native 시각 확인 미실시 | 화면 상태는 기존 경로로 연결; 정책 미확정 수치는 적용하지 않음. |
| 21-onboarding | 위치·카메라 권한 | 기존 재사용 | `apps/mobile/src/screens/auth-required/index.tsx; apps/mobile/src/privacy/consent-flow.ts; apps/mobile/src/screens/real-map/index.tsx; apps/mobile/src/screens/claim-redeem/index.tsx` | 소스·단위 테스트; browser/native 시각 확인 미실시 | 화면 상태는 기존 경로로 연결; 정책 미확정 수치는 적용하지 않음. |
| 22-account-help | 계정·지갑 연결 | 부분 구현 + 기존 재사용 | `apps/mobile/src/app/wallet.tsx; apps/mobile/src/screens/account-settings/index.tsx; docs/account-deletion.html` | 소스·단위 테스트; 도움말은 웹 링크, 지갑은 설정 의존 | 화면 상태는 기존 경로로 연결; 정책 미확정 수치는 적용하지 않음. |
| 22-account-help | 도움말·문의 | 부분 구현 + 기존 재사용 | `apps/mobile/src/app/wallet.tsx; apps/mobile/src/screens/account-settings/index.tsx; docs/account-deletion.html` | 소스·단위 테스트; 도움말은 웹 링크, 지갑은 설정 의존 | 화면 상태는 기존 경로로 연결; 정책 미확정 수치는 적용하지 않음. |
| 22-account-help | 계정 삭제 확인 | 부분 구현 + 기존 재사용 | `apps/mobile/src/app/wallet.tsx; apps/mobile/src/screens/account-settings/index.tsx; docs/account-deletion.html` | 소스·단위 테스트; 도움말은 웹 링크, 지갑은 설정 의존 | 화면 상태는 기존 경로로 연결; 정책 미확정 수치는 적용하지 않음. |

## 범위 밖이거나 일부만 반영된 동작

- 방명록은 칭찬 도장(COZY/COOL/RETURN)에 선택 문구를 덧붙이는 방식이며 최대 120자다. 전용 자유 게시판이나 댓글 스레드는 구현 범위에 포함되지 않는다.
- 식사 초대의 작성·수락/거절·응답 우편은 연결되어 있다. 시간 범위 초대는 수락 시 제안 범위 안의 시각을 입력한다.
- 놀이 보상은 기존 보상 규칙을 유지한다. 시안에서 보이는 새 보상 수치나 새 마일리지 지급 정책은 추가하지 않았다. 구매 정책이 정해지지 않은 가구 상품은 구매 가능으로 노출하지 않는다.
- 알림 종류별 서버 설정은 방문 보상·쿠폰 만료·캠페인 만료 세 항목으로 제한된다. 새로운 알림 유형이나 사용자 정의 규칙은 추가하지 않았다.
- 시안에 표시된 NFT 진행 상태는 기존 발급 작업 상태를 반영한다. 장기 대기 자동 해제 시간을 새로 만들지 않았으며, 코인 리롤 가능 여부는 서버의 entitlement/job 상태로 결정된다.

## 확인 범위

- 원본 시안 기준 목록 수: **67 화면 상태 / 23 보드** (manifest의 각 `pages[].screens[]` 합산).
- 실제 UI 확인: 홈, 프로필. 브라우저 확인은 홈·프로필만 수행했으며 native 시각 확인은 미실시. 나머지는 코드·테스트/API 증거로만 기록하고 시각 PASS로 표시하지 않았다.
- API 검증 42단계와 전체 회귀 suite 결과는 구현 추적 표의 화면별 visual evidence가 아니다. 최종 QA 결과를 확인한 뒤 별도 완료 보고에서 기록한다.
