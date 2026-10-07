# 마이룸 콘텐츠 자산

2026-10-07 사용자 제공 UI 보드의 아이보리·민트·원목 재질을 참고해 내장 image_gen으로 새로 생성했다. UI 화면을 그대로 붙이지 않으며 글자·버튼·배치 상태는 앱 컴포넌트다. 보유 가구는 서버 inventory ID와 연결한다.

- `room-empty.png`: 투명 배경의 빈 원목 마루·아이보리 벽 방. 1254×1254 RGBA. 기존 해금된 방 테마를 벽/바닥 색으로 조합한다.
- `furniture-atlas.png`: 1536×1024 RGBA, 512×512 셀의 3열×2행. 위: oak-chair, round-table, leafy-plant. 아래: floor-lamp, bookcase, mushroom-lamp. 런타임에서 셀을 클리핑하므로 원본 alpha를 유지한다.

생성 프롬프트: “cozy 3D miniature room / empty isometric dollhouse corner / cream ivory plaster walls / honey light-oak parquet / true transparent surroundings / no furniture, characters, text or controls”. 가구는 “six equal cells, 3 columns x 2 rows / oak chair mint cushion, round table, leafy cream pot, cream floor lamp, low oak bookcase, ivory mushroom lamp / same isometric perspective / transparent / no labels or UI”를 사용했다.

카탈로그의 미확정 가격은 NULL, 판매 가능 여부는 false다. 자산이 존재한다는 이유로 소유하거나 구매 가능하다고 표시하지 않는다. 제작 도구의 원본은 Git 외부에 보존하고 앱에서 소비하는 사본만 이 경로에 둔다.
