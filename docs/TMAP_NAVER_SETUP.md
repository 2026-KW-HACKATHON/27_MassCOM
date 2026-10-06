# TMAP 주 지도와 NAVER 대체 지도 설정

관련 작업: [Issue #383](https://github.com/2026-KW-HACKATHON/27_MassCOM/issues/383). 실제 키는 Git 밖의 mode 600 환경 파일에 저장한다. 앱에 넣는 지도 식별자와 서버 전용 Secret을 구분한다.

## TMAP 발급과 설정

1. [SK open API의 TMAP 요금 페이지](https://openapi.sk.com/products/calc?svcSeq=4&menuSeq=5)에서 **Free**를 선택한다. 대중교통·유료 Lite/Premium 상품과 구분한다.
2. 본인 계정으로 앱을 만들고 Free 사용 신청과 약관 확인을 완료한다. 대시보드의 앱 상세에서 `appKey`를 확인한다.
3. 서버에는 `TMAP_REST_APP_KEY`, 모바일/웹 빌드에는 `EXPO_PUBLIC_TMAP_MAP_APP_KEY`를 설정한다. 지도 사용을 위해 발급한 동일 앱 키를 양쪽에 설정할 수 있다. 서버 전용으로 제한한 별도 키는 앱에 넣지 않는다.
4. 실제 값을 채팅·커밋·스크린샷·로그에 추가하지 않는다. 키가 포함된 환경 파일을 shell `source`로 실행하지 않고 Node의 환경 파일 로더로 읽는다.

```dotenv
TMAP_REST_APP_KEY=
EXPO_PUBLIC_TMAP_MAP_APP_KEY=
```

저장 예: `/Users/choi/.config/masscom/tmap.env`. 실제 REST 검사는 API 패키지에서 실행한다.

```sh
cd apps/api
./node_modules/.bin/tsx --env-file=/Users/choi/.config/masscom/tmap.env src/tmap-smoke-command.ts
```

이 명령은 공개 장소 이름·주소로 장소 검색, 주소 좌표 변환, 보행 경로를 세 번 요청한다. 실제 사용자 위치나 DB를 사용하지 않는다. 성공 여부·개수·거리·시간만 출력하며 실패는 종료 코드 1과 정해진 오류 코드로 표시한다. REST PASS는 지도 타일·단말 GPS·UI PASS를 의미하지 않는다. [주소 구분 옵션](https://tmap-skopenapi.readme.io/reference/full-text-geocoding)은 지번/도로명을 모두 받는 `F00`을 사용한다. [TMAP 데이터](https://tmapapi.tmapmobility.com/terms.html)는 24시간 이상 사용하지 않는다.

## NAVER 신규 Maps 등록

1. [신규 Maps 콘솔](https://console.ncloud.com/maps/subscription)에 본인 계정으로 로그인하고 **Services → Application Services → Maps**에서 Application을 등록한다. 구 AI·NAVER API Maps 자격 증명과 신규 Maps 자격 증명을 섞지 않는다.
서비스 이용 불가 안내가 표시되면 콘솔 안내에 따라 본인이 계정 활성화 조건을 먼저 해결한다. 결제수단 미등록 계정의 결제 정보 등록은 본인이 진행하며 결제 정보를 코드·채팅에 넣지 않는다.

2. **Dynamic Map(웹·Android 공통), Geocoding**만 선택한다. 이 구현은 Directions 5/15를 사용하지 않는다.
3. 웹 서비스 URL에는 콘솔 안내대로 www와 하위 도메인을 뺀 대표 도메인 `https://masscom.kr`를 등록한다. 이 대표 도메인은 운영·시연 웹에 사용한다. 이번 로컬 검증은 `http://127.0.0.1:4422`, `http://localhost:4422`를 추가한다. 각 입력 뒤 [추가]를 눌러 목록에 들어간 것을 확인한다. 서비스 출처가 바뀌면 실제 출처에 맞게 수정한다.
4. Android 패키지명을 등록한다: 운영 `kr.masscom.wolgye`, 시연 `kr.masscom.wolgye.demo`, 개발 `kr.masscom.wolgye.dev`. 사용할 환경만 등록하고 각각 실제 설치본과 맞춘다.
5. 인증 정보의 Client ID와 Client Secret을 로컬 파일에 저장한다. 공개 Client ID만 앱 빌드에 넣고 Secret은 API 서버에만 둔다. 요금·대표 계정 여부·일/월 한도는 콘솔에서 확인하고 신청한다. 자동 유료 전환/한도 확대는 구현하지 않는다.

```dotenv
NAVER_MAP_CLIENT_ID=
NAVER_MAP_CLIENT_SECRET=
EXPO_PUBLIC_NAVER_MAP_CLIENT_ID=
```

`EXPO_PUBLIC_NAVER_MAP_CLIENT_ID`와 `NAVER_MAP_CLIENT_ID`는 같은 Maps Application의 Client ID다. 서버는 [신규 Geocoding](https://api.ncloud-docs.com/docs/application-maps-geocoding)의 `https://maps.apigw.ntruss.com/map-geocode/v2/geocode`에 Client ID/Secret 헤더를 보낸다. 웹은 `ncpKeyId`, Android는 SDK 3.24.0의 `NcpKeyClient`를 사용한다. 공식 Maven 저장소는 Expo prebuild 플러그인으로 유지한다.

일반 장소 검색까지 대체하려면 [NAVER Developers 지역 검색](https://developers.naver.com/docs/serviceapi/search/local/local.md)을 별도로 등록하고 다음 두 서버 값도 설정한다. Maps Client ID/Secret을 이 항목에 복사하지 않는다. 지역 검색은 최대 5건이며 후속 페이지가 없다.

```dotenv
NAVER_SEARCH_CLIENT_ID=
NAVER_SEARCH_CLIENT_SECRET=
```

## 전환과 적용 범위

- 지도는 TMAP 우선이다. 키/모듈 부재, 인증 오류, 로딩/준비 시간 초과 등의 장애 때 설정된 NAVER로 한 번 전환한다. NAVER 성공 시 실제 공급자를 표시하고 이전 공급자의 늦은 콜백을 무시한다. 둘 다 실패하면 기존 가게 목록을 계속 사용할 수 있다.
- 주소/장소 REST도 TMAP 우선이며 지정된 제공자 장애에서만 NAVER를 호출한다. 정상 빈 결과·잘못된 입력·후속 페이지를 다른 제공자의 결과로 교체하지 않는다. NAVER 장소에는 `EXTERNAL_PLACE`와 실제 출처를 유지한다.
- 보행 경로는 TMAP 전용이다. NAVER Cloud Directions는 자동차용이므로 TMAP 장애 시 자동차 경로나 직선을 보행 경로로 대신 표시하지 않는다. 경로 출처와 지도 출처는 각각 유지한다.
- NAVER 응답은 DB·서버 캐시에 저장하지 않고 앱의 후보/표시에 최대 1시간 만료를 둔다. 이는 앱의 신선도 정책이며 제공자가 허용한 저장 기간을 뜻하지 않는다. 제공자 간 데이터 표시·SDK 배포 조건은 공개 배포 전에 실제 신청 조건을 확인한다.
- 서버 runtime.env를 수정한 뒤 해당 API 컨테이너를 재생성해야 적용된다. 앱의 공개 지도 ID는 빌드 시 포함되므로 새 export/APK가 필요하다. `EXPO_NO_DOTENV=1`인 시연/운영 빌드에는 선택한 환경 파일의 값을 명시적으로 전달한다. 서버 Secret을 번들에 넣지 않는다.
- 코드 병합, 개인 검증 APK, 실제 휴대폰, 공개 배포, Google Play 제출은 각각 별도 검증 결과다.
