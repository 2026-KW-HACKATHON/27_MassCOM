# 자동 방문 보상과 회전 깊이 QA

2026-10-08 사용자 직접 요청: 점주는 1·3·5회 캠페인을 제어하지 않으며, 회전하는 음각·양각에서 깊이를 확인하고 저장 후에도 움직임이 재현되는지 검수한다.

점주 화면은 합성 fixture `http://127.0.0.1:4191/merchant/`, 비교 화면은 `http://127.0.0.1:4192/`다. 실제 production renderer로 편집 원본과 HTTP에서 다시 읽은 게시 스프라이트를 나란히 재생한다. 운영 계정·실제 AI 과금·보상 지급·Android 실기 증거가 아니다. 최초 편집·네 등급 PNG·게시 v6의 [이전 기록](../merchant-photo-editor-2026-10-08/README.md)은 보존한다.

## 화면과 조작

- [01 자동 방문 보상](01-fixed-visit-rewards.jpg): 캠페인·지급 등급 선택 없이 `1회 브론즈 · 3회 실버 · 5회 골드`를 안내한다.
- [02 운영 결과](02-operations-fixed-policy.jpg): 캠페인 상태는 조회 안내이며 점주 연장 양식은 없다.
- [03 양각 −35°](03-raised-left.png) · [04 양각 +35°](04-raised-right.png) · [05 음각 −35°](05-incised-left.png) · [06 음각 +35°](06-incised-right.png): 같은 원본·실버·깊이 80에서 조명·윤곽 비교.
- [07 실제 자동 회전](07-published-automatic-rotation.png): 저장본 재읽기 후 회전이 계속 렌더링됨. 렌더 횟수는 FPS 측정값이 아니다.
- [08 정면](08-published-front.png) · [09 −45°](09-published-left.png) · [10 +45°](10-published-right.png) · [11 옆면 90°](11-published-edge.png) · [12 고정 뒷면 180°](12-published-back.png): 왼쪽 편집 원본, 오른쪽 저장된 각도 프레임.
- [15 음각 골드](15-incised-gold.png) · [16 음각 브론즈](16-incised-bronze.png): 같은 −45°에서 등급별 재질과 저장 전후를 비교.
- [13 음각 저장 정면](13-incised-front.png) · [14 음각 저장 −45°](14-incised-left.png): 양각 게시본을 보존하고 음각을 새 버전으로 게시해 다시 읽었다.

사용자 그림 `87_55169d4f1d3c8_1309.png`(336×286px)를 파일 선택창으로 넣었다. 원본 밝기×alpha에서 얻은 높이에 따라 밝은 영역이 높은 표면이 된다. 실버·깊이 80·좌우 회전·음각/양각을 직접 조작하고 세 등급의 반복 회전을 추가했다. 브론즈·실버·골드는 비활성화할 수 없다. 프리즘은 편집·미리보기할 수 있지만 게시 파생 이미지는 고정 방문 보상에 쓰이는 세 등급만 만든다.

## 저장 결정

편집 원본·붓·스티커·설정은 프로젝트 JSON에 보관한다. 완성품은 **정면/썸네일 + 12칸 앞면 스프라이트 + 고정 뒷면 + once/loop 동작 JSON**으로 저장한다. WebP 미지원 브라우저는 PNG를 쓴다. GIF·MP4로 동작을 굳히지 않으므로 각도 조작과 기존 앱 재생 계약을 유지한다. 서버는 animated WebP를 거절한다.

프레임은 12칸·4열·3행·15° 간격, −82.5°부터 +82.5°다. 음각·양각이면 별도 재질 효과가 없어도 생성한다. 서버는 프레임 1MiB·뒷면 256KiB·전체 UTF-8 JSON 8MiB를 검사한다. 게시 크기 사다리는 448→384→320→256px이며 검수본은 448px 단계에서 통과했다. [browser-results.json](browser-results.json)에 실제 크기·규격·경계를 기록하고 [capture-hashes.json](capture-hashes.json)에 캡처 SHA-256을 남겼다.

고객용 summary/detail JSONB는 원본·붓을 제외하고 publication+grade로 저장한다. 새 게시본은 이전 보유품의 참조를 바꾸지 않는다. 앱도 같은 12/4/15 자료를 읽는다. 모바일 파서·프레임 보간·고정 뒷면 대상 시험 38/38 PASS는 단말 재생 증거와 구분한다.

## 표현과 검증 경계

깊이는 높이·법선 조명·윤곽 변위와 2D 외곽 압출을 합친 **2.5D**다. 실제 3D 메시나 높이/법선 맵을 저장하지 않으며 alpha 외곽을 완전히 옮기는 형상 투영도 아니다. 정면 0°는 −7.5°/+7.5°의 보간이라 게시본 윤곽이 조금 부드러워진다. 모바일은 별도 재질 조명과 다른 재생 주기를 사용하므로 웹과 픽셀·속도가 같다는 의미는 아니다. 작은 원본의 화질 한계도 남는다.

최신 main `cd01c0d6`(API 라우트 분리·운영 가드 포함) 통합 뒤 API 전체 601/601·typecheck·build, 사이트 416/416·현재 배포 시험 12/12 PASS. 새 전용 `masscom_fixed_visit_20261008190444_test` PostgreSQL에서 게시/버전/모션 round-trip·점주 연장 금지·관리자 연장 유지 통합 29/29 PASS. 독립 리뷰에서 발견한 depth=0 칠하기 오류를 수정했다. 사이트 전체와 LF 게이트의 최종 수치는 [TEST_STATUS](../../TEST_STATUS.md)를 따른다. 운영 계정의 승인 점포가 없어 실제 게시 QA는 BLOCKED이며 운영 배포·방문 지급·Android 실기·메모리/FPS 실측은 별도 검증이다.

## 재현

1. `COLLECTIBLE_QA_PORT=4191 COLLECTIBLE_QA_AI=1 node tests/fixtures/collectible-qa-server.mjs`로 fixture를 실행한다(PowerShell에서는 환경변수를 먼저 지정).
2. 준비 이미지 진입·업로드·실버·깊이 80·양각을 선택하고 반복 회전을 세 등급에 적용해 게시한다.
3. `node tests/fixtures/collectible-relief-qa-server.mjs`를 실행하고 `http://127.0.0.1:4192/`에서 재생·정지·각도를 비교한다. 서버는 loopback 전용이며 점주 읽기와 자산 GET만 프록시한다.
4. 음각을 새 버전으로 게시하고 비교 화면을 새로고침한다. 이전 양각 프로젝트는 보존된다.
